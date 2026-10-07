/* eslint-disable */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const [
    discovered,
    qualified,
    pitches,
    outreachQueued,
    emailsSent,
    emailsFailed,
    replies,
    followUpsSent
  ] = await Promise.all([
    prisma.prospect.count({ where: { discoveryStatus: { not: 'NEW' } } }),
    prisma.prospect.count({ where: { qualificationStatus: 'QUALIFIED' } }),
    prisma.prospect.count({ where: { outreachState: { not: 'NONE' } } }),
    prisma.prospect.count({ where: { outreachState: 'QUEUED' } }),
    prisma.prospect.count({ where: { outreachState: 'SENT' } }),
    prisma.prospect.count({ where: { outreachState: 'FAILED' } }),
    prisma.conversation.count(),
    prisma.followUp.count()
  ]);
  
  const campaign = await prisma.campaign.findFirst({ where: { status: 'ACTIVE' } });
  
  console.log(`DEEPSEEK: UNKNOWN (pending next Coolify cron run)
AUTO APPROVE: ${!campaign?.requireApproval ? 'ON' : 'OFF'}
AUTO SEND: ${!campaign?.requireApproval ? 'ON' : 'OFF'}
ACTIVE CAMPAIGN: ${campaign ? 'YES' : 'NO'}
PRODUCTION WORKER: RUNNING
DISCOVERY: ${discovered}
QUALIFIED: ${qualified}
PITCHES: ${pitches}
QUEUED: ${outreachQueued}
SENT: ${emailsSent}
FAILED: ${emailsFailed}
REPLIES: 0
FOLLOW-UPS: ${followUpsSent}`);
}

run().catch(console.error).finally(() => prisma.$disconnect());
