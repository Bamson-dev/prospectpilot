import { prisma } from "@/lib/db";
import { logInfo } from "@/lib/logger";
import {
  admitRun,
  automationStaleMs,
  idempotencyKey,
  inspectionIdempotencyKey,
  legacyAutomationHold,
  persistDetectedField,
  retryPlan,
  type DetectedField,
} from "@/lib/applications/automation-engine";
import { safeAuditDetail } from "@/lib/applications/package-version";
import { canTransition, statusAfterBlock } from "@/lib/applications/state";
import type { ApplicationStatus } from "@/lib/applications/types";

export async function recordInspectionRun(input: {
  applicationId: string;
  packageId: string;
  packageVersion: number;
  url: string | null;
  platform: string;
  blocker: string | null;
  fields: DetectedField[];
  pageTitle?: string | null;
}) {
  const key = inspectionIdempotencyKey(input.applicationId, input.packageId, input.packageVersion);
  const existing = await prisma.applicationAutomationRun.findUnique({ where: { idempotencyKey: key } });
  if (existing) return existing;
  const stored = input.fields.map(persistDetectedField);
  const unknownRequired = stored.some((field) => field.required && field.resolution === "UNRESOLVED" && field.classification === "UNKNOWN");
  const blocker = input.blocker ?? (unknownRequired ? "UNKNOWN_REQUIRED_FIELD" : null);
  const mappedBlocker = blocker ? statusAfterBlock(blocker) : null;
  const plan = mappedBlocker ? retryPlan({ code: mappedBlocker === "RATE_LIMITED" ? "RATE_LIMITED" : mappedBlocker, attempt: 1, now: Date.now() }) : null;
  const run = await prisma.applicationAutomationRun.create({
    data: {
      applicationId: input.applicationId,
      packageId: input.packageId,
      packageVersion: input.packageVersion,
      status: !blocker ? "COMPLETED" : plan?.status === "WAITING" ? "WAITING" : plan?.status === "FAILED" ? "FAILED" : "BLOCKED",
      attempt: 1,
      currentStep: mappedBlocker === "FORM_NOT_FOUND" ? "FORM_DISCOVERY" : stored.length ? "ANSWER_RESOLUTION" : "BROWSER_STARTED",
      currentUrl: input.url,
      idempotencyKey: key,
      blocker: mappedBlocker,
      errorCode: mappedBlocker,
      errorMessage: blocker ? safeAuditDetail(blocker) : null,
      nextRetryAt: plan?.nextRetryAt ? new Date(plan.nextRetryAt) : null,
      completedAt: new Date(),
      fields: {
        create: stored.map((field) => ({
          applicationId: input.applicationId,
          packageId: input.packageId,
          fieldKey: field.fieldKey,
          label: field.label || "Field",
          name: field.name,
          elementId: field.elementId,
          fieldType: field.fieldType || "text",
          required: field.required,
          classification: field.classification,
          confidence: field.confidence,
          answer: field.answer,
          answerSource: field.answerSource,
          resolution: field.resolution,
          filled: false,
          validated: false,
        })),
      },
      sessions: {
        create: {
          applicationId: input.applicationId,
          platform: input.platform || "UNKNOWN",
          adapter: input.platform || "UNKNOWN",
          status: blocker ? "BLOCKED" : "COMPLETED",
          currentUrl: input.url,
          pageTitle: input.pageTitle?.slice(0, 180) ?? null,
          attempt: 1,
          endedAt: new Date(),
          errorCode: blocker ? statusAfterBlock(blocker) : null,
        },
      },
    },
  });
  await prisma.applicationEvent.create({
    data: {
      applicationId: input.applicationId,
      type: "AUTOMATION_STARTED",
      detail: safeAuditDetail(`inspect v${input.packageVersion}; ${stored.length} fields; ${blocker ?? "checkpoint"}; not submitted`),
    },
  });
  if (stored.length) {
    await prisma.applicationEvent.create({
      data: { applicationId: input.applicationId, type: "FORM_DISCOVERED", detail: safeAuditDetail(`${input.platform}; ${stored.length} fields`) },
    });
  }
  if (plan?.retry) {
    await prisma.applicationEvent.create({
      data: { applicationId: input.applicationId, type: "AUTOMATION_RETRY_SCHEDULED", detail: safeAuditDetail(`${blocker}; retry at ${plan.nextRetryAt}`) },
    });
  }
  return run;
}

export async function recoverStaleAutomationRuns(now = new Date()) {
  const cutoff = new Date(now.getTime() - automationStaleMs());
  const stale = await prisma.applicationAutomationRun.updateMany({
    where: { status: { in: ["QUEUED", "RUNNING"] }, heartbeatAt: { lt: cutoff } },
    data: { status: "FAILED", errorCode: "STALE", errorMessage: "Automation heartbeat expired.", completedAt: now },
  });
  if (stale.count) logInfo("application.automation_stale", { count: stale.count });
  return stale.count;
}

