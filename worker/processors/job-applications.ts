import { prisma } from "@/lib/db";
import { logInfo } from "@/lib/logger";
import { queueJob, recordActivity } from "@/lib/jobs";
import { enqueue } from "@/lib/queues";
import { applicationAutomationEnabled, applicationMode, jobDiscoveryEnabled } from "@/lib/applications/config";
import { collectPublicVacancies } from "@/lib/applications/job-sources";
import { discoveryLimit } from "@/lib/applications/application-queue";
import { analysisJobDecision, emptySummary, prepareDiscoveredVacancies } from "@/lib/applications/job-pipeline";
import { attachBrowserInspection } from "@/lib/applications/public-inspection";
import { analyzeVacancy, persistNormalizedVacancies, prepareApplication } from "@/lib/applications/service";
import { statusAfterBlock } from "@/lib/applications/state";

export async function processJobDiscovery(organizationId: string, query: string, requestedLimit?: string) {
  if (!jobDiscoveryEnabled()) {
    logInfo("job_discovery.disabled", { organizationId });
    return emptySummary();
  }
  const started = Date.now();
  const collected = await collectPublicVacancies({ query, limit: discoveryLimit(requestedLimit) });
  const prepared = prepareDiscoveredVacancies(collected.jobs, query);
  const saved = await persistNormalizedVacancies(organizationId, prepared.kept);
  const summary = emptySummary();
  summary.discovered = collected.jobs.length;
  summary.normalized = prepared.normalized.length;
  summary.duplicatesRemoved = prepared.duplicateReasons.length + saved.duplicateReasons.length;
  summary.duplicateReasons = [...prepared.duplicateReasons, ...saved.duplicateReasons];
  summary.stored = saved.ids.length;
  summary.failed = prepared.failed + collected.failures.filter((failure) => failure.reason !== "not configured").length;
  summary.failures = collected.failures;
  summary.discoveryMs = Date.now() - started;
  for (const job of prepared.kept) summary.sources[job.source] = (summary.sources[job.source] ?? 0) + 1;
  const analysisStarted = Date.now();
  for (const id of saved.ids) {
    const assessed = await analyzeVacancy(organizationId, id);
    if (!assessed) continue;
    summary.analyzed += 1;
    summary.requirements += assessed.requirements.length;
    if (assessed.state === "APPLY") summary.qualified += 1;
    else if (assessed.state === "NOT_A_FIT") summary.notAFit += 1;
    else summary.review += 1;
  }
  summary.analysisMs = summary.analyzed ? Date.now() - analysisStarted : 0;
  await recordActivity({
    organizationId,
    action: "job.discovery_completed",
    detail: JSON.stringify({
      query,
      discovered: summary.discovered,
      normalized: summary.normalized,
      duplicatesRemoved: summary.duplicatesRemoved,
      stored: summary.stored,
      analyzed: summary.analyzed,
      qualified: summary.qualified,
      review: summary.review,
      notReady: summary.notReady,
      notAFit: summary.notAFit,
      failed: summary.failed,
      failures: summary.failures,
      sources: summary.sources,
      discoveryMs: summary.discoveryMs,
      analysisMs: summary.analysisMs,
    }).slice(0, 2000),
  });
  logInfo("job_discovery.stored", { organizationId, count: summary.stored, duplicates: summary.duplicatesRemoved, failed: summary.failed });
  return summary;
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

export async function processApplicationPreparation(organizationId: string, vacancyId: string) {
  const applicationId = await prepareApplication(organizationId, vacancyId);
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

export async function processApplicationSubmit(applicationId: string) {
  const application = await prisma.jobApplication.findUnique({ where: { id: applicationId } });
  if (!application) return;
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
    data: { status: statusAfterBlock("captcha"), blockedReason: "Live submission stays off until a supported adapter run is explicitly started." },
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
