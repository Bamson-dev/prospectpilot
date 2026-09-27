import { UnrecoverableError } from "bullmq";
import { prisma } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { logError, logInfo } from "@/lib/logger";

const PERMANENT = /not configured|stopped|blocked|denied|private network|not a public|quota|rate limit|policy|restricted|credentials|did not return|malformed|no company results/i;

export async function runJob(jobId: string, work: () => Promise<void>) {
  const existing = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (!existing) throw new UnrecoverableError("Job record was not found.");
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: { state: "ACTIVE", startedAt: existing.startedAt ?? new Date(), attempts: { increment: 1 } },
  });
  const started = Date.now();
  try {
    await work();
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { state: "COMPLETED", finishedAt: new Date(), error: null },
    });
    logInfo("job.completed", { jobId, queue: existing.queue, durationMs: Date.now() - started });
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Job failed").slice(0, 500);
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { state: "FAILED", error: message, finishedAt: new Date() },
    });
    logError("job.failed", { jobId, queue: existing.queue, message, durationMs: Date.now() - started });
    const permanent =
      (error instanceof Error && (error.name === "PermanentProviderError" || PERMANENT.test(error.message))) ||
      (isAppError(error) && PERMANENT.test(error.message));
    if (permanent) throw new UnrecoverableError(message);
    throw error;
  }
}
