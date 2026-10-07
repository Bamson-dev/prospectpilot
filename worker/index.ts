import { Worker } from "bullmq";
import { prisma } from "@/lib/db";
import { logInfo } from "@/lib/logger";
import { ipv4Get } from "@/lib/search/ipv4";
import { jobRetryDelayMs } from "@/lib/research/failure";
import { applicationWorkerConcurrency, applicationBrowserConcurrency } from "@/lib/applications/config";
import { getQueue, getRedis } from "@/lib/queues";
import { analyzeVacancy } from "@/lib/applications/service";
import { recoverStaleAutomationRuns, runApplicationAutomation } from "@/lib/applications/automation-service";
import { processApplicationFollowUp, processApplicationPreparation, processApplicationSubmit, processJobDiscovery, processJobDiscoveryScheduler } from "@/worker/processors/job-applications";
import { processCampaignDiscoveryScheduler, processDiscovery } from "@/worker/processors/discovery";
import { processDueFollowUps, processReply } from "@/worker/processors/follow-up";
import { processInboxSync, processEmployerReply } from "@/worker/processors/inbox";
import { processOutreach } from "@/worker/processors/outreach";
import { processOutreachScan } from "@/worker/processors/outreach-scan";
import { processQualification } from "@/worker/processors/qualification";
import { processResearch } from "@/worker/processors/research";
import { runJob } from "@/worker/runtime";

const connection = getRedis();

function concurrency(name: string) {
  if (name === "application-browser") {
    return applicationBrowserConcurrency();
  }
  if (name.startsWith("job-") || name.startsWith("application-") || name === "cv-generation" || name === "cover-letter") {
    return applicationWorkerConcurrency();
  }
  const configured = Number(
    name === "discovery" ? process.env.DISCOVERY_CONCURRENCY
      : name === "research" ? process.env.CRAWL_CONCURRENCY
        : name === "playwright-research" ? process.env.PLAYWRIGHT_CONCURRENCY
          : name === "qualification" || name === "ai" ? process.env.QUALIFICATION_CONCURRENCY
            : 2,
  );
  const fallback = name === "playwright-research" ? 1 : 4;
  const cap = name === "playwright-research" ? 3 : name === "discovery" ? 10 : name === "qualification" ? 20 : 10;
  if (!Number.isFinite(configured) || configured < 1) return fallback;
  return Math.min(Math.floor(configured), cap);
}

function start(name: string, handler: (data: Record<string, string>) => Promise<void>) {
  const worker = new Worker(
    name,
    async (job) => {
      const data = job.data as Record<string, string>;
      await runJob(data.jobId, () => handler(data));
    },
    { connection, concurrency: concurrency(name), settings: { backoffStrategy: retryBackoff } },
  );
  worker.on("failed", (job, error) => {
    logInfo("worker.job_failed", { queue: name, jobId: job?.id, message: error.message });
  });
  return worker;
}

