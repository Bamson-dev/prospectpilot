import { Worker } from "bullmq";
import { prisma } from "@/lib/db";
import { logInfo } from "@/lib/logger";
import { ipv4Get } from "@/lib/search/ipv4";
import { getQueue, getRedis } from "@/lib/queues";
import { processDiscovery } from "@/worker/processors/discovery";
import { processDueFollowUps, processReply } from "@/worker/processors/follow-up";
import { processInboxSync } from "@/worker/processors/inbox";
import { processOutreach } from "@/worker/processors/outreach";
import { processQualification } from "@/worker/processors/qualification";
import { processResearch } from "@/worker/processors/research";
import { runJob } from "@/worker/runtime";

const connection = getRedis();

function start(name: string, handler: (data: Record<string, string>) => Promise<void>) {
  const worker = new Worker(
    name,
    async (job) => {
      const data = job.data as Record<string, string>;
      await runJob(data.jobId, () => handler(data));
    },
    { connection, concurrency: name === "research" ? 1 : 2 },
  );
  worker.on("failed", (job, error) => {
    logInfo("worker.job_failed", { queue: name, jobId: job?.id, message: error.message });
  });
  return worker;
}

start("discovery", async (data) => {
  if (!data.campaignId) throw new Error("Discovery job is missing a campaign.");
  await processDiscovery(data.campaignId);
});

start("research", async (data) => {
  if (!data.prospectId) throw new Error("Research job is missing a prospect.");
  await processResearch(data.prospectId);
});

start("qualification", async (data) => {
  if (!data.prospectId) throw new Error("Qualification job is missing a prospect.");
  await processQualification(data.prospectId);
});

start("ai", async (data) => {
  if (!data.prospectId) throw new Error("AI job is missing a prospect.");
  await processQualification(data.prospectId);
});

start("outreach", async (data) => {
  const messageId = typeof data.messageId === "string" && data.messageId ? data.messageId : readPayload(data, "messageId");
  if (!messageId) throw new Error("Outreach job is missing a message.");
  await processOutreach(messageId);
});

start("inbox-sync", async (data) => {
  if (!data.organizationId) throw new Error("Inbox sync is missing an organization.");
  await processInboxSync(data.organizationId);
});

start("reply-analysis", async (data) => {
  const replyId = readPayload(data, "replyId");
  if (!replyId) throw new Error("Reply analysis is missing a reply.");
  await processReply(replyId);
});

const followUps = new Worker(
  "follow-up",
  async (job) => {
    if (job.name === "scan") {
      const due = await prisma.followUp.findMany({
        where: { state: "SCHEDULED", runAt: { lte: new Date() } },
        distinct: ["organizationId"],
        select: { organizationId: true },
      });
      for (const row of due) await processDueFollowUps(row.organizationId);
      return;
    }
    const data = job.data as Record<string, string>;
    await runJob(data.jobId, async () => {
      if (!data.organizationId) throw new Error("Follow-up job is missing an organization.");
      await processDueFollowUps(data.organizationId);
    });
  },
  { connection, concurrency: 1 },
);
followUps.on("failed", (job, error) => {
  logInfo("worker.job_failed", { queue: "follow-up", jobId: job?.id, message: error.message });
});

void getQueue("follow-up")
  .add("scan", {}, { repeat: { every: 15 * 60 * 1000 }, jobId: "follow-up-scan" })
  .catch((error: unknown) => {
    logInfo("worker.follow_up_schedule_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  });

function readPayload(data: Record<string, string>, key: string) {
  if (data[key]) return data[key];
  return "";
}

logInfo("worker.started", { queues: ["discovery", "research", "qualification", "ai", "outreach", "inbox-sync", "reply-analysis", "follow-up"] });

void ipv4Get(new URL("https://api.ipify.org"), 8000)
  .then((result) => {
    const ip = result.body.trim();
    if (result.status === 200 && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) logInfo("worker.outbound_ipv4", { ip });
    else logInfo("worker.outbound_ipv4_failed", { status: result.status });
  })
  .catch((error: unknown) => {
    logInfo("worker.outbound_ipv4_failed", { message: error instanceof Error ? error.message : "unavailable" });
  });
