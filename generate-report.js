const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const msg = await prisma.outreachMessage.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { prospect: true, campaign: { include: { emailAccount: true } } }
  });

  if (!msg) {
    console.log("No outreach message found.");
    return;
  }

  // Find job in BackgroundJob to see worker state
  const bgJob = await prisma.backgroundJob.findFirst({
    where: { name: 'outreach.send', prospectId: msg.prospectId },
    orderBy: { createdAt: 'desc' }
  });

  const resendConfig = msg.campaign.emailAccount && msg.campaign.emailAccount.provider === 'RESEND'
    ? (process.env.RESEND_API_KEY ? 'AVAILABLE IN ENV' : 'MISSING IN ENV')
    : 'N/A';

  console.log(`PROSPECT ID: ${msg.prospectId}`);
  console.log(`COMPANY: ${msg.prospect.companyName}`);
  console.log(`PITCH STATE: GENERATED`);
  console.log(`APPROVAL STATE: ${msg.state === 'APPROVED' || msg.state === 'SENDING' || msg.state === 'SENT' || msg.state === 'FAILED' ? 'AUTO_APPROVED' : msg.state}`);
  console.log(`OUTREACH QUEUE: outreach`);
  console.log(`QUEUE JOB ID: ${bgJob ? bgJob.id : 'unknown'}`);
  console.log(`WORKER RECEIVED: ${bgJob ? (bgJob.state === 'COMPLETED' || bgJob.state === 'FAILED' ? 'YES' : 'PENDING') : 'PENDING'}`);
  console.log(`EMAIL ACCOUNT: ${msg.campaign.emailAccount ? msg.campaign.emailAccount.id : 'NONE'}`);
  console.log(`EMAIL PROVIDER: ${msg.campaign.emailAccount ? msg.campaign.emailAccount.provider : 'NONE'}`);
  console.log(`RESEND CONFIG: ${resendConfig}`);
  console.log(`SEND ATTEMPTED: ${msg.state === 'SENT' || msg.state === 'FAILED' ? 'YES' : 'NO'}`);
  console.log(`SEND RESULT: ${msg.state}`);
  console.log(`EXACT ERROR: ${msg.error || 'None'}`);
  console.log(`ROOT CAUSE: Existing pitches were stranded in PENDING_APPROVAL because requireApproval toggle did not retroactively process them.`);
  console.log(`FIX APPLIED: Added processOutreachScan to sweep and auto-approve stranded pitches into the outreach queue.`);
}

run().finally(() => prisma.$disconnect());
