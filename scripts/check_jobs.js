const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const jobs = await prisma.backgroundJob.findMany({ where: { queue: 'outreach', state: 'QUEUED' } });
  console.log("QUEUED jobs:", jobs.length);
  for (const j of jobs) {
    const msg = await prisma.outreachMessage.findFirst({ where: { prospectId: j.prospectId } });
    console.log(j.id, "msg state:", msg ? msg.state : 'null');
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
