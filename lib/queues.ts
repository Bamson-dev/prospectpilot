import { Queue } from "bullmq";
import IORedis from "ioredis";

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
  await getQueue(name).add(name, data, {
    jobId,
    attempts: 3,
    backoff: { type: "job-retry", delay: 15000 },
    removeOnComplete: 200,
    removeOnFail: 200,
  });
}
