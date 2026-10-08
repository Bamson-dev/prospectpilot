import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeAdmin } from "../discovery/route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdmin(request);
  if (!auth) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const prospects = await prisma.prospect.findMany({
    where: {
      organizationId: auth.organization.id,
      qualificationStatus: "QUALIFIED",
      NOT: { recommendedService: null },
    },
    include: {
      contacts: { orderBy: { isPrimary: "desc" }, take: 1 },
      research: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 10,
  });

  return NextResponse.json(prospects, { headers: { "Cache-Control": "no-store" } });
}
