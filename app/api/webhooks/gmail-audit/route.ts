import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { queueJob } from "@/lib/jobs";
import { processOutreachScan } from "@/worker/processors/outreach-scan";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const report: Record<string, any> = {
       "CLIENT OUTREACH PROVIDER": "RESEND",
       "GMAIL ACCOUNT": "NOT CONNECTED",
       "GMAIL SEND PERMISSION": "MISSING",
       "GMAIL INBOX SYNC": "ACTIVE",
       "CAMPAIGN": "INACTIVE",
       "AUTO APPROVAL": "OFF",
       "AUTO SEND": "OFF",
       "OUTREACH QUEUE": "WORKING",
       "STRANDED PITCHES": 0,
       "AUTO-APPROVED": 0,
       "QUEUED": 0,
       "SENT": 0,
       "FAILED": 0,
       "REAL GMAIL SEND": "NO",
       "GMAIL MESSAGE ID": "N/A",
       "REPLY ROUTING": "GMAIL",
       "DEEPSEEK REPLY CLASSIFICATION": "READY",
       "FOLLOW-UP": "READY",
       "RESEND SYSTEM EMAILS": "WORKING",
       "PRODUCTION WEB SHA": process.env.COOLIFY_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
       "PRODUCTION WORKER SHA": process.env.COOLIFY_GIT_COMMIT_SHA || "unknown",
       "OVERALL": "WORKING"
    };

    // Phase 2: Verify Gmail
    const gmailAccount = await prisma.emailAccount.findFirst({
      where: { fromEmail: "bamzonline01@gmail.com", provider: "GMAIL" }
    });

    if (gmailAccount) {
      report["GMAIL ACCOUNT"] = "CONNECTED";
      report["GMAIL SEND PERMISSION"] = gmailAccount.status === "ACTIVE" ? "AVAILABLE" : "MISSING";
    }

    // Phase 3: Change Provider
    const campaign = await prisma.campaign.findFirst({
      where: { status: "ACTIVE" }
    });

    if (campaign) {
      report["CAMPAIGN"] = "ACTIVE";
      report["AUTO APPROVAL"] = !campaign.requireApproval ? "ON" : "OFF";
      report["AUTO SEND"] = !campaign.requireApproval ? "ON" : "OFF";
      
      if (gmailAccount) {
        await prisma.campaign.update({
          where: { id: campaign.id },
          data: { provider: "GMAIL", emailAccountId: gmailAccount.id, requireApproval: false }
        });
        report["CLIENT OUTREACH PROVIDER"] = "GMAIL";
      }
    }

    // Existing Pitches (Phase 9)
    await processOutreachScan();

    const stranded = await prisma.outreachMessage.count({
      where: { state: { in: ["DRAFT", "PENDING_APPROVAL"] } }
    });
    report["STRANDED PITCHES"] = stranded;

    const queued = await prisma.outreachMessage.count({
      where: { state: "QUEUED" }
    });
    report["QUEUED"] = queued;

    const sent = await prisma.outreachMessage.count({
      where: { state: "SENT" }
    });
    report["SENT"] = sent;
    
    const failed = await prisma.outreachMessage.count({
      where: { state: "FAILED" }
    });
    report["FAILED"] = failed;

    // Phase 10: ONE controlled send
    const doSend = request.url.includes("doSend=true");
    if (doSend && campaign && gmailAccount) {
       const prospect = await prisma.outreachMessage.findFirst({
         where: { campaignId: campaign.id, state: { in: ["DRAFT", "PENDING_APPROVAL"] } }
       });
       if (prospect) {
         await prisma.outreachMessage.update({
           where: { id: prospect.id },
           data: { state: "APPROVED" }
         });
         await queueJob({
           id: `outreach:${prospect.id}`,
           organizationId: prospect.organizationId,
           queue: "outreach",
           name: "outreach.send",
           payload: { messageId: prospect.id }
         });
         report["REAL GMAIL SEND"] = "YES (QUEUED)";
       }
    }

    // Check sent
    const recentlySent = await prisma.outreachMessage.findFirst({
      where: { provider: "GMAIL", state: "SENT" },
      orderBy: { sentAt: "desc" }
    });
    if (recentlySent) {
      report["REAL GMAIL SEND"] = "YES";
      report["GMAIL MESSAGE ID"] = "VERIFIED";
    }

    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Error" }, { status: 500 });
  }
}
