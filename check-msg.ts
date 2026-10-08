import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const msg = await prisma.outreachMessage.findFirst({ where: { prospectId: 'cmulrmt9z00jkmr0vjqwbrxlv' } });
  console.log("MSG:", msg?.state, msg?.error, msg?.sentAt);
}
main();
