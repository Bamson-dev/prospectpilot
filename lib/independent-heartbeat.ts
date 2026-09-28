import { Worker } from "node:worker_threads";
import { JOB_HEARTBEAT_MS } from "@/lib/job-state";
import { logInfo } from "@/lib/logger";

export type HeartbeatWatch =
  | { kind: "job"; id: string; attempt: number }
  | { kind: "research"; id: string }
  | { kind: "qualification"; id: string };

let thread: Worker | null = null;
let threadDisabled = false;

function heartbeatKey(watch: HeartbeatWatch) {
  return `${watch.kind}:${watch.id}`;
}

function heartbeatThread() {
  if (thread || threadDisabled || !process.env.DATABASE_URL) return thread;
  try {
    thread = new Worker(new URL("../worker/claim-heartbeat.mjs", import.meta.url), {
      workerData: { intervalMs: JOB_HEARTBEAT_MS },
    });
    thread.unref();
    thread.on("error", (error) => {
      threadDisabled = true;
      thread = null;
      logInfo("heartbeat.thread_failed", { message: error.message });
    });
    return thread;
  } catch (error) {
    threadDisabled = true;
    logInfo("heartbeat.thread_failed", { message: error instanceof Error ? error.message : "unavailable" });
    return null;
  }
}

export function watchLease(watch: HeartbeatWatch, beat: () => Promise<unknown>) {
  const timer = setInterval(() => {
    void Promise.resolve(beat()).catch(() => undefined);
  }, JOB_HEARTBEAT_MS);
  const worker = heartbeatThread();
  worker?.postMessage({ type: "watch", key: heartbeatKey(watch), watch });
  return () => {
    clearInterval(timer);
    worker?.postMessage({ type: "stop", key: heartbeatKey(watch) });
  };
}
