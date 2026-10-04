import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeAdmin } from "../route";

export const dynamic = "force-dynamic";

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorizeAdmin(request);
    if (!auth) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await props.params;
    
    const run = await prisma.jobDiscoveryRun.findUnique({
      where: { id, organizationId: auth.organization.id }
    });

    if (!run) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: run.id,
      status: run.status,
      provider: "SearXNG",
      queries: run.queries,
      rawResults: run.rawResults,
      validVacancies: run.validVacancies,
      newVacancies: run.newVacancies,
      duplicates: run.duplicates,
      rateLimits: run.rateLimits,
      qualificationJobsQueued: run.qualificationJobsQueued,
      error: run.error,
      completedAt: run.completedAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
