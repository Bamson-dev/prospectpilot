import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { logInfo } from "@/lib/logger";
import { queueJob } from "@/lib/jobs";
import { GmailProvider } from "@/lib/email/gmail";
import type { OutboundEmail } from "@/lib/email/types";
import { jobApplicationEmailEnabled, jobEmailDailyLimit, jobEmailPerEmployerWeeklyLimit } from "@/lib/applications/config";
import { applicationBody, applicationSubject, findApplicationEmail } from "@/lib/applications/email-route";
import { titleMatchesTargetRoles } from "@/lib/applications/job-queries";
import { classifyCandidateEmail } from "@/lib/applications/seed-data";
import { safeAuditDetail } from "@/lib/applications/package-version";

export type ApplicationMailer = {
  sendEmail(message: OutboundEmail): Promise<{ providerMessageId: string }>;
  confirmSent(id: string): Promise<boolean>;
  findSent(input: { to: string; subject: string; afterMs: number }): Promise<string | null>;
};

export type EmailApplicationOutcome =
  | { outcome: "SENT"; messageId: string; to: string; verified: boolean }
  | { outcome: "ALREADY_SENT" | "NO_EMAIL_ROUTE" | "BLOCKED" | "DEFERRED" | "DISABLED" | "FAILED"; detail: string };

const RECHECK_AFTER_MS = 10 * 60 * 1000;

// Warnings that mean the package must not be sent. Missing-requirement notes and unanswered form questions do not matter for an email application.
export function emailPackageBlockers(warnings: readonly string[]) {
  return warnings.filter((warning) => /unsupported|readability|writing needs review|placeholder/i.test(warning));
}

// Only PREPARE is safe. The fit scorer returns REVIEW when a required skill is missing or a degree or
// certification blocker exists, and MANUAL_REVIEW when work authorization or location is unknown.
export function emailFitAllowed(strategy: string | null | undefined) {
  return strategy === "PREPARE";
}

