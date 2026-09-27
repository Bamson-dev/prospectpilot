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

export async function discoveryToday(organizationId: string) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const where = { organizationId, createdAt: { gte: start } };
  const [raw, companies, duplicates, researched, contacts, emails, software, advertising, qualified, grouped] = await Promise.all([
    prisma.discoverySource.count({ where }),
    prisma.prospect.count({ where }),
    prisma.activityLog.count({ where: { organizationId, action: "discovery.company.duplicate", createdAt: { gte: start } } }),
    prisma.prospect.count({ where: { organizationId, researchStatus: "COMPLETED", updatedAt: { gte: start } } }),
    prisma.contact.count({ where }),
    prisma.contact.count({ where: { ...where, email: { not: null } } }),
    prisma.opportunityAssessment.count({ where: { kind: "SOFTWARE", createdAt: { gte: start }, prospect: { organizationId } } }),
    prisma.opportunityAssessment.count({ where: { kind: "ADVERTISING", createdAt: { gte: start }, prospect: { organizationId } } }),
    prisma.activityLog.count({ where: { organizationId, action: "prospect.qualified", createdAt: { gte: start } } }),
    prisma.discoverySource.groupBy({ by: ["sourceType"], where, _count: { _all: true } }),
  ]);
  const sources = { search: 0, directory: 0, map: 0, social: 0, other: 0 };
  for (const row of grouped) {
    const count = row._count._all;
    const kind = row.sourceType.toLowerCase();
    if (kind === "search") sources.search += count;
    else if (kind === "directory") sources.directory += count;
    else if (kind === "map") sources.map += count;
    else if (kind === "social") sources.social += count;
    else sources.other += count;
  }
  return { raw, companies, duplicates, researched, contacts, emails, software, advertising, qualified, sources };
}

export function rate(part: number, whole: number) {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}
