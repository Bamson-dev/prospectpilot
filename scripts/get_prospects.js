const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const prospects = await prisma.prospect.findMany({
    where: { qualificationStatus: 'QUALIFIED', NOT: { recommendedService: null } },
    include: {
      contacts: { orderBy: { isPrimary: 'desc' }, take: 1 },
      research: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    take: 10,
  });
  console.log(JSON.stringify(prospects, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
