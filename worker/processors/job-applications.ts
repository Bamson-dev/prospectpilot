import { prisma } from "@/lib/db";
import { logInfo } from "@/lib/logger";
import { queueJob, recordActivity } from "@/lib/jobs";
import { enqueue } from "@/lib/queues";
import { applicationAutomationEnabled, applicationLiveSubmitEnabled, applicationMode, jobApplicationEmailEnabled, jobDiscoveryEnabled } from "@/lib/applications/config";
import { titleMatchesTargetRoles } from "@/lib/applications/job-queries";
import { classifyMarketingRole, isMarketingQuery, marketingSearchQueries, withTimestamp } from "@/lib/applications/marketing-scope";
import { excludeApplication, excludeVacancy } from "@/lib/applications/scope-enforce";
import { emailFitAllowed, emailPackageBlockers, sendEmailApplication } from "@/lib/applications/email-apply";
import { findApplicationEmail } from "@/lib/applications/email-route";
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
    
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    
    // Check if we have an ACTIVE run (STARTED or RUNNING) OR a run completed in the last 3 hours
    const existingRun = await prisma.jobDiscoveryRun.findFirst({
      where: { 
        organizationId, 
        candidateId: pref.candidate.id, 
        OR: [
          { status: { in: ["STARTED", "RUNNING"] } },
          { startedAt: { gte: threeHoursAgo } }
        ]
      }
    });
    
    if (existingRun) {
      logInfo("scheduler.job_discovery.skip", { organizationId, reason: "Recent or active run exists", existingId: existingRun.id });
      continue;
    }

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
  const locations = pref?.remoteOnly ? ["remote"] : (pref?.locations?.length ? pref.locations : ["Lagos", "Nigeria", "remote", "international"]);
  const dailyTarget = pref?.dailyTarget ?? 500;
  
  const expandedQueries = new Set<string>();

  // Marketing only. Queries come from the candidate's saved marketing titles, or the approved marketing list.
  // A manual query that is not a marketing title is refused.
  if (manualQuery) {
    if (isMarketingQuery(manualQuery)) expandedQueries.add(manualQuery.toLowerCase().trim());
    else logInfo("job_discovery.query_refused", { organizationId, query: manualQuery.slice(0, 80), reason: "not a marketing title" });
  } else {
    for (const query of marketingSearchQueries(run.candidate.targetRoles)) expandedQueries.add(query);
  }
  if (expandedQueries.size === 0) {
    await prisma.jobDiscoveryRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: new Date(), queries: 0 } });
    return emptySummary();
  }

  const limitPerQuery = manualLimit || Math.min(50, Math.ceil(dailyTarget / expandedQueries.size));
  
  let totalQueries = 0;
  let totalRawResults = 0;
  let totalValidVacancies = 0;
  let totalDuplicates = 0;
  let totalNewVacancies = 0;
  let totalRejectedVacancies = 0;
  let totalOutOfScope = 0;
  const outOfScopeSamples: string[] = [];
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
        const collected = await collectPublicVacancies({ query, location: loc, limit: limitPerQuery });
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
        totalRejectedVacancies += prepared.invalidSources.length + prepared.outOfScope.length;
        totalOutOfScope += prepared.outOfScope.length;
        for (const item of prepared.outOfScope) if (outOfScopeSamples.length < 5) outOfScopeSamples.push(`${item.job.title}: ${item.verdict.reason}`.slice(0, 140));
        
        // Rejected roles are saved too, as REJECTED records with their reason. They are never queued.
        const saved = await persistNormalizedVacancies(organizationId, [...capped, ...prepared.outOfScope.map((item) => item.job)]);
        
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
      retrieved: totalRawResults,
      acceptedMarketing: totalValidVacancies,
      rejectedNotMarketing: totalOutOfScope,
      duplicates: totalDuplicates,
      newVacancies: totalNewVacancies,
      qualificationJobsQueued: totalQualificationJobsQueued,
      rateLimitHit,
      scopeVersion: 1,
      rejectedSamples: outOfScopeSamples,
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
  // Marketing only. Old queue jobs and legacy records stop here without creating a package.
  const target = await prisma.jobVacancy.findFirst({ where: { id: vacancyId, organizationId }, select: { id: true, title: true, description: true, rawData: true } });
  if (target) {
    const verdict = withTimestamp(classifyMarketingRole({ title: target.title, description: target.description }));
    if (!verdict.inScope) {
      await excludeVacancy(organizationId, target, verdict);
      const stale = await prisma.jobApplication.findMany({ where: { organizationId, vacancyId }, select: { id: true } });
      for (const item of stale) await excludeApplication(item.id, verdict);
      logInfo("application.not_marketing", { vacancyId, reason: verdict.reason });
      return;
    }
  }
  const applicationId = await prepareApplication(organizationId, vacancyId, forceRegenerate);
  await attachBrowserInspection(applicationId);
  const submitted = await prisma.jobApplication.findFirst({
    where: { id: applicationId, organizationId },
    select: { submittedAt: true, status: true, emailSentAt: true },
  });
  // A sent email application is finished. Re-running preparation must not touch it.
  if (submitted?.emailSentAt || submitted?.status === "VERIFIED") return;
  if (submitted?.submittedAt || submitted?.status === "SUBMITTED" || submitted?.status === "SUBMITTING") {
    await prisma.jobApplication.update({
      where: { id: applicationId },
      data: { submittedAt: null, status: "REQUIRES_MANUAL_ACTION", blockedReason: "Preparation must not submit." },
    });
    return; // Don't enqueue browser for manual action
  }
  
  const prepared = await prisma.jobApplication.findFirst({
    where: { id: applicationId, organizationId },
    include: { package: true, vacancy: true, candidate: { select: { targetRoles: true } } },
  });
  if (!prepared) return;
  const eligible = prepared.status !== "FAILED"
    && Boolean(prepared.cvId && prepared.coverLetterId)
    && emailFitAllowed(prepared.package?.strategy)
    && titleMatchesTargetRoles(prepared.vacancy.title, prepared.candidate.targetRoles)
    && emailPackageBlockers(prepared.package?.warnings ?? []).length === 0;
  if (!eligible) {
    logInfo("application.not_queued", { applicationId, status: prepared.status, strategy: prepared.package?.strategy ?? null });
    return;
  }
  const route = findApplicationEmail({
    description: prepared.vacancy.description,
    companyName: prepared.vacancy.companyName,
    companyDomain: prepared.vacancy.companyDomain,
    applicationUrl: prepared.vacancy.applicationUrl,
    sourceUrl: prepared.vacancy.sourceUrl,
  });
  const useEmail = route.found && jobApplicationEmailEnabled();
  try {
    await queueJob({
      id: useEmail ? `application-submit:${applicationId}` : `browser:${applicationId}`,
      organizationId,
      queue: useEmail ? "application-submit" : "application-browser",
      name: useEmail ? "submit" : "run",
      payload: { organizationId, applicationId },
    });
    logInfo("application.queued", { applicationId, route: useEmail ? "EMAIL" : "FORM" });
  } catch {
    // Ignore if job already queued (unique constraint)
  }
}