const discoveryWorker = new Worker(
  "discovery",
  async (job) => {
    if (job.name === "scan") {
      await processCampaignDiscoveryScheduler();
      return;
    }
    const data = job.data as Record<string, string>;
    await runJob(data.jobId, async () => {
      if (!data.campaignId) throw new Error("Discovery job is missing a campaign.");
      await processDiscovery(data.campaignId);
    });
  },
  { connection, concurrency: concurrency("discovery"), settings: { backoffStrategy: retryBackoff } }
);
discoveryWorker.on("failed", (job, error) => {
  logInfo("worker.job_failed", { queue: "discovery", jobId: job?.id, message: error.message });
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

const outreachWorker = new Worker(
  "outreach",
  async (job) => {
    if (job.name === "scan") {
      await processOutreachScan();
      return;
    }
    const data = job.data as Record<string, string>;
    await runJob(data.jobId, async () => {
      const messageId = typeof data.messageId === "string" && data.messageId ? data.messageId : readPayload(data, "messageId");
      if (!messageId) throw new Error("Outreach job is missing a message.");
      await processOutreach(messageId);
    });
  },
  { connection, concurrency: concurrency("outreach"), settings: { backoffStrategy: retryBackoff } }
);
outreachWorker.on("failed", (job, error) => {
  logInfo("worker.job_failed", { queue: "outreach", jobId: job?.id, message: error.message });
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

start("employer-reply", async (data) => {
  const replyId = readPayload(data, "replyId");
  if (!replyId) throw new Error("Employer reply analysis is missing a reply.");
  await processEmployerReply(replyId);
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
  { connection, concurrency: 1, settings: { backoffStrategy: retryBackoff } },
);
followUps.on("failed", (job, error) => {
  logInfo("worker.job_failed", { queue: "follow-up", jobId: job?.id, message: error.message });
});

const jobDiscoveryWorker = new Worker(
  "job-discovery",
  async (job) => {
    if (job.name === "scan") {
      await processJobDiscoveryScheduler();
      return;
    }
    const data = job.data as Record<string, string>;
    await runJob(data.jobId, async () => {
      if (!data.organizationId) throw new Error("Job discovery is missing an organization.");
      await processJobDiscovery(data.organizationId, data.runId, data.query, data.limit ? parseInt(data.limit, 10) : undefined);
    });
  },
  { connection, concurrency: concurrency("job-discovery"), settings: { backoffStrategy: retryBackoff } }
);
jobDiscoveryWorker.on("failed", (job, error) => {
  logInfo("worker.job_failed", { queue: "job-discovery", jobId: job?.id, message: error.message });
});

for (const name of ["job-analysis", "job-fit"] as const) {
  start(name, async (data) => {
    if (!data.organizationId || !data.vacancyId) throw new Error("Application job is missing its target.");
    await analyzeVacancy(data.organizationId, data.vacancyId);
  });
}

for (const name of ["cv-generation", "cover-letter", "application-preparation", "application-verification"] as const) {
  start(name, async (data) => {
    if (!data.organizationId || !data.vacancyId) throw new Error("Application job is missing its target.");
    await processApplicationPreparation(data.organizationId, data.vacancyId, data.forceRegenerate === "true");
  });
}

start("application-submit", async (data) => {
  if (!data.organizationId || !data.applicationId) throw new Error("Application submit job is missing an application.");
  await processApplicationSubmit(data.organizationId, data.applicationId);
});

const applicationFollowUps = new Worker(
  "application-followup",
  async (job) => {
    if (job.name === "scan") {
      const due = await prisma.applicationFollowUp.findMany({
        where: { status: "DRAFT", runAt: { lte: new Date() } },
        distinct: ["applicationId"],
        select: { application: { select: { organizationId: true } } },
      });
      const seen = new Set<string>();
      for (const row of due) {
        if (seen.has(row.application.organizationId)) continue;
        seen.add(row.application.organizationId);
        await processApplicationFollowUp(row.application.organizationId);
      }
      return;
    }
    const data = job.data as Record<string, string>;
    await runJob(data.jobId, async () => {
      if (!data.organizationId) throw new Error("Application follow-up is missing an organization.");
      await processApplicationFollowUp(data.organizationId);
    });
  },
  { connection, concurrency: 1, settings: { backoffStrategy: retryBackoff } },
);
applicationFollowUps.on("failed", (job, error) => {
  logInfo("worker.job_failed", { queue: "application-followup", jobId: job?.id, message: error.message });
});

const applicationBrowser = new Worker(
  "application-browser",
  async (job) => {
    if (job.name === "recover") {
      await recoverStaleAutomationRuns();
      return;
    }
    const data = job.data as Record<string, string>;
    await runJob(data.jobId, async () => {
      if (!data.applicationId) throw new Error("Application browser job is missing an application.");
      await runApplicationAutomation(data.applicationId);
    });
  },
  { connection, concurrency: concurrency("application-browser"), settings: { backoffStrategy: retryBackoff } },
);
applicationBrowser.on("failed", (job, error) => {
  logInfo("worker.job_failed", { queue: "application-browser", jobId: job?.id, message: error.message });
});

void getQueue("application-browser")
  .add("recover", {}, { repeat: { every: 15 * 60 * 1000 }, jobId: "application-browser-recover" })
  .catch((error: unknown) => {
    logInfo("worker.application_browser_schedule_failed", { message: error instanceof Error ? error.message : "unknown" });
  });

void getQueue("application-followup")
  .add("scan", {}, { repeat: { every: 60 * 60 * 1000 }, jobId: "application-followup-scan" })
  .catch((error: unknown) => {
    logInfo("worker.application_followup_schedule_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  });

void getQueue("follow-up")
  .add("scan", {}, { repeat: { every: 15 * 60 * 1000 }, jobId: "follow-up-scan" })
  .catch((error: unknown) => {
    logInfo("worker.follow_up_schedule_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  });

void getQueue("outreach")
  .add("scan", {}, { repeat: { every: 15 * 60 * 1000 }, jobId: "outreach-scan" })
  .catch((error: unknown) => {
    logInfo("worker.outreach_schedule_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  });

void getQueue("job-discovery")
  .add("scan", {}, { repeat: { every: 2 * 60 * 60 * 1000 }, jobId: "job-discovery-scan" })
  .catch((error: unknown) => {
    logInfo("worker.job_discovery_schedule_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  });

void getQueue("discovery")
  .add("scan", {}, { repeat: { every: 3 * 60 * 60 * 1000 }, jobId: "discovery-scan" })
  .catch((error: unknown) => {
    logInfo("worker.discovery_schedule_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
  });

function retryBackoff(attemptsMade: number, _type?: string, err?: Error) {
  return jobRetryDelayMs(attemptsMade, err);
}

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
