import { PrismaClient } from "@prisma/client";
import { parentPort, workerData } from "node:worker_threads";

const intervalMs = Number(workerData?.intervalMs) || 15_000;
const databaseUrl = heartbeatDatabaseUrl(process.env.DATABASE_URL);
if (!parentPort || !databaseUrl) {
  process.exit(0);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const watches = new Map();

function heartbeatDatabaseUrl(raw) {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.searchParams.set("connection_limit", "1");
    return url.toString();
  } catch {
    return raw;
  }
}

async function beat(watch) {
  if (watch.kind === "job") {
    await prisma.backgroundJob.updateMany({
      where: { id: watch.id, state: "ACTIVE", attempts: watch.attempt },
      data: { startedAt: new Date() },
    });
    return;
  }
  if (watch.kind === "research") {
    await prisma.researchRecord.updateMany({
      where: { id: watch.id, fetchMethod: "pending" },
      data: { createdAt: new Date() },
    });
    return;
  }
  if (watch.kind === "qualification") {
    await prisma.activityLog.updateMany({
      where: { id: watch.id, action: "qualification.slot" },
      data: { createdAt: new Date() },
    });
  }
}

const timer = setInterval(() => {
  for (const watch of watches.values()) {
    void beat(watch).catch(() => undefined);
  }
}, intervalMs);
timer.unref();

parentPort.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "watch" && message.key && message.watch) watches.set(message.key, message.watch);
  if (message.type === "stop" && message.key) watches.delete(message.key);
});
