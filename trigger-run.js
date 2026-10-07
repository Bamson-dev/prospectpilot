/* eslint-disable */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { Queue } = require('bullmq');

async function run() {
  const q = new Queue('discovery', { connection: { host: 'localhost', port: 6379 } });
  const campaign = await prisma.campaign.findFirst({ where: { status: 'ACTIVE' } });
  
  if (!campaign) throw new Error("No active campaign");

  const jobId = 'test-discovery-' + Date.now();
  await q.add('run', { campaignId: campaign.id }, { jobId });
  
  console.log(`Triggered discovery run with jobId: ${jobId}`);
}

run().catch(console.error).finally(() => prisma.$disconnect());
