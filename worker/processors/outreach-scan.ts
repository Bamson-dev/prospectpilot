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
        id: `outreach:${message.id}`,
        organizationId: message.organizationId,
        queue: "outreach",
        name: "outreach.send",
        payload: { messageId: message.id },
      });
    }
  }
}
