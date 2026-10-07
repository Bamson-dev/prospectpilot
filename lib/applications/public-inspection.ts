import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logInfo } from "@/lib/logger";
import { recordInspectionRun } from "@/lib/applications/automation-service";
import type { DetectedField } from "@/lib/applications/automation-engine";
import { assertResolvedPublicUrl } from "@/lib/network";
import { recordSourceHealth } from "@/lib/discovery/health";
import { fillApplicationPage, type PreparationAudit } from "@/lib/applications/browser";
import { safeAuditDetail } from "@/lib/applications/package-version";
import { classifyNavigationError, employerServerError, preparationBlocker, type PreparationBlocker } from "@/lib/applications/security";
import { sourceValidity } from "@/lib/applications/source-validity";
import { canTransition, statusAfterBlock } from "@/lib/applications/state";
import type { ApplicationStatus } from "@/lib/applications/types";
import { contactIsReady } from "@/lib/applications/seed-data";

export type InspectionOutcome = {
  opened: boolean;
  submitted: boolean;
  reason: string | null;
  blocker: PreparationBlocker | null;
  status: "REQUIRES_MANUAL_ACTION" | "READY_FOR_HUMAN_SUBMISSION" | "SUBMITTED" | "SUBMISSION_UNVERIFIED";
  fields: number;
  storageState?: unknown;
  resolvedFields: DetectedField[];
  platform: string;
  ms: number;
  metrics: PreparationAudit["metrics"] | null;
};

export function inspectionValues(candidate: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
}) {
  const values: Record<string, string> = {};
  if (candidate.firstName.trim()) values.firstName = candidate.firstName.trim();
  if (candidate.lastName.trim()) values.lastName = candidate.lastName.trim();
  if (contactIsReady(candidate.email)) values.email = candidate.email.trim();
  if (candidate.phone?.trim()) values.phone = candidate.phone.trim();
  if (candidate.linkedinUrl?.trim()) values.linkedin = candidate.linkedinUrl.trim();
  if (candidate.githubUrl?.trim()) values.github = candidate.githubUrl.trim();
  if (candidate.portfolioUrl?.trim()) values.portfolio = candidate.portfolioUrl.trim();
  return values;
}

export function inspectionIsBlocked(outcome: Pick<InspectionOutcome, "submitted" | "reason" | "status">) {
  if (outcome.submitted) return false;
  if (outcome.status === "REQUIRES_MANUAL_ACTION") return true;
  return Boolean(outcome.reason && outcome.reason !== "pause before submit");
}

export async function inspectPublicApplication(url: string, values: Record<string, string>, options?: { fill?: boolean; cvPath?: string; coverPath?: string; storageState?: string; allowSubmit?: boolean; manualResume?: boolean }): Promise<InspectionOutcome> {
  const started = Date.now();
  await assertResolvedPublicUrl(url);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: options?.manualResume ? false : true });
  try {
    const contextOptions: Record<string, unknown> = {};
    if (options?.storageState) {
      try {
        contextOptions.storageState = JSON.parse(options.storageState);
      } catch {}
    }
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    let response: { status(): number } | null = null;
    try {
      response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browser inspection failed.";
      return stopped(classifyNavigationError(message), Date.now() - started);
    }
    const body = await page.locator("body").innerText().catch(() => "");
    if (employerServerError(response?.status(), body)) {
      return stopped("EMPLOYER_SERVER_ERROR", Date.now() - started, `HTTP ${response?.status() ?? "error"}`);
    }
    const result = await fillApplicationPage(page, values, { fill: options?.fill === true, mode: options?.manualResume ? "MANUAL_RESUME" : (options?.allowSubmit ? "AUTO_SUBMIT" : "PREPARE_ONLY"), submit: options?.allowSubmit === true, statusCode: response?.status(), cvPath: options?.cvPath, coverPath: options?.coverPath });
    if (result.submitted && !options?.allowSubmit) return stopped("SECURITY_BLOCK", Date.now() - started, undefined, result.audit.platform, result.audit.fieldsDetected, result.audit.metrics);
    if (result.submitted && options?.allowSubmit) {
      return {
        opened: true,
        submitted: true,
        reason: result.reason,
        blocker: null,
        status: "SUBMITTED",
        fields: result.audit.fieldsDetected,
        resolvedFields: result.resolvedFields,
        platform: result.audit.platform,
        ms: Date.now() - started,
        metrics: result.audit.metrics,
        storageState: result.storageState,
      };
    }
    if (result.audit.fieldsDetected === 0 && preparationBlocker(result.reason) == null) {
      return stopped("APPLICATION_FORM_NOT_FOUND", Date.now() - started, undefined, result.audit.platform, 0, result.audit.metrics);
    }
    const blocker = preparationBlocker(result.reason);
    
    let returnedStatus: InspectionOutcome["status"] = "READY_FOR_HUMAN_SUBMISSION";
    if (blocker || result.status === "REQUIRES_MANUAL_ACTION") returnedStatus = "REQUIRES_MANUAL_ACTION";
    else if (result.status === "SUBMISSION_UNVERIFIED") returnedStatus = "SUBMISSION_UNVERIFIED";

    return {
      opened: true,
      submitted: false,
      reason: blocker ?? result.reason,
      blocker,
      status: returnedStatus,
      fields: result.audit.fieldsDetected,
      resolvedFields: result.resolvedFields,
      platform: result.audit.platform,
      ms: Date.now() - started,
      metrics: result.audit.metrics,
      storageState: result.storageState,
    };
  } finally {
    await browser.close();
  }
}

