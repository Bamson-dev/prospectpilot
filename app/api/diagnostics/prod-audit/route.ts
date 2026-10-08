import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getQueue } from "@/lib/queues";
import { authorizeAdmin } from "../discovery/route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdmin(request);
  if (!auth) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const campaigns = await prisma.campaign.findMany({
      where: { organizationId: auth.organization.id },
      include: {
        emailAccount: {
          select: {
            id: true,
            provider: true,
            fromEmail: true,
            fromName: true,
            status: true,
            lastError: true,
            lastSendAt: true,
            lastSyncAt: true,
          },
        },
      },
    });

    const pitches = await prisma.outreachMessage.findMany({
      where: {
        organizationId: auth.organization.id,
        state: { in: ["DRAFT", "PENDING_APPROVAL"] },
      },
      select: { id: true, state: true, campaignId: true, prospectId: true, contact: { select: { email: true, suppressed: true } } },
      take: 50
    });

    const backgroundJobs = await prisma.backgroundJob.findMany({
      where: { organizationId: auth.organization.id, queue: "outreach" },
      orderBy: { createdAt: "desc" },
      take: 20
    });

    const queue = getQueue("outreach");
    const belongsToOrganization = (job: { data: unknown }) =>
      typeof job.data === "object" && job.data !== null &&
      "organizationId" in job.data && job.data.organizationId === auth.organization.id;
    const [activeJobs, waitingJobs, failedJobs, delayedJobs] = await Promise.all([
      queue.getActive(),
      queue.getWaiting(),
      queue.getFailed(),
      queue.getDelayed(),
    ]);
    const active = activeJobs.filter(belongsToOrganization);
    const waiting = waitingJobs.filter(belongsToOrganization);
    const failed = failedJobs.filter(belongsToOrganization);
    const delayed = delayedJobs.filter(belongsToOrganization);

    const gmailAccount = await prisma.emailAccount.findFirst({
      where: { organizationId: auth.organization.id, provider: "GMAIL" },
      select: {
        id: true,
        provider: true,
        fromEmail: true,
        fromName: true,
        status: true,
        lastError: true,
        lastSendAt: true,
        lastSyncAt: true,
      },
    });

    return NextResponse.json({
      campaigns,
      strandedPitches: pitches,
      backgroundJobs,
      bullmq: {
        active: active.map(j => ({ id: j.id, state: j.getState() })),
        waiting: waiting.map(j => ({ id: j.id, state: j.getState() })),
        failed: failed.map(j => ({ id: j.id, failedReason: j.failedReason })),
        delayed: delayed.map(j => ({ id: j.id }))
      },
      gmailAccount,
      env: {
        OUTREACH_SEND_ENABLED: process.env.OUTREACH_SEND_ENABLED,
        REDIS_URL: !!process.env.REDIS_URL,
        DATABASE_URL: !!process.env.DATABASE_URL
      }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
