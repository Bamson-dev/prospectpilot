import { prisma } from "@/lib/db";
import { queueJob } from "@/lib/jobs";
import { logInfo } from "@/lib/logger";

export async function processOutreachScan() {
  const messages = await prisma.outreachMessage.findMany({
    where: {
      state: { in: ["DRAFT", "PENDING_APPROVAL"] },
      campaign: {
        status: { notIn: ["PAUSED", "ARCHIVED", "COMPLETED"] },
        requireApproval: false,
        emailAccountId: { not: null },
      },
      contact: {
        email: { not: null },
        suppressed: false,
      }
    },
    select: { id: true, prospectId: true, organizationId: true }
  });

  if (messages.length === 0) return;

  logInfo("worker.outreach_scan_found", { count: messages.length });

  for (const message of messages) {
    const claim = await prisma.outreachMessage.updateMany({
      where: { id: message.id, state: { in: ["DRAFT", "PENDING_APPROVAL"] } },
      data: { state: "APPROVED" }
    });

    if (claim.count === 1) {
      await prisma.prospect.update({
        where: { id: message.prospectId },
        data: { outreachState: "APPROVED" }
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
    where: { state: "APPROVED", campaign: { status: "ACTIVE" } },
    select: { id: true, organizationId: true }
  });

  for (const message of stranded) {
    const job = await prisma.backgroundJob.findUnique({
      where: { id: `outreach-${message.id}` }
    });
    
    if (!job || job.state === "FAILED") {
      if (job && job.state === "FAILED") {
        await prisma.backgroundJob.delete({ where: { id: job.id } });
      }
      await queueJob({
        id: `outreach-${message.id}`,
        organizationId: message.organizationId,
        queue: "outreach",
        name: "outreach.send",
        payload: { messageId: message.id },
      });
      logInfo("worker.outreach_scan_repaired", { messageId: message.id });
    }
  }
}
