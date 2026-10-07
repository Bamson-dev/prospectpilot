import { Queue } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@/lib/db";

export const QUEUE_NAMES = [
  "discovery",
  "research",
  "playwright-research",
  "qualification",
  "ai",
  "outreach",
  "inbox-sync",
  "reply-analysis",
  "follow-up",
  "job-discovery",
  "job-analysis",
  "job-fit",
  "cv-generation",
  "cover-letter",
  "application-preparation",
  "application-browser",
  "application-submit",
  "application-verification",
  "application-followup",
  "employer-reply",
  "captcha-solver",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

const globalForQueues = globalThis as unknown as {
  redis?: IORedis;
  queues?: Map<string, Queue>;
};

export function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not configured.");
  if (!globalForQueues.redis) {
    globalForQueues.redis = new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
  }
  return globalForQueues.redis;
}

export function getQueue(name: QueueName) {
  if (!globalForQueues.queues) globalForQueues.queues = new Map();
  const existing = globalForQueues.queues.get(name);
  if (existing) return existing;
  const queue = new Queue(name, { connection: getRedis() });
  globalForQueues.queues.set(name, queue);
  return queue;
}

export async function enqueue(name: QueueName, jobId: string, data: Record<string, string>) {
  const queue = getQueue(name);
  const existingJob = await queue.getJob(jobId);
  
  if (existingJob) {
    const state = await existingJob.getState();
    const bgJob = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
    
    const sentMsg = bgJob && bgJob.prospectId ? await prisma.outreachMessage.findFirst({
      where: { prospectId: bgJob.prospectId, state: "SENT" }
    }) : null;

    if (state === "failed") {
      if (sentMsg) return;
      await existingJob.retry("failed");
      return;
    }
    if (state === "waiting" || state === "active" || state === "delayed" || state === "prioritized") {
      return;
    }
    if (state === "completed") {
      if (sentMsg) return;
      if (bgJob && (bgJob.state === "QUEUED" || bgJob.state === "FAILED")) {
        await existingJob.remove();
      } else {
        return;
      }
    }
  }

  await queue.add(name, data, {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 15000 },
    removeOnComplete: 200,
    removeOnFail: 200,
  });
}
