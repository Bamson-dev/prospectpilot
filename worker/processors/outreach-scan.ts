import { prisma } from "@/lib/db";
import { queueJob } from "@/lib/jobs";
import { outreachSendingEnabled } from "@/lib/email/send-gate";
import { confirmedOptInContactIds } from "@/lib/email/opt-in";
import { logInfo } from "@/lib/logger";

// A failed send job is requeued by the scan at most this often, so a message that cannot send does not
// wake up every scan, and the failure record stays visible between attempts.
export const FAILED_JOB_REQUEUE_AFTER_MS = 6 * 60 * 60 * 1000;

export function shouldRequeueFailedJob(job: { state: string; updatedAt: Date }, nowMs: number) {
  if (job.state !== "FAILED") return false;
  return nowMs - job.updatedAt.getTime() >= FAILED_JOB_REQUEUE_AFTER_MS;
}

export async function processOutreachScan() {
  if (!outreachSendingEnabled()) return;

  const confirmedContactIds = await confirmedOptInContactIds(prisma);
  if (confirmedContactIds.length === 0) {
    logInfo("worker.outreach_scan_idle", { reason: "no_confirmed_opt_in_contacts" });
    return;
  }

  const contactFilter = {
    id: { in: confirmedContactIds },
    email: { not: null },
    suppressed: false,
    source: "opt-in",
  };

  const messages = await prisma.outreachMessage.findMany({
    where: {
      state: { in: ["DRAFT", "PENDING_APPROVAL"] },
      campaign: {
        status: "ACTIVE",
        emailAccountId: { not: null },
      },
      contact: contactFilter,
    },
    select: { id: true, prospectId: true, organizationId: true },
  });

  let approved = 0;
  for (const message of messages) {
    const claim = await prisma.outreachMessage.updateMany({
      where: { id: message.id, state: { in: ["DRAFT", "PENDING_APPROVAL"] } },
      data: { state: "APPROVED" },
    });

    if (claim.count === 1) {
      approved += 1;
      await prisma.prospect.update({
        where: { id: message.prospectId },
        data: { outreachState: "APPROVED" },
      });

      await queueJob({
        id: `outreach-${message.id}`,
        organizationId: message.organizationId,
        queue: "outreach",
        name: "outreach.send",
        payload: { messageId: message.id },
      });
    }
  }

  const stranded = await prisma.outreachMessage.findMany({
    where: { state: "APPROVED", campaign: { status: "ACTIVE" }, contact: contactFilter },
    select: { id: true, organizationId: true },
  });

  let repaired = 0;
  let skippedFailed = 0;
  for (const message of stranded) {
    const job = await prisma.backgroundJob.findUnique({
      where: { id: `outreach-${message.id}` },
    });

    if (job && !shouldRequeueFailedJob(job, Date.now())) {
      if (job.state === "FAILED") skippedFailed += 1;
      continue;
    }

    // queueJob resumes a FAILED job with the same id, so the failure history stays on the record.
    await queueJob({
      id: `outreach-${message.id}`,
      organizationId: message.organizationId,
      queue: "outreach",
      name: "outreach.send",
      payload: { messageId: message.id },
    });
    repaired += 1;
    logInfo("worker.outreach_scan_repaired", { messageId: message.id });
  }

  logInfo("worker.outreach_scan_done", {
    confirmedContacts: confirmedContactIds.length,
    candidates: messages.length,
    approved,
    strandedChecked: stranded.length,
    repaired,
    skippedFailed,
  });
}
