import { prisma } from "@/lib/db";
import { logInfo } from "@/lib/logger";
import { queueJob, recordActivity } from "@/lib/jobs";
import { enqueue } from "@/lib/queues";
import { applicationAutomationEnabled, applicationMode, jobDiscoveryEnabled } from "@/lib/applications/config";
import { collectPublicVacancies } from "@/lib/applications/job-sources";
import { isApplicationAccessible } from "@/lib/discovery/health";
import { analysisJobDecision, emptySummary, prepareDiscoveredVacancies } from "@/lib/applications/job-pipeline";
import { attachBrowserInspection } from "@/lib/applications/public-inspection";
import { persistNormalizedVacancies, prepareApplication, archiveStaleVacancies } from "@/lib/applications/service";

export async function processJobDiscoveryScheduler() {
  const preferences = await prisma.candidatePreference.findMany({
    where: { discoverJobs: true },
    include: { candidate: { include: { profiles: true } } },
  });
  
  for (const pref of preferences) {
    if (!pref.candidate.profiles.length) continue;
    const organizationId = pref.candidate.organizationId;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existingRun = await prisma.jobDiscoveryRun.findFirst({
      where: { organizationId, candidateId: pref.candidate.id, startedAt: { gte: today } }
    });
    if (existingRun) continue;

    // Create the daily run model
    const run = await prisma.jobDiscoveryRun.create({
      data: {
        organizationId,
        candidateId: pref.candidate.id,
        status: "STARTED",
      }
    });

    // Enqueue a single job-discovery task for this run
    await queueJob({
      id: `discovery:run:${run.id}`,
      organizationId,
      queue: "job-discovery",
      name: "run",
      payload: { organizationId, runId: run.id },
    }).catch(() => { /* ignore unique constraint on id */ });
  }
}

export async function processJobDiscovery(organizationId: string, runId: string, manualQuery?: string, manualLimit?: number) {
  if (!jobDiscoveryEnabled()) {
    logInfo("job_discovery.disabled", { organizationId });
    return emptySummary();
  }
  
  const run = await prisma.jobDiscoveryRun.findUnique({
    where: { id: runId },
    include: { candidate: { include: { profiles: true, preference: true } } }
  });
  if (!run || !run.candidate) return;

  await prisma.jobDiscoveryRun.update({
    where: { id: run.id },
    data: { status: "RUNNING" }
  });

  const pref = run.candidate.preference;
  const locations = pref?.remoteOnly ? ["remote"] : (pref?.locations?.length ? pref.locations : ["remote"]);
  const dailyTarget = pref?.dailyTarget ?? 500;
  
  const expandedQueries = new Set<string>();

  if (manualQuery) {
    expandedQueries.add(manualQuery);
  } else {
    const queries = new Set<string>();
    for (const profile of run.candidate.profiles) {
      const baseTitle = profile.title.toLowerCase().trim();
      queries.add(baseTitle);
      
      if (baseTitle.includes("software") || baseTitle.includes("engineer") || baseTitle.includes("developer")) {
        queries.add("software engineer");
        queries.add("backend engineer");
        queries.add("full stack engineer");
      }
      if (baseTitle.includes("product manager")) {
        queries.add("product manager");
        queries.add("senior product manager");
      }
      if (baseTitle.includes("marketing")) {
        queries.add("growth marketing manager");
        queries.add("performance marketing manager");
        queries.add("product marketing manager");
      }
      if (baseTitle.includes("founder")) {
        queries.add("founder");
        queries.add("technical product");
      }
    }
    for (const query of queries) {
      expandedQueries.add(`${query} site:ashbyhq.com`);
      expandedQueries.add(`${query} site:jobs.workable.com`);
      expandedQueries.add(`${query} site:jobs.smartrecruiters.com`);
      expandedQueries.add(`${query} site:greenhouse.io`);
      expandedQueries.add(`${query} site:lever.co`);
      expandedQueries.add(query); // direct employer career pages
    }
  }

  const limitPerQuery = manualLimit || Math.min(50, Math.ceil(dailyTarget / expandedQueries.size));
  
  let totalQueries = 0;
  let totalRawResults = 0;
  let totalValidVacancies = 0;
  let totalDuplicates = 0;
  let totalNewVacancies = 0;
  let totalRejectedVacancies = 0;
  let totalProviderErrors = 0;
  let totalRateLimits = 0;
  let totalQualificationJobsQueued = 0;
  let rateLimitHit = false;

  for (const query of expandedQueries) {
    for (const loc of locations) {
      if (rateLimitHit) break;
      const fullQuery = `${query} ${loc}`.trim();
      totalQueries += 1;

      try {
        const collected = await collectPublicVacancies({ query: fullQuery, limit: limitPerQuery });
        totalRawResults += collected.jobs.length;
        
        // Count errors
        const failures = collected.failures.filter((failure) => failure.reason !== "not configured");
        totalProviderErrors += failures.length;
        
        const rateLimitFailure = failures.find(f => f.reason.includes("429") || f.reason.includes("rate limit"));
        if (rateLimitFailure) {
          totalRateLimits += 1;
          rateLimitHit = true;
          // We don't throw, we process what we collected, then break the loop.
        }
        
        const prepared = prepareDiscoveredVacancies(collected.jobs, fullQuery);
        
        const accessibleJobs = [];
        for (const job of prepared.kept) {
          if (await isApplicationAccessible(job.applicationUrl, job.source)) {
            accessibleJobs.push(job);
          } else {
            prepared.invalidSources.push(job.title);
          }
        }
        
        const capped = accessibleJobs.slice(0, limitPerQuery);
        totalRejectedVacancies += prepared.invalidSources.length;
        
        const saved = await persistNormalizedVacancies(organizationId, capped);
        
        totalValidVacancies += capped.length;
        totalDuplicates += prepared.duplicateReasons.length + saved.duplicateReasons.length;
        totalNewVacancies += saved.ids.length; // Approximate "new" - actually they might be updated too. We'll just count as new for now.
        
        for (const id of saved.ids) {
          await queueVacancyAnalysis(organizationId, id);
          totalQualificationJobsQueued += 1;
        }
      } catch (err) {
        logInfo("job_discovery.error", { organizationId, query: fullQuery, error: String(err) });
        totalProviderErrors += 1;
      }
    }
  }

  await archiveStaleVacancies(organizationId);

  await prisma.jobDiscoveryRun.update({
    where: { id: run.id },
    data: {
      status: rateLimitHit ? "PARTIALLY_COMPLETED" : "COMPLETED",
      completedAt: new Date(),
      queries: totalQueries,
      rawResults: totalRawResults,
      validVacancies: totalValidVacancies,
      duplicates: totalDuplicates,
      newVacancies: totalNewVacancies,
      rejectedVacancies: totalRejectedVacancies,
      providerErrors: totalProviderErrors,
      rateLimits: totalRateLimits,
      qualificationJobsQueued: totalQualificationJobsQueued,
    }
  });

  await recordActivity({
    organizationId,
    action: "job.discovery_run_completed",
    detail: JSON.stringify({
      runId: run.id,
      queries: totalQueries,
      newVacancies: totalNewVacancies,
      qualificationJobsQueued: totalQualificationJobsQueued,
      rateLimitHit,
    }).slice(0, 2000),
  });

  if (rateLimitHit) {
    throw new Error("Rate limit reached during discovery run. Retrying via backoff.");
  }
}

