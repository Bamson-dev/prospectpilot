import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/current-user";
import { selectOrganizationMembership } from "@/lib/organization-context";
import { roleAtLeast } from "@/lib/roles";
import { ensureCandidate } from "@/lib/applications/service";
import { queueJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function authorizeAdmin(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader === `Bearer ${process.env.AUTH_SECRET}`) {
    const adminUser = await prisma.user.findFirst({
      where: { memberships: { some: { role: "ADMIN" } } },
      orderBy: { createdAt: "desc" }
    });
    if (!adminUser) return null;
    const memberships = await prisma.membership.findMany({
      where: { userId: adminUser.id },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });
    const membership = selectOrganizationMembership(memberships, undefined);
    if (!membership) return null;
    return { user: adminUser, organization: membership.organization };
  }

  const session = await readSession();
  if (!session) return null;
  const memberships = await prisma.membership.findMany({
    where: { userId: session.sub },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
  const membership = selectOrganizationMembership(memberships, session.organizationId);
  if (!membership || !roleAtLeast(membership.role, "ADMIN")) return null;
  
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) return null;
  
  return { user, organization: membership.organization };
}

export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin(request);
    if (!auth) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { organization } = auth;
    
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 180) : "";
    if (query.length < 3) {
      return NextResponse.json({ error: "Query must be at least 3 characters" }, { status: 400 });
    }
    
    const limitNum = Number(body.limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 1) {
      return NextResponse.json({ error: "Diagnostic discovery limit must be exactly 1" }, { status: 400 });
    }
    
    const candidate = await ensureCandidate(organization.id);
    
    const run = await prisma.jobDiscoveryRun.create({
      data: {
        organizationId: organization.id,
        candidateId: candidate.id,
        status: "STARTED",
      },
    });

    await queueJob({
      organizationId: organization.id,
      queue: "job-discovery",
      name: "search",
      payload: { 
        organizationId: organization.id, 
        runId: run.id, 
        query, 
        limit: "1" 
      },
    });

    return NextResponse.json({ ok: true, runId: run.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
