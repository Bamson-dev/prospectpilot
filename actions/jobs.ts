"use server";

import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { recordActivity } from "@/lib/jobs";
import { retryQueueJobId } from "@/lib/job-state";
import { enqueue, QUEUE_NAMES, type QueueName } from "@/lib/queues";

export async function retryJob(formData: FormData) {
  const { organization, user } = await requireOrganization("ADMIN");
  const id = String(formData.get("id"));
  const job = await prisma.backgroundJob.findFirst({ where: { id, organizationId: organization.id } });
  if (!job) redirect("/settings/jobs?error=Job+not+found.");
  if (job.state !== "FAILED") redirect("/settings/jobs?error=Only+failed+jobs+can+be+retried.");
  if (job.attempts >= job.maxAttempts) redirect("/settings/jobs?error=This+job+has+used+its+retry+limit.");
  if (!QUEUE_NAMES.includes(job.queue as QueueName)) redirect("/settings/jobs?error=That+queue+cannot+be+retried+from+here.");
  const extra: Record<string, string> = {};
  if (job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)) {
    for (const [key, value] of Object.entries(job.payload)) {
      if (typeof value === "string") extra[key] = value;
    }
  }
  const claim = await prisma.backgroundJob.updateMany({
    where: { id, organizationId: organization.id, state: "FAILED", attempts: job.attempts },
    data: { state: "QUEUED", error: null, finishedAt: null },
  });
  if (claim.count !== 1) redirect("/settings/jobs?error=This+job+changed+before+it+could+be+retried.");
  try {
    await enqueue(job.queue as QueueName, retryQueueJobId(job.id, job.attempts), {
      jobId: job.id,
      organizationId: organization.id,
      campaignId: job.campaignId ?? "",
      prospectId: job.prospectId ?? "",
      ...extra,
    });
  } catch (error) {
    await prisma.backgroundJob.updateMany({
      where: { id, organizationId: organization.id, state: "QUEUED", attempts: job.attempts },
      data: { state: "FAILED", error: "Redis queue is unavailable.", finishedAt: new Date() },
    });
    redirect(`/settings/jobs?error=${encodeURIComponent(errorMessage(error))}`);
  }
  await recordActivity({ organizationId: organization.id, campaignId: job.campaignId, prospectId: job.prospectId, userId: user.id, action: "job.retried", detail: job.name });
  redirect("/settings/jobs?notice=Job+queued+again.+It+cannot+exceed+its+attempt+limit.");
}
