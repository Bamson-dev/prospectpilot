import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertResolvedPublicUrl } from "@/lib/network";
import { fillApplicationPage } from "@/lib/applications/browser";
import { safeAuditDetail } from "@/lib/applications/package-version";
import { canTransition } from "@/lib/applications/state";
import type { ApplicationStatus } from "@/lib/applications/types";
import { contactIsReady } from "@/lib/applications/seed-data";

export type InspectionOutcome = {
  opened: boolean;
  submitted: boolean;
  reason: string | null;
  status: "REQUIRES_MANUAL_ACTION" | "READY_FOR_HUMAN_SUBMISSION";
  fields: number;
  platform: string;
  ms: number;
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
  if (outcome.submitted) return true;
  if (outcome.status === "REQUIRES_MANUAL_ACTION") return true;
  return Boolean(outcome.reason && outcome.reason !== "pause before submit");
}

export async function inspectPublicApplication(url: string, values: Record<string, string>): Promise<InspectionOutcome> {
  const started = Date.now();
  await assertResolvedPublicUrl(url);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    const result = await fillApplicationPage(page, values, { fill: false, mode: "PREPARE_ONLY", submit: false });
    return {
      opened: true,
      submitted: false,
      reason: result.submitted ? "inspection reported a submission and was ignored" : result.reason,
      status: result.submitted || result.status === "REQUIRES_MANUAL_ACTION" ? "REQUIRES_MANUAL_ACTION" : "READY_FOR_HUMAN_SUBMISSION",
      fields: result.audit.fieldsDetected,
      platform: result.audit.platform,
      ms: Date.now() - started,
    };
  } finally {
    await browser.close();
  }
}

export async function attachBrowserInspection(applicationId: string) {
  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { vacancy: true, candidate: true, package: true },
  });
  if (!application) return null;
  let outcome: InspectionOutcome;
  try {
    outcome = await inspectPublicApplication(application.applicationUrl, inspectionValues(application.candidate));
  } catch (error) {
    outcome = {
      opened: false,
      submitted: false,
      reason: error instanceof Error ? error.message : "Browser inspection failed.",
      status: "REQUIRES_MANUAL_ACTION",
      fields: 0,
      platform: "UNKNOWN",
      ms: 0,
    };
  }
  const timings = timingRecord(application.package?.timings);
  timings.browserInspectionMs = outcome.ms;
  timings.browserPlatform = outcome.platform;
  timings.browserFields = outcome.fields;
  timings.browserSubmitted = false;
  timings.browserReason = outcome.reason;
  const blocked = inspectionIsBlocked(outcome);
  const nextStatus = blocked && canTransition(application.status as ApplicationStatus, "REQUIRES_MANUAL_ACTION")
    ? "REQUIRES_MANUAL_ACTION"
    : application.status;
  await prisma.jobApplication.update({
    where: { id: application.id },
    data: {
      status: nextStatus,
      blockedReason: blocked ? safeAuditDetail(outcome.reason ?? "Browser preparation needs review.") : application.blockedReason,
      submittedAt: null,
    },
  });
  if (application.package) {
    await prisma.applicationPackage.update({
      where: { id: application.package.id },
      data: { status: nextStatus, timings: timings as Prisma.InputJsonValue },
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
  if (outcome.reason === "captcha") {
    await prisma.applicationEvent.create({
      data: { applicationId: application.id, type: "CAPTCHA_DETECTED", detail: "CAPTCHA detected. Preparation stopped." },
    });
  } else if (blocked) {
    await prisma.applicationEvent.create({
      data: { applicationId: application.id, type: "MANUAL_ACTION_REQUIRED", detail: safeAuditDetail(outcome.reason ?? "Browser preparation stopped.") },
    });
  }
  return outcome;
}

function timingRecord(value: unknown) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? { ...value as Record<string, unknown> } : {};
  return row;
}
