import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const prospects = await prisma.prospect.findMany({
    where: {
      qualificationStatus: "QUALIFIED",
      NOT: { recommendedService: null },
    },
    include: {
      contacts: { orderBy: { isPrimary: "desc" }, take: 1 },
      research: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 10,
  });

  return NextResponse.json(prospects);
}
