import { UnrecoverableError } from "bullmq";
import { prisma } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { ensureIndependentHeartbeat, watchLease } from "@/lib/independent-heartbeat";
import { isPermanentJobError, jobDeliveryDecision } from "@/lib/job-state";
import { logError, logInfo } from "@/lib/logger";

export async function runJob(jobId: string, work: () => Promise<void>) {
  const existing = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (!existing) throw new UnrecoverableError("Job record was not found.");
  const decision = jobDeliveryDecision({
    state: existing.state,
    attempts: existing.attempts,
    maxAttempts: existing.maxAttempts,
    startedAtMs: existing.startedAt?.getTime() ?? null,
    nowMs: Date.now(),
  });
  if (decision === "skip") {
    logInfo("job.skipped", { jobId, state: existing.state });
    return;
  }
  // A live claim stays ACTIVE. Acking that delivery would leave a crashed
  // worker's row finished in the queue and stranded in the database.
  if (decision === "busy") throw new Error("Job is already active.");
  if (decision === "exhausted") {
    await prisma.backgroundJob.updateMany({
      where: { id: jobId, state: "ACTIVE", attempts: existing.attempts },
      data: { state: "FAILED", error: "Job stopped after its attempt limit.", finishedAt: new Date() },
    });
    if (existing.queue === "research" && existing.prospectId) {
      await prisma.prospect.updateMany({
        where: { id: existing.prospectId, researchStatus: "IN_PROGRESS" },
        data: { researchStatus: "FAILED" },
      });
    }
    throw new UnrecoverableError("Job stopped after its attempt limit.");
  }
  if ((await ensureIndependentHeartbeat()) !== "run") {
    throw new Error("Heartbeat process is unavailable.");
  }
  // Compare the observed attempt count as well as state. BullMQ can deliver a
  // duplicate while a job is ACTIVE; exactly one delivery may claim that
  // observed version of the database row. Refresh startedAt so a reclaimed
  // attempt is not immediately stale.
  const claim = await prisma.backgroundJob.updateMany({
    where: { id: jobId, state: existing.state, attempts: existing.attempts },
    data: { state: "ACTIVE", startedAt: new Date(), attempts: { increment: 1 } },
  });
  if (claim.count !== 1) {
    logInfo("job.skipped_claimed", { jobId, state: existing.state });
    return;
  }
  const started = Date.now();
  const attempt = existing.attempts + 1;
  const stopHeartbeat = watchLease({ kind: "job", id: jobId, attempt });
  try {
    try {
      await work();
      await prisma.backgroundJob.updateMany({
        where: { id: jobId, state: "ACTIVE", attempts: attempt },
        data: { state: "COMPLETED", finishedAt: new Date(), error: null },
      });
      logInfo("job.completed", { jobId, queue: existing.queue, durationMs: Date.now() - started });
    } catch (error) {
      const message = (error instanceof Error ? error.message : "Job failed").slice(0, 500);
      await prisma.backgroundJob.updateMany({
        where: { id: jobId, state: "ACTIVE", attempts: attempt },
        data: { state: "FAILED", error: message, finishedAt: new Date() },
      });
      logError("job.failed", { jobId, queue: existing.queue, message, durationMs: Date.now() - started });
      const permanent =
        (error instanceof Error && (error.name === "PermanentProviderError" || isPermanentJobError(error.message))) ||
        (isAppError(error) && isPermanentJobError(error.message));
      if (permanent) throw new UnrecoverableError(message);
      throw error;
    }
  } finally {
    stopHeartbeat();
  }
}