function stopped(blocker: PreparationBlocker, ms: number, note?: string, platform = "UNKNOWN", fields = 0, metrics: PreparationAudit["metrics"] | null = null): InspectionOutcome {
  const opened = blocker === "EMPLOYER_SERVER_ERROR" || blocker === "APPLICATION_FORM_NOT_FOUND" || blocker === "SECURITY_BLOCK";
  return { opened, submitted: false, reason: note ? `${blocker} ${note}` : blocker, blocker, status: "REQUIRES_MANUAL_ACTION", fields, resolvedFields: [], platform, ms, metrics, storageState: null };
}

export async function attachBrowserInspection(applicationId: string, options?: { allowSubmit?: boolean; cvPath?: string; coverPath?: string }) {
  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { vacancy: true, candidate: true, package: true, answers: true },
  });
  if (!application) return null;
  let outcome: InspectionOutcome;
  if (sourceValidity({ title: application.vacancy.title, url: application.applicationUrl, source: application.vacancy.source }) === "INVALID_SOURCE") {
    outcome = stopped("SOURCE_INVALID", 0, "SOURCE_INVALID");
  } else {
    try {
      outcome = await inspectPublicApplication(application.applicationUrl, inspectionValues(application.candidate), options);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browser inspection failed.";
      outcome = stopped(classifyNavigationError(message), 0);
    }
  }
  const timings = timingRecord(application.package?.timings);
  timings.browserInspectionMs = outcome.ms;
  timings.browserPlatform = outcome.platform;
  timings.browserFields = outcome.fields;
  timings.browserSubmitted = false;
  timings.browserReason = outcome.reason;
  timings.blocker = outcome.blocker;
  timings.blockerDetails = outcome.reason;
  if (outcome.metrics) {
    timings.fieldsDetected = outcome.metrics.fieldsDetected;
    timings.fieldsClassified = outcome.metrics.fieldsClassified;
    timings.fieldsUnknown = outcome.metrics.fieldsUnknown;
    timings.fieldsReviewRequired = outcome.metrics.fieldsReviewRequired;
    timings.requiredFields = outcome.metrics.requiredFields;
    timings.requiredFieldsClassified = outcome.metrics.requiredFieldsClassified;
    timings.requiredFieldResolutionRate = outcome.metrics.requiredFieldResolutionRate;
    timings.classificationTimeMs = outcome.metrics.classificationTimeMs;
  }
  const blocked = inspectionIsBlocked(outcome);
  let nextStatus = blocked ? "RECOVERABLE_MANUAL_ACTION" : application.status;
  
  if (outcome.submitted) {
    nextStatus = "SUBMITTED";
  }

  await prisma.jobApplication.update({
    where: { id: application.id },
    data: {
      status: nextStatus,
      blockedReason: blocked ? safeAuditDetail(outcome.blocker ?? outcome.reason ?? "Browser preparation needs review.") : (outcome.submitted ? null : application.blockedReason),
      submittedAt: outcome.submitted ? new Date() : null,
    },
  });
  if (application.package) {
    await prisma.applicationPackage.update({
      where: { id: application.package.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { status: nextStatus as any, timings: timings as Prisma.InputJsonValue },
    });
  }
  
  if (blocked) {
    await prisma.applicationManualAction.upsert({
      where: { applicationId: application.id },
      create: {
        applicationId: application.id,
        organizationId: application.organizationId,
        vacancyId: application.vacancyId,
        companyName: application.vacancy.companyName,
        applicationUrl: application.applicationUrl,
        blockerType: outcome.blocker ?? outcome.reason ?? "UNKNOWN",
        blockerMessage: outcome.reason,
        currentStep: "BROWSER_INSPECTION",
        browserStatus: "BLOCKED",
        recoveryData: {
          ats: outcome.platform,
          completedFields: outcome.resolvedFields,
          cvId: application.cvId,
          coverLetterId: application.coverLetterId,
          answers: application.answers?.map(a => ({ q: a.question, a: a.answer })) ?? []
        } as Prisma.InputJsonValue,
        recommendedAction: "Review blocked fields or solve CAPTCHA manually."
      },
      update: {
        blockerType: outcome.blocker ?? outcome.reason ?? "UNKNOWN",
        blockerMessage: outcome.reason,
        currentStep: "BROWSER_INSPECTION",
        browserStatus: "BLOCKED",
        recoveryData: {
          ats: outcome.platform,
          completedFields: outcome.resolvedFields,
          cvId: application.cvId,
          coverLetterId: application.coverLetterId,
          answers: application.answers?.map(a => ({ q: a.question, a: a.answer })) ?? []
        } as Prisma.InputJsonValue,
      }
    });
  }
  if (outcome.opened) {
    await prisma.applicationEvent.create({
      data: { applicationId: application.id, type: "BROWSER_OPENED", detail: safeAuditDetail(`${outcome.platform}; ${outcome.fields} fields; not submitted`) },
    });
  }
  if (outcome.fields > 0) {
    await prisma.applicationEvent.create({
      data: { applicationId: application.id, type: "FIELDS_CLASSIFIED", detail: safeAuditDetail(`${outcome.fields} fields`) },
    });
  }
  if (outcome.blocker === "CAPTCHA_REQUIRED" || outcome.reason === "captcha") {
    await prisma.applicationEvent.create({
      data: { applicationId: application.id, type: "CAPTCHA_DETECTED", detail: "CAPTCHA detected. Preparation stopped." },
    });
  } else if (blocked) {
    await prisma.applicationEvent.create({
      data: { applicationId: application.id, type: "MANUAL_ACTION_REQUIRED", detail: safeAuditDetail(`${outcome.blocker ?? "MANUAL"}; ${outcome.fields} fields; not submitted`) },
    });
  }
  if (application.package) {
    try {
      await recordInspectionRun({
        applicationId: application.id,
        packageId: application.package.id,
        packageVersion: application.package.version,
        url: application.applicationUrl,
        platform: outcome.platform,
        blocker: outcome.blocker,
        fields: outcome.resolvedFields,
      });
    } catch (error) {
      logInfo("application.automation_record_failed", { applicationId: application.id, message: error instanceof Error ? error.message : "record failed" });
    }
  }

  try {
    const url = new URL(application.applicationUrl);
    const domainHealthKey = `app-domain:${url.hostname}`;
    const healthStatus = outcome.submitted ? "success" : (blocked ? "blocked" : "failure");
    await recordSourceHealth(domainHealthKey, healthStatus, outcome.blocker ?? outcome.reason ?? undefined);
    if (outcome.platform) {
      await recordSourceHealth(`app-ats:${outcome.platform}`, healthStatus, outcome.blocker ?? outcome.reason ?? undefined);
    }
  } catch (e) {
    // Ignore URL parse errors
  }

  return outcome;
}

function timingRecord(value: unknown) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
  return row;
}
