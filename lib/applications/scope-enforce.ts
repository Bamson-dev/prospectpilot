import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logInfo } from "@/lib/logger";
import { getQueue, type QueueName } from "@/lib/queues";
import { classifyMarketingRole, marketingBlockedReason, withTimestamp, type MarketingVerdict, type StoredMarketingVerdict } from "@/lib/applications/marketing-scope";

// Application states that are history. They are never rewritten.
const FINISHED = ["SUBMITTED", "VERIFIED", "SUBMITTING", "WITHDRAWN"] as const;

const WORK_QUEUES: QueueName[] = ["application-preparation", "application-submit", "application-browser", "application-verification", "cv-generation", "cover-letter"];

export function mergeMarketingVerdict(rawData: unknown, verdict: StoredMarketingVerdict): Prisma.InputJsonValue {
  const base = rawData && typeof rawData === "object" && !Array.isArray(rawData) ? (rawData as Record<string, unknown>) : {};
  return { ...base, marketing: verdict } as Prisma.InputJsonValue;
}

export function verdictFor(vacancy: { title: string; description: string }): StoredMarketingVerdict {
  return withTimestamp(classifyMarketingRole({ title: vacancy.title, description: vacancy.description }));
}

// Cancels queued or delayed work for one application or vacancy through the job table and removes the waiting queue entry.
// Work that is already running stops at the guards in preparation and submission.
export async function cancelPendingWork(organizationId: string, target: { applicationId?: string; vacancyId?: string }) {
  const filters: Prisma.BackgroundJobWhereInput[] = [];
  if (target.applicationId) filters.push({ payload: { path: ["applicationId"], equals: target.applicationId } });
  if (target.vacancyId) filters.push({ payload: { path: ["vacancyId"], equals: target.vacancyId } });
  if (filters.length === 0) return 0;
  const jobs = await prisma.backgroundJob.findMany({
    where: { organizationId, queue: { in: WORK_QUEUES }, state: { in: ["QUEUED", "DELAYED", "FAILED"] }, OR: filters },
    select: { id: true, queue: true },
    take: 200,
  });
  for (const job of jobs) {
    try {
      const entry = await getQueue(job.queue as QueueName).getJob(job.id);
      if (entry && ["waiting", "delayed", "prioritized", "failed"].includes(await entry.getState())) await entry.remove();
    } catch {
      // The queue entry is gone or locked. The database state below still blocks it.
    }
  }
  if (jobs.length > 0) {
    await prisma.backgroundJob.updateMany({
      where: { id: { in: jobs.map((job) => job.id) } },
      data: { state: "CANCELLED", error: "Cancelled: not a marketing role.", finishedAt: new Date() },
    });
  }
  return jobs.length;
}

// Marks a vacancy as excluded. Nothing is deleted. The reason stays on the record.
export async function excludeVacancy(organizationId: string, vacancy: { id: string; rawData: unknown }, verdict: StoredMarketingVerdict) {
  await prisma.jobVacancy.update({
    where: { id: vacancy.id },
    data: { status: "REJECTED", rawData: mergeMarketingVerdict(vacancy.rawData, verdict) },
  });
  return cancelPendingWork(organizationId, { vacancyId: vacancy.id });
}

// Takes an application out of every automatic path. Sent and finished applications are left as history.
export async function excludeApplication(applicationId: string, verdict: MarketingVerdict) {
  const application = await prisma.jobApplication.findUnique({ where: { id: applicationId }, select: { id: true, organizationId: true, status: true, emailSentAt: true, submittedAt: true } });
  if (!application) return { excluded: false, cancelled: 0 };
  if (application.emailSentAt || application.submittedAt || (FINISHED as readonly string[]).includes(application.status)) return { excluded: false, cancelled: 0 };
  await prisma.jobApplication.update({
    where: { id: application.id },
    data: { status: "WITHDRAWN", blockedReason: marketingBlockedReason(verdict) },
  });
  await prisma.applicationEvent.create({
    data: { applicationId: application.id, type: "MANUAL_ACTION_REQUIRED", detail: marketingBlockedReason(verdict) },
  }).catch(() => undefined);
  const cancelled = await cancelPendingWork(application.organizationId, { applicationId: application.id });
  logInfo("application.excluded_not_marketing", { applicationId: application.id });
  return { excluded: true, cancelled };
}

export type MarketingAuditResult = {
  apply: boolean;
  vacancies: number;
  inScope: number;
  outOfScope: number;
  vacanciesExcluded: number;
  applicationsExcluded: number;
  applicationsKept: number;
  jobsCancelled: number;
  outOfScopeByReason: Record<string, number>;
  inScopeSample: string[];
  outOfScopeSample: string[];
};

// Re-evaluates every saved vacancy against the marketing scope. A preview only counts. Applying marks
// out-of-scope vacancies REJECTED, withdraws their unsent applications and cancels their pending work.
// Records are kept and no sent application is touched.
export async function auditMarketingScope(organizationId: string, options: { apply: boolean }): Promise<MarketingAuditResult> {
  const result: MarketingAuditResult = {
    apply: options.apply, vacancies: 0, inScope: 0, outOfScope: 0, vacanciesExcluded: 0, applicationsExcluded: 0, applicationsKept: 0,
    jobsCancelled: 0, outOfScopeByReason: {}, inScopeSample: [], outOfScopeSample: [],
  };
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.jobVacancy.findMany({
      where: { organizationId },
      orderBy: { id: "asc" },
      take: 200,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, title: true, companyName: true, description: true, status: true, rawData: true, applications: { select: { id: true, status: true, emailSentAt: true, submittedAt: true } } },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    for (const vacancy of batch) {
      result.vacancies += 1;
      const verdict = verdictFor(vacancy);
      if (verdict.inScope) {
        result.inScope += 1;
        if (result.inScopeSample.length < 12) result.inScopeSample.push(`${vacancy.title} (${vacancy.companyName})`);
        if (options.apply) {
          await prisma.jobVacancy.update({ where: { id: vacancy.id }, data: { rawData: mergeMarketingVerdict(vacancy.rawData, verdict) } });
        }
        result.applicationsKept += vacancy.applications.length;
        continue;
      }
      result.outOfScope += 1;
      result.outOfScopeByReason[verdict.reason] = (result.outOfScopeByReason[verdict.reason] ?? 0) + 1;
      if (result.outOfScopeSample.length < 12) result.outOfScopeSample.push(`${vacancy.title} (${vacancy.companyName})`);
      const open = vacancy.applications.filter((item) => !item.emailSentAt && !item.submittedAt && !(FINISHED as readonly string[]).includes(item.status));
      result.applicationsExcluded += open.length;
      if (!options.apply) continue;
      if (vacancy.status !== "REJECTED") result.vacanciesExcluded += 1;
      result.jobsCancelled += await excludeVacancy(organizationId, vacancy, verdict);
      for (const item of open) result.jobsCancelled += (await excludeApplication(item.id, verdict)).cancelled;
    }
  }
  return result;
}
