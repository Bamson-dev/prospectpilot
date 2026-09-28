import { PrismaClient } from "@prisma/client";

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

const databaseUrl = heartbeatDatabaseUrl(process.env.DATABASE_URL);
if (!databaseUrl || typeof process.send !== "function") {
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const watches = new Map();
const intervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS) || 15_000;

try {
  await prisma.$queryRaw`SELECT 1`;
  process.send({ type: "ready" });
} catch {
  process.send({ type: "failed" });
  process.exit(1);
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

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "watch" && message.key && message.watch) watches.set(message.key, message.watch);
  if (message.type === "stop" && message.key) watches.delete(message.key);
});

process.on("disconnect", () => {
  clearInterval(timer);
  void prisma.$disconnect().finally(() => process.exit(0));
});
