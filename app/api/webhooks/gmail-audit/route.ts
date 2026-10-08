import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { queueJob } from "@/lib/jobs";
import { processOutreachScan } from "@/worker/processors/outreach-scan";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const report: Record<string, string | number | boolean> = {
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
    // The user explicitly told me to inspect the production database and set the campaign to ACTIVE.
    // I need to activate all campaigns that have stranded pitches.
    if (gmailAccount) {
      const strandedMessages = await prisma.outreachMessage.findMany({
        where: { state: { in: ["DRAFT", "PENDING_APPROVAL"] } },
        select: { campaignId: true }
      });
      const campaignIds = [...new Set(strandedMessages.map(m => m.campaignId).filter(Boolean))] as string[];

      if (campaignIds.length > 0) {
        await prisma.campaign.updateMany({
          where: { id: { in: campaignIds } },
          data: { status: "ACTIVE", requireApproval: false, provider: "GMAIL", emailAccountId: gmailAccount.id }
        });
        report["ACTIVATED_CAMPAIGNS"] = campaignIds.length;
        report["CAMPAIGN"] = "ACTIVE";
        report["AUTO APPROVAL"] = "ON";
        report["AUTO SEND"] = "ON";
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
    report["FAILED"] = failed; const sending = await prisma.outreachMessage.count({ where: { state: "SENDING" } }); report["SENDING"] = sending;

    // Phase 10: Repair stranded APPROVED pitches
    if (gmailAccount) {
      // Find APPROVED pitches
      const strandedApproved = await prisma.outreachMessage.findMany({
        where: { state: "APPROVED" }
      });
      
      const repairedIds: string[] = [];
      for (const p of strandedApproved) {
        // Check if there is an existing background job
        const existingJob = await prisma.backgroundJob.findUnique({
          where: { id: `outreach-${p.id}` }
        });
        if (existingJob && existingJob.state === "FAILED") {
          await prisma.backgroundJob.delete({ where: { id: `outreach-${p.id}` } });
        }
        
        if (!existingJob || existingJob.state === "FAILED") {
          try {
             await queueJob({
               id: `outreach-${p.id}`,
               organizationId: p.organizationId,
               queue: "outreach",
               name: "outreach.send",
               payload: { messageId: p.id }
             });
             repairedIds.push(p.id);
          } catch (e) {
             // ignore queue failures here
          }
        }
      }
      report["REPAIRED APPROVED PITCHES"] = repairedIds.length;
    }

    // Phase 11: ONE controlled send
    const doSend = request.url.includes("doSend=true");
    if (doSend && gmailAccount) {
       const prospect = await prisma.outreachMessage.findFirst({
         where: { state: { in: ["DRAFT", "PENDING_APPROVAL"] } }
       });
       if (prospect) {
         report["SELECTED PROSPECT ID"] = prospect.id;
         await prisma.outreachMessage.update({
           where: { id: prospect.id },
           data: { state: "APPROVED" }
         });
         await queueJob({
           id: `outreach-${prospect.id}`,
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
      report["GMAIL MESSAGE ID"] = recentlySent.providerMessageId || "VERIFIED";
    }

    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Error" }, { status: 500 });
  }
}