export async function queueVacancyAnalysis(organizationId: string, vacancyId: string) {
  const id = `analysis:${organizationId}:${vacancyId}`;
  const existing = await prisma.backgroundJob.findUnique({ where: { id } });
  const decision = analysisJobDecision(existing?.state ?? null);
  if (decision === "skip") return id;
  if (decision === "retry" && existing) {
    await prisma.backgroundJob.update({ where: { id }, data: { state: "QUEUED", error: null, finishedAt: null } });
    await enqueue("job-analysis", `${id}:retry:${existing.attempts}`, { jobId: id, organizationId, vacancyId });
    return id;
  }
  const created = await queueJob({ id, organizationId, queue: "job-analysis", name: "analyze", payload: { organizationId, vacancyId } });
  return created.id;
}

export async function processApplicationPreparation(organizationId: string, vacancyId: string, forceRegenerate = false) {
  const applicationId = await prepareApplication(organizationId, vacancyId, forceRegenerate);
  await attachBrowserInspection(applicationId);
  const submitted = await prisma.jobApplication.findFirst({
    where: { id: applicationId, organizationId },
    select: { submittedAt: true, status: true },
  });
  if (submitted?.submittedAt || submitted?.status === "SUBMITTED" || submitted?.status === "SUBMITTING") {
    await prisma.jobApplication.update({
      where: { id: applicationId },
      data: { submittedAt: null, status: "REQUIRES_MANUAL_ACTION", blockedReason: "Preparation must not submit." },
    });
  }
}

export async function processApplicationSubmit(organizationId: string, applicationId: string) {
  const application = await prisma.jobApplication.findUnique({ where: { id: applicationId } });
  if (!application || application.organizationId !== organizationId) return;
  if (!applicationAutomationEnabled() || applicationMode() !== "AUTO_SUBMIT") {
    await prisma.jobApplication.update({
      where: { id: application.id },
      data: { status: "READY_FOR_REVIEW", blockedReason: "Automatic submission is disabled." },
    });
    await prisma.applicationEvent.create({
      data: { applicationId: application.id, type: "MANUAL_ACTION_REQUIRED", detail: "Automatic submission is disabled." },
    });
    return;
  }
  await prisma.jobApplication.update({
    where: { id: application.id },
    data: { status: "REQUIRES_MANUAL_ACTION", blockedReason: "Live submission stays off until a supported adapter run is explicitly started." },
  });
  await prisma.applicationEvent.create({
    data: { applicationId: application.id, type: "MANUAL_ACTION_REQUIRED", detail: "Live submission was not started." },
  });
}

export async function processApplicationFollowUp(organizationId: string) {
  const due = await prisma.applicationFollowUp.findMany({
    where: { status: "DRAFT", runAt: { lte: new Date() }, application: { organizationId } },
    take: 20,
  });
  logInfo("application.followups_waiting", { organizationId, count: due.length });
}
