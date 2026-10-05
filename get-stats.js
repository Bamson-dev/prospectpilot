const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function getStats() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const jobsDiscovered = await prisma.jobVacancy.count({ where: { createdAt: { gte: startOfDay } } });
  const jobsQualified = await prisma.jobVacancy.count({ where: { status: 'QUALIFIED', updatedAt: { gte: startOfDay } } });
  const applicationsPrepared = await prisma.jobApplication.count({ where: { updatedAt: { gte: startOfDay } } });
  const applicationsAttempted = await prisma.applicationAutomationRun.count({ where: { startedAt: { gte: startOfDay } } });
  const applicationsSubmitted = await prisma.jobApplication.count({ where: { submittedAt: { gte: startOfDay } } });
  const applicationsBlocked = await prisma.jobApplication.count({ where: { blockedReason: { not: null }, updatedAt: { gte: startOfDay } } });

  const clientProspects = await prisma.prospect.count({ where: { createdAt: { gte: startOfDay } } });
  const outreachQueued = await prisma.outreachMessage.count({ where: { state: { in: ['PENDING_APPROVAL', 'APPROVED'] }, createdAt: { gte: startOfDay } } });
  const outreachSent = await prisma.outreachMessage.count({ where: { state: 'DELIVERED', createdAt: { gte: startOfDay } } });
  const replies = await prisma.employerReply.count({ where: { createdAt: { gte: startOfDay } } });

  const discoveryRun = await prisma.jobDiscoveryRun.findFirst({ orderBy: { startedAt: 'desc' } });

  console.log(JSON.stringify({
    jobsDiscovered,
    jobsQualified,
    applicationsPrepared,
    applicationsAttempted,
    applicationsSubmitted,
    applicationsBlocked,
    clientProspects,
    outreachQueued,
    outreachSent,
    replies,
    lastRun: discoveryRun ? discoveryRun.startedAt : null
  }, null, 2));
}

getStats().catch(console.error).finally(() => prisma.$disconnect());
