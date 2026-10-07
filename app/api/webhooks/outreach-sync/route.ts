import { NextResponse } from "next/server";
import { processOutreachScan } from "@/worker/processors/outreach-scan";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await processOutreachScan();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const messages = await prisma.outreachMessage.findMany({
      include: {
        contact: true
      }
    });

    const jobs = await prisma.backgroundJob.findMany({
      where: { name: "outreach.send" }
    });
    
    // Group states
    const states = messages.reduce((acc, msg) => {
      acc[msg.state] = (acc[msg.state] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Jobs
    const jobStates = jobs.reduce((acc, job) => {
      acc[job.state] = (acc[job.state] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const sent = messages.filter(m => m.state === 'SENT');
    const sentDomain = sent.length > 0 && sent[0].contact?.email ? sent[0].contact.email.split('@')[1] : null;

    const failed = messages.filter(m => m.state === 'FAILED');
    const failedError = failed.length > 0 ? failed[0].error : null;

    return NextResponse.json({
      states,
      jobStates,
      sentDomain,
      failedError
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