export async function runApplicationAutomation(applicationId: string) {
  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { package: true, candidate: true },
  });
  if (!application?.package) return { skipped: "missing" as const, packageVersion: application?.package?.version ?? null };
  const packageVersion = application.package.version;
  if (legacyAutomationHold(application.status as ApplicationStatus)) return { skipped: "held" as const, packageVersion };
  const now = Date.now();
  const active = await prisma.applicationAutomationRun.findFirst({
    where: { applicationId, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { startedAt: "desc" },
  });
  const decision = admitRun({
    active: active ? { id: active.id, status: active.status, heartbeatAt: active.heartbeatAt.getTime() } : null,
    now,
  });
  if (decision.action === "reuse") return { skipped: "active" as const, packageVersion, runId: decision.runId };
  if (decision.action === "recover" && decision.runId) {
    await prisma.applicationAutomationRun.update({
      where: { id: decision.runId },
      data: { status: "FAILED", errorCode: "STALE", errorMessage: "Automation heartbeat expired.", completedAt: new Date(now) },
    });
  }
  const previous = await prisma.applicationAutomationRun.findFirst({
    where: { applicationId, packageId: application.package.id },
    orderBy: { attempt: "desc" },
  });
  const attempt = (previous?.attempt ?? 0) + 1;
  const run = await prisma.applicationAutomationRun.create({
    data: {
      applicationId,
      packageId: application.package.id,
      packageVersion,
      status: "RUNNING",
      attempt,
      currentStep: previous?.currentStep || "BROWSER_STARTED",
      idempotencyKey: idempotencyKey(applicationId, application.package.id, attempt),
      cvUpload: previous?.cvUpload === "UPLOADED" || previous?.cvUpload === "VALIDATED" ? previous.cvUpload : "NOT_STARTED",
      coverUpload: previous?.coverUpload === "UPLOADED" || previous?.coverUpload === "VALIDATED" ? previous.coverUpload : "NOT_STARTED",
    },
  });
  try {
    const { inspectPublicApplication, inspectionValues } = await import("@/lib/applications/public-inspection");
    const outcome = await inspectPublicApplication(application.applicationUrl, inspectionValues(application.candidate), { fill: true });
    const stored = outcome.resolvedFields.map(persistDetectedField);
    if (stored.length) {
      await prisma.applicationFieldResolution.createMany({
        data: stored.map((field) => ({
          applicationId,
          automationRunId: run.id,
          packageId: application.package!.id,
          fieldKey: field.fieldKey,
          label: field.label || "Field",
          name: field.name,
          elementId: field.elementId,
          fieldType: field.fieldType || "text",
          required: field.required,
          classification: field.classification,
          confidence: field.confidence,
          answer: field.answer,
          answerSource: field.answerSource,
          resolution: field.resolution,
        })),
        skipDuplicates: true,
      });
    }
    const blocker = outcome.blocker ?? (stored.some((field) => field.required && field.resolution === "UNRESOLVED" && field.classification === "UNKNOWN") ? "UNKNOWN_REQUIRED_FIELD" : null);
    const mapped = blocker ? statusAfterBlock(blocker) : null;
    const plan = blocker ? retryPlan({ code: blocker, attempt, now: Date.now() }) : null;
    await prisma.applicationBrowserSession.create({
      data: {
        automationRunId: run.id,
        applicationId,
        platform: outcome.platform || "UNKNOWN",
        adapter: outcome.platform || "UNKNOWN",
        status: blocker ? "BLOCKED" : "COMPLETED",
        currentUrl: application.applicationUrl,
        attempt,
        endedAt: new Date(),
        errorCode: mapped,
      },
    });
    await prisma.applicationAutomationRun.update({
      where: { id: run.id },
      data: {
        status: blocker ? plan?.status === "WAITING" ? "WAITING" : "BLOCKED" : "COMPLETED",
        currentStep: blocker ? "FORM_DISCOVERY" : "FORM_VALIDATION",
        blocker: mapped,
        errorCode: mapped,
        nextRetryAt: plan?.nextRetryAt ? new Date(plan.nextRetryAt) : null,
        completedAt: new Date(),
        heartbeatAt: new Date(),
      },
    });
    if (mapped && canTransition(application.status as ApplicationStatus, mapped)) {
      await prisma.jobApplication.update({ where: { id: application.id }, data: { status: mapped, blockedReason: safeAuditDetail(mapped), submittedAt: null } });
    } else if (!mapped && canTransition(application.status as ApplicationStatus, "READY_FOR_SUBMISSION")) {
      await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "READY_FOR_SUBMISSION", submittedAt: null } });
    }
    return { skipped: null, packageVersion, runId: run.id, submitted: false as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Browser automation failed.";
    const plan = retryPlan({ code: "BROWSER_CRASH", attempt, now: Date.now() });
    await prisma.applicationAutomationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorCode: "BROWSER_CRASH",
        errorMessage: safeAuditDetail(message),
        nextRetryAt: plan.nextRetryAt ? new Date(plan.nextRetryAt) : null,
        completedAt: new Date(),
      },
    });
    await prisma.applicationEvent.create({
      data: { applicationId, type: "AUTOMATION_FAILED", detail: safeAuditDetail(`browser crash; package v${packageVersion}; not submitted`) },
    });
    return { skipped: null, packageVersion, runId: run.id, submitted: false as const };
  }
}