async function defaultMailer(organizationId: string): Promise<{ mailer: ApplicationMailer; from: string; fromName: string | null } | null> {
  const account = await prisma.emailAccount.findFirst({
    where: { organizationId, provider: "GMAIL", status: "ACTIVE", refreshTokenEncrypted: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  if (!account?.refreshTokenEncrypted) return null;
  return { mailer: new GmailProvider(decryptSecret(account.refreshTokenEncrypted)), from: account.fromEmail, fromName: account.fromName };
}

async function record(applicationId: string, type: "SUBMISSION_STARTED" | "SUBMITTED" | "VERIFICATION_PASSED" | "VERIFICATION_FAILED" | "MANUAL_ACTION_REQUIRED", detail: string) {
  await prisma.applicationEvent.create({ data: { applicationId, type, detail: safeAuditDetail(detail) } });
}

async function markSent(applicationId: string, messageId: string, at: Date) {
  await prisma.jobApplication.update({
    where: { id: applicationId },
    data: { emailSentAt: at, emailMessageId: messageId, status: "SUBMITTED", submittedAt: at, failureReason: null, blockedReason: null },
  });
}

export async function sendEmailApplication(applicationId: string, deps: { mailer?: ApplicationMailer; from?: string; fromName?: string | null; now?: Date } = {}): Promise<EmailApplicationOutcome> {
  const now = deps.now ?? new Date();
  if (!jobApplicationEmailEnabled()) return { outcome: "DISABLED", detail: "JOB_APPLICATION_EMAIL_ENABLED is not true." };
  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { vacancy: true, candidate: true, package: true },
  });
  if (!application) return { outcome: "BLOCKED", detail: "Application not found." };
  if (application.emailSentAt || application.status === "SUBMITTED" || application.status === "VERIFIED" || application.status === "WITHDRAWN") {
    return { outcome: "ALREADY_SENT", detail: "This application already has a send record." };
  }
  const route = findApplicationEmail({
    description: application.vacancy.description,
    companyName: application.vacancy.companyName,
    companyDomain: application.vacancy.companyDomain,
    applicationUrl: application.vacancy.applicationUrl,
    sourceUrl: application.vacancy.sourceUrl,
  });
  if (!route.found) return { outcome: "NO_EMAIL_ROUTE", detail: route.reason };

  const block = async (reason: string): Promise<EmailApplicationOutcome> => {
    await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "REQUIRES_MANUAL_ACTION", blockedReason: reason.slice(0, 500), applyEmail: route.email, applyEmailSource: route.ownership } });
    await record(application.id, "MANUAL_ACTION_REQUIRED", reason);
    return { outcome: "BLOCKED", detail: reason };
  };

  if (!emailFitAllowed(application.package?.strategy)) return block("The fit result does not allow an automatic application.");
  if (!titleMatchesTargetRoles(application.vacancy.title, application.candidate.targetRoles)) return block("The vacancy title does not match the candidate's configured target roles.");
  const packageBlockers = emailPackageBlockers(application.package?.warnings ?? []);
  if (packageBlockers.length > 0) return block(`Package check failed: ${packageBlockers[0]}`);
  if (classifyCandidateEmail(application.candidate.email) !== "VALID_EMAIL") return block("The candidate email is missing or a placeholder.");
  const [cv, letter] = await Promise.all([
    application.cvId ? prisma.generatedDocument.findUnique({ where: { id: application.cvId } }) : null,
    application.coverLetterId ? prisma.generatedDocument.findUnique({ where: { id: application.coverLetterId } }) : null,
  ]);
  if (!cv || !letter) return block("The CV or cover letter has not been generated.");

  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [sentToday, sentToEmployer] = await Promise.all([
    prisma.jobApplication.count({ where: { organizationId: application.organizationId, emailSentAt: { gte: dayAgo } } }),
    prisma.jobApplication.count({
      where: { organizationId: application.organizationId, emailSentAt: { gte: weekAgo }, vacancy: { normalizedCompany: application.vacancy.normalizedCompany } },
    }),
  ]);
  const deferral = sentToday >= jobEmailDailyLimit()
    ? "The daily application email limit is reached."
    : sentToEmployer >= jobEmailPerEmployerWeeklyLimit()
      ? "The weekly limit for this employer is reached."
      : null;
  if (deferral) {
    await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "READY_TO_SUBMIT", applyEmail: route.email, applyEmailSource: route.ownership, blockedReason: deferral } });
    return { outcome: "DEFERRED", detail: deferral };
  }

  const resolved = deps.mailer ? { mailer: deps.mailer, from: deps.from ?? "", fromName: deps.fromName ?? null } : await defaultMailer(application.organizationId);
  if (!resolved) return block("No active Gmail account is connected.");
  const { mailer } = resolved;

  const subject = applicationSubject(application.vacancy.title, application.candidate.fullName);
  const previousAttempt = application.emailAttemptAt;
  const claim = await prisma.jobApplication.updateMany({
    where: { id: application.id, emailSentAt: null, OR: [{ emailAttemptAt: null }, { emailAttemptAt: { lt: new Date(now.getTime() - RECHECK_AFTER_MS) } }] },
    data: { emailAttemptAt: now, status: "SUBMITTING", applyEmail: route.email, applyEmailSource: route.ownership, emailSubject: subject, blockedReason: null },
  });
  if (claim.count !== 1) return { outcome: "DEFERRED", detail: "Another send attempt is in progress." };
  await record(application.id, "SUBMISSION_STARTED", `Email application to ${route.email}`);

  // An earlier attempt may have reached Gmail before the worker stopped. Look in Sent mail before sending again.
  if (previousAttempt) {
    try {
      const existing = await mailer.findSent({ to: route.email, subject, afterMs: previousAttempt.getTime() - 60_000 });
      if (existing) {
        await markSent(application.id, existing, previousAttempt);
        await record(application.id, "SUBMITTED", `Found the earlier send in Sent mail (${existing}). No second email was sent.`);
        return { outcome: "SENT", messageId: existing, to: route.email, verified: true };
      }
    } catch (error) {
      // If Sent mail cannot be searched, a second send could duplicate. Stop and let the retry decide.
      throw new Error(`Could not check Sent mail before retrying: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  let messageId: string;
  try {
    const result = await mailer.sendEmail({
      to: route.email,
      from: resolved.from,
      fromName: resolved.fromName ?? application.candidate.fullName,
      replyTo: application.candidate.email,
      subject,
      text: applicationBody({ letter: letter.text, fullName: application.candidate.fullName, email: application.candidate.email, phone: application.candidate.phone }),
      attachments: [
        { fileName: cv.fileName, mimeType: cv.fileType, content: Buffer.from(cv.content) },
        { fileName: letter.fileName, mimeType: letter.fileType, content: Buffer.from(letter.content) },
      ],
      headers: { "X-ProspectPilot-Application": application.id },
    });
    messageId = result.providerMessageId;
  } catch (error) {
    const permanent = error instanceof Error && error.name === "PermanentProviderError";
    const reason = error instanceof Error ? error.message : "Send failed";
    if (permanent) {
      await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "FAILED", failureReason: reason.slice(0, 500), emailAttemptAt: null } });
      await record(application.id, "MANUAL_ACTION_REQUIRED", `Gmail refused the send: ${reason}`);
      return { outcome: "FAILED", detail: reason };
    }
    await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "READY_TO_SUBMIT", failureReason: reason.slice(0, 500), retryCount: { increment: 1 } } });
    throw error;
  }

  await markSent(application.id, messageId, now);
  await record(application.id, "SUBMITTED", `Gmail accepted the message ${messageId} to ${route.email}`);
  let verified = false;
  try {
    verified = await mailer.confirmSent(messageId);
    if (verified) {
      await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "VERIFIED", verifiedAt: new Date() } });
      await record(application.id, "VERIFICATION_PASSED", `Gmail lists ${messageId} in Sent mail.`);
    } else {
      await record(application.id, "VERIFICATION_FAILED", `Gmail did not list ${messageId} in Sent mail.`);
    }
  } catch (error) {
    await record(application.id, "VERIFICATION_FAILED", `Gmail accepted the send but the Sent check failed: ${error instanceof Error ? error.message : "unknown"}`);
  }
  logInfo("application.email_sent", { applicationId: application.id, messageId, verified });
  return { outcome: "SENT", messageId, to: route.email, verified };
}

// Re-queues applications that were held back by a limit. Runs from the existing hourly application scan.
export async function queueDueEmailApplications(limit = 25) {
  if (!jobApplicationEmailEnabled()) return 0;
  const due = await prisma.jobApplication.findMany({
    where: { status: "READY_TO_SUBMIT", emailSentAt: null, applyEmail: { not: null } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, organizationId: true },
  });
  const day = new Date().toISOString().slice(0, 10);
  for (const application of due) {
    await queueJob({
      id: `application-submit:${application.id}:${day}`,
      organizationId: application.organizationId,
      queue: "application-submit",
      name: "submit",
      payload: { organizationId: application.organizationId, applicationId: application.id },
    }).catch(() => undefined);
  }
  return due.length;
}
