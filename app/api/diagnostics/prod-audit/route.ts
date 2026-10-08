import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getQueue } from "@/lib/queues";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const campaigns = await prisma.campaign.findMany({
      include: { emailAccount: true }
    });

    const pitches = await prisma.outreachMessage.findMany({
      where: { state: { in: ["DRAFT", "PENDING_APPROVAL"] } },
      select: { id: true, state: true, campaignId: true, prospectId: true, contact: { select: { email: true, suppressed: true } } },
      take: 50
    });

    const backgroundJobs = await prisma.backgroundJob.findMany({
      where: { queue: "outreach" },
      orderBy: { createdAt: "desc" },
      take: 20
    });

    const queue = getQueue("outreach");
    const active = await queue.getActive();
    const waiting = await queue.getWaiting();
    const failed = await queue.getFailed();
    const delayed = await queue.getDelayed();

    const gmailAccount = await prisma.emailAccount.findFirst({
      where: { provider: "GMAIL" }
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
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
