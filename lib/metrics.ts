import { prisma } from "@/lib/db";

export async function workspaceMetrics(organizationId: string) {
  const [prospects, researched, qualified, approved, sent, delivered, opened, replies, interested, meetings] = await Promise.all([
    prisma.prospect.count({ where: { organizationId } }),
    prisma.prospect.count({ where: { organizationId, researchStatus: "COMPLETED" } }),
    prisma.prospect.count({ where: { organizationId, qualificationStatus: { in: ["QUALIFIED", "APPROVED"] } } }),
    prisma.outreachMessage.count({ where: { organizationId, state: { in: ["APPROVED", "QUEUED", "SENDING", "SENT", "DELIVERED", "OPENED", "REPLIED"] } } }),
    prisma.outreachMessage.count({ where: { organizationId, sentAt: { not: null } } }),
    prisma.outreachMessage.count({ where: { organizationId, deliveredAt: { not: null } } }),
    prisma.outreachMessage.count({ where: { organizationId, openedAt: { not: null } } }),
    prisma.reply.count({ where: { organizationId } }),
    prisma.reply.count({ where: { organizationId, classification: "INTERESTED" } }),
    prisma.reply.count({ where: { organizationId, classification: "MEETING_REQUEST" } }),
  ]);
  return { prospects, researched, qualified, approved, sent, delivered, opened, replies, interested, meetings, deals: 0, pipelineValue: 0 };
}

export function rate(part: number, whole: number) {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}
