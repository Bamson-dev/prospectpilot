import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { heartbeatRunDecision, JOB_HEARTBEAT_MS } from "@/lib/job-state";
import { logInfo } from "@/lib/logger";

export type HeartbeatWatch =
  | { kind: "job"; id: string; attempt: number }
  | { kind: "research"; id: string }
  | { kind: "qualification"; id: string };

const watches = new Map<string, HeartbeatWatch>();
let child: ChildProcess | null = null;
let ready = false;
let starting: Promise<boolean> | null = null;
let restartTimer: NodeJS.Timeout | null = null;

function heartbeatKey(watch: HeartbeatWatch) {
  return `${watch.kind}:${watch.id}`;
}

function childAlive() {
  return Boolean(ready && child && child.connected && !child.killed);
}

function send(message: object) {
  if (!childAlive() || !child) return;
  try {
    child.send(message);
  } catch (error) {
    logInfo("heartbeat.send_failed", { message: error instanceof Error ? error.message : "unavailable" });
  }
}

function publishWatches(proc: ChildProcess) {
  for (const [key, watch] of watches) {
    try {
      proc.send({ type: "watch", key, watch });
    } catch {
      return;
    }
  }
}

function armRestart() {
  if (restartTimer) return;
  restartTimer = setInterval(() => {
    if (watches.size > 0 && !childAlive() && !starting) void startChild();
  }, 2_000);
  restartTimer.unref();
}

function startChild() {
  if (childAlive()) return Promise.resolve(true);
  if (starting) return starting;
  const file = fileURLToPath(new URL("../worker/claim-heartbeat.mjs", import.meta.url));
  const proc = fork(file, [], {
    env: { ...process.env, HEARTBEAT_INTERVAL_MS: String(JOB_HEARTBEAT_MS) },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  child = proc;
  ready = false;
  let settled = false;
  let timer: NodeJS.Timeout | null = null;
  starting = new Promise<boolean>((resolve) => {
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      starting = null;
      resolve(ok);
    };
    timer = setTimeout(() => {
      proc.kill();
      finish(false);
    }, 8_000);
    proc.on("message", (message: { type?: string }) => {
      if (message?.type === "ready") {
        ready = true;
        publishWatches(proc);
        finish(true);
      }
      if (message?.type === "failed") finish(false);
    });
    proc.on("error", (error) => {
      logInfo("heartbeat.process_failed", { message: error.message });
      finish(false);
    });
    proc.on("exit", () => {
      if (child === proc) {
        child = null;
        ready = false;
      }
      finish(false);
    });
  });
  return starting;
}

export async function ensureIndependentHeartbeat() {
  armRestart();
  if (childAlive()) return heartbeatRunDecision(true);
  if (!process.env.DATABASE_URL) return heartbeatRunDecision(false);
  for (let attempt = 0; attempt < 3 && !childAlive(); attempt += 1) {
    await startChild();
  }
  return heartbeatRunDecision(childAlive());
}

export function watchLease(watch: HeartbeatWatch) {
  armRestart();
  const key = heartbeatKey(watch);
  watches.set(key, watch);
  send({ type: "watch", key, watch });
  return () => {
    watches.delete(key);
    send({ type: "stop", key });
  };
}
