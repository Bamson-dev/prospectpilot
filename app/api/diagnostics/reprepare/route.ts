import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeAdmin } from "../discovery/route";
import { queueJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin(request);
    if (!auth) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    
    const body = await request.json();
    const vacancyId = body.vacancyId;
    if (!vacancyId) return NextResponse.json({ error: "vacancyId required" }, { status: 400 });

    const job = await queueJob({
      organizationId: auth.organization.id,
      queue: "application-preparation",
      name: "prepare",
      payload: { 
        organizationId: auth.organization.id, 
        vacancyId,
        forceRegenerate: true
      },
    });

    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