export async function processApplicationSubmit(organizationId: string, applicationId: string) {
  const application = await prisma.jobApplication.findUnique({ where: { id: applicationId }, include: { vacancy: { select: { title: true, description: true } } } });
  if (!application || application.organizationId !== organizationId) return;
  // Final gate. Nothing that is not a marketing role is sent, whatever put it in the queue.
  const scope = classifyMarketingRole({ title: application.vacancy.title, description: application.vacancy.description });
  if (!scope.inScope) {
    await excludeApplication(application.id, scope);
    logInfo("application.submit_blocked_not_marketing", { applicationId, reason: scope.reason });
    return;
  }
  if (!applicationAutomationEnabled() || !applicationLiveSubmitEnabled() || applicationMode() !== "AUTO_SUBMIT") {
    await prisma.jobApplication.update({
      where: { id: application.id },
      // Stays READY_TO_SUBMIT so the hourly scan sends it once live submission is enabled. Nothing is sent while the flag is off.
      data: { status: "READY_TO_SUBMIT", blockedReason: "Automatic submission is disabled." },
    });
    await prisma.applicationEvent.create({
      data: { applicationId: application.id, type: "MANUAL_ACTION_REQUIRED", detail: "Automatic submission is disabled." },
    });
    return;
  }
  
  // Email is the employer's route when the posting names an application address.
  const emailResult = await sendEmailApplication(applicationId);
  logInfo("application.email_result", { applicationId, outcome: emailResult.outcome });
  if (emailResult.outcome !== "NO_EMAIL_ROUTE" && emailResult.outcome !== "DISABLED") return;

  // Otherwise the official form. A CAPTCHA is recorded as a blocker and is never solved here.
  await attachBrowserInspection(applicationId, { allowSubmit: true });
}

export async function processApplicationFollowUp(organizationId: string) {
  const due = await prisma.applicationFollowUp.findMany({
    where: { status: "DRAFT", runAt: { lte: new Date() }, application: { organizationId } },
    take: 20,
  });
  logInfo("application.followups_waiting", { organizationId, count: due.length });
}
