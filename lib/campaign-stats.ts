import { prisma } from "@/lib/db";

export async function campaignOverview(organizationId: string, campaignId: string) {
  const where = { organizationId, campaignId };
  const [prospects, researched, qualified, approved, sent, replies, interested, meetings] = await Promise.all([
    prisma.prospect.count({ where }),
    prisma.prospect.count({ where: { ...where, researchStatus: "COMPLETED" } }),
    prisma.prospect.count({ where: { ...where, qualificationStatus: { in: ["QUALIFIED", "APPROVED"] } } }),
    prisma.outreachMessage.count({ where: { ...where, state: { in: ["APPROVED", "SCHEDULED", "QUEUED", "SENDING", "SENT", "DELIVERED", "OPENED", "REPLIED"] } } }),
    prisma.outreachMessage.count({ where: { ...where, sentAt: { not: null } } }),
    prisma.reply.count({ where: { organizationId, conversation: { prospect: { campaignId } } } }),
    prisma.reply.count({ where: { organizationId, classification: "INTERESTED", conversation: { prospect: { campaignId } } } }),
    prisma.reply.count({ where: { organizationId, classification: "MEETING_REQUEST", conversation: { prospect: { campaignId } } } }),
  ]);
  return { prospects, researched, qualified, approved, sent, replies, interested, meetings };
}
