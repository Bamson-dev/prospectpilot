import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logError } from "@/lib/logger";
import { enqueue, type QueueName } from "@/lib/queues";

export async function recordActivity(input: {
  organizationId: string;
  campaignId?: string | null;
  prospectId?: string | null;
  contactId?: string | null;
  userId?: string | null;
  action: string;
  detail?: string | null;
}) {
  await prisma.activityLog.create({
    data: {
      organizationId: input.organizationId,
      campaignId: input.campaignId ?? null,
      prospectId: input.prospectId ?? null,
      contactId: input.contactId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      detail: input.detail ?? null,
    },
  });
}

export async function queueJob(input: {
  id?: string;
  organizationId: string;
  campaignId?: string | null;
  prospectId?: string | null;
  queue: QueueName;
  name: string;
  payload?: Prisma.InputJsonValue;
}) {
  let job;
  try {
    job = await prisma.backgroundJob.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        organizationId: input.organizationId,
        campaignId: input.campaignId ?? null,
        prospectId: input.prospectId ?? null,
        queue: input.queue,
        name: input.name,
        payload: input.payload,
      },
    });
  } catch (error) {
    if (input.id && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.backgroundJob.findUnique({ where: { id: input.id } });
      if (existing) return existing;
    }
    throw error;
  }
  const extra: Record<string, string> = {};
  if (input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)) {
    for (const [key, value] of Object.entries(input.payload)) {
      if (typeof value === "string") extra[key] = value;
    }
  }
  try {
    await enqueue(input.queue, job.id, {
      jobId: job.id,
      organizationId: input.organizationId,
      campaignId: input.campaignId ?? "",
      prospectId: input.prospectId ?? "",
      ...extra,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queue unavailable";
    logError("queue.enqueue_failed", { jobId: job.id, queue: input.queue, message });
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { state: "FAILED", error: `Redis queue is unavailable: ${message}`, finishedAt: new Date() },
    });
    throw new AppError(`The background queue is unavailable: ${message}`);
  }
  return job;
}
