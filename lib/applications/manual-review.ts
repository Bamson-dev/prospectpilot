import { preparationReadinessLine } from "@/lib/applications/security";
import { safeAuditDetail } from "@/lib/applications/package-version";
import type { ApplicationStatus } from "@/lib/applications/types";

export const MANUAL_MARKERS = ["MANUAL_REVIEW_STARTED", "MANUAL_REVIEW_COMPLETED", "MANUAL_ACTION_NOT_COMPLETED"] as const;
export type ManualMarker = (typeof MANUAL_MARKERS)[number];

const SENSITIVE = /WORK_AUTHORIZATION|SPONSORSHIP|VISA|LEGAL_STATUS|SECURITY_CLEARANCE|VETERAN|DISABILITY|GENDER|ETHNICITY|PRONOUN|DEMOGRAPHIC|\bAGE\b/i;

export function humanActionInstruction(blocker: string | null | undefined) {
  if (!blocker) return null;
  const readiness = preparationReadinessLine(blocker);
  if (blocker === "CAPTCHA_REQUIRED") {
    return { blocker, readiness, instruction: "Complete the employer CAPTCHA manually before continuing. Open the employer application manually and complete the CAPTCHA." };
  }
  if (blocker === "RATE_LIMITED" || blocker === "HTTP_429") {
    return { blocker, readiness, instruction: "Employer rate limit encountered. Retry later." };
  }
  if (blocker === "CLOUDFLARE_CHALLENGE") {
    return { blocker, readiness, instruction: "Complete the employer security challenge manually." };
  }
  if (blocker === "LOGIN_REQUIRED" || blocker === "AUTH_REQUIRED") {
    return { blocker, readiness, instruction: "Log in to the employer application portal manually." };
  }
  if (blocker === "ACCESS_DENIED" || blocker === "HTTP_403") {
    return { blocker, readiness, instruction: "The employer denied access. Open the application manually. ProspectPilot does not bypass this barrier." };
  }
  if (blocker === "BOT_VERIFICATION") {
    return { blocker, readiness, instruction: "Complete the employer bot check manually. ProspectPilot does not bypass this barrier." };
  }
  if (blocker === "SECURITY_BLOCK") {
    return { blocker, readiness, instruction: "A security barrier stopped preparation. Open the employer application manually. ProspectPilot does not bypass this barrier." };
  }
  if (blocker === "EMPLOYER_SERVER_ERROR") {
    return { blocker, readiness, instruction: "The employer server returned an error. Retry later or open the application manually." };
  }
  if (blocker === "BROWSER_TIMEOUT" || blocker === "PAGE_LOAD_TIMEOUT") {
    return { blocker, readiness, instruction: "The employer page did not finish loading. Open the application manually." };
  }
  if (!readiness) return null;
  return { blocker, readiness, instruction: `${readiness}. Open the employer application manually.` };
}

export function qualificationDecision(analysis: unknown, blocker: string | null | undefined) {
  void blocker;
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return { decision: null as string | null, reason: null as string | null, primary: null as string | null, secondary: [] as string[] };
  const row = analysis as Record<string, unknown>;
  const explanation = row.explanation && typeof row.explanation === "object" && !Array.isArray(row.explanation) ? row.explanation as Record<string, unknown> : null;
  const opportunity = explanation?.opportunity && typeof explanation.opportunity === "object" && !Array.isArray(explanation.opportunity) ? explanation.opportunity as Record<string, unknown> : null;
  const decision = typeof explanation?.state === "string" ? explanation.state : typeof row.qualification === "string" ? row.qualification : null;
  return {
    decision,
    reason: typeof opportunity?.reason === "string" ? opportunity.reason : null,
    primary: typeof opportunity?.primaryProfile === "string" ? opportunity.primaryProfile : null,
    secondary: Array.isArray(opportunity?.secondaryProfiles) ? opportunity.secondaryProfiles.filter((item): item is string => typeof item === "string") : [],
  };
}

export type ReviewField = {
  label: string;
  classification: string;
  required: boolean;
  answer: string | null;
  source: string | null;
  confidence: number;
  reviewState: "ANSWERED" | "REVIEW_REQUIRED" | "UNKNOWN";
  group: "resolved" | "review" | "unknown" | "custom" | "sensitive";
};

export function isReviewSensitive(classification: string) {
  return SENSITIVE.test(classification);
}

export function presentSensitiveField(classification: string, proposed: { answer: string | null; source: string | null }) {
  if (!isReviewSensitive(classification)) return { reviewState: proposed.answer ? "ANSWERED" as const : "REVIEW_REQUIRED" as const, answer: proposed.answer, source: proposed.source };
  if (proposed.source === "CANDIDATE_ENTERED" && proposed.answer) {
    return { reviewState: "REVIEW_REQUIRED" as const, answer: proposed.answer, source: "CANDIDATE_ENTERED" as const };
  }
  return { reviewState: "REVIEW_REQUIRED" as const, answer: null, source: null };
}

export function buildFieldReview(input: {
  answers: Array<{ question: string; classification: string; required: boolean; answer: string | null; source: string | null; confidence: number; reviewState: string }>;
  workAuthorization: string | null;
  sponsorship: string | null;
}) {
  const fields: ReviewField[] = [];
  const seen = new Set<string>();
  for (const answer of input.answers) {
    const key = answer.question.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push(toReviewField(answer.question, answer.classification, answer.required, answer.answer, answer.source, answer.confidence, answer.reviewState));
  }
  if (![...seen].some((label) => /work authorization|authori[sz]ed to work|right to work/.test(label))) {
    fields.push(toReviewField("Work authorization", "WORK_AUTHORIZATION", true, input.workAuthorization, input.workAuthorization ? "CANDIDATE_ENTERED" : null, 0, "REVIEW_REQUIRED"));
  }
  if (![...seen].some((label) => /sponsor/.test(label))) {
    fields.push(toReviewField("Sponsorship", "SPONSORSHIP", true, input.sponsorship, input.sponsorship ? "CANDIDATE_ENTERED" : null, 0, "REVIEW_REQUIRED"));
  }
  return {
    resolved: fields.filter((field) => field.group === "resolved"),
    review: fields.filter((field) => field.group === "review"),
    unknown: fields.filter((field) => field.group === "unknown"),
    custom: fields.filter((field) => field.group === "custom"),
    sensitive: fields.filter((field) => field.group === "sensitive"),
  };
}

function toReviewField(label: string, classification: string, required: boolean, answer: string | null, source: string | null, confidence: number, reviewState: string): ReviewField {
  if (isReviewSensitive(classification) || isReviewSensitive(label)) {
    const shown = presentSensitiveField(classification || label, { answer, source });
    return { label, classification: classification || "SENSITIVE", required, answer: shown.answer, source: shown.source, confidence, reviewState: "REVIEW_REQUIRED", group: "sensitive" };
  }
  if (classification === "UNKNOWN" || reviewState === "UNKNOWN") {
    return { label, classification: classification || "UNKNOWN", required, answer: null, source, confidence, reviewState: "UNKNOWN", group: "unknown" };
  }
  if (classification === "CUSTOM_QUESTION" || classification === "TECHNICAL" || classification === "OTHER") {
    const answered = reviewState === "ANSWERED" && Boolean(answer);
    return { label, classification, required, answer, source, confidence, reviewState: answered ? "ANSWERED" : "REVIEW_REQUIRED", group: "custom" };
  }
  if (reviewState === "ANSWERED" && answer) {
    return { label, classification, required, answer, source, confidence, reviewState: "ANSWERED", group: "resolved" };
  }
  return { label, classification, required, answer: answer || null, source, confidence, reviewState: "REVIEW_REQUIRED", group: "review" };
}

export function browserPreparationView(timings: unknown, submittedAt: Date | string | null) {
  const row = timings && typeof timings === "object" && !Array.isArray(timings) ? timings as Record<string, unknown> : {};
  const blocker = typeof row.blocker === "string" ? row.blocker : null;
  const readiness = preparationReadinessLine(blocker);
  const fieldsDetected = numberOrNull(row.fieldsDetected) ?? numberOrNull(row.browserFields);
  const fieldsClassified = numberOrNull(row.fieldsClassified) ?? fieldsDetected;
  return {
    platform: typeof row.browserPlatform === "string" ? row.browserPlatform : null,
    fieldsDetected,
    fieldsClassified,
    requiredFields: numberOrNull(row.requiredFields),
    reviewRequired: numberOrNull(row.fieldsReviewRequired),
    blocker,
    readiness,
    stopped: Boolean(blocker),
    submitted: false,
    submittedAt: submittedAt ? "recorded" : "Empty",
    agrees: blocker == null || readiness === preparationReadinessLine(blocker),
  };
}

export function currentDocument<T extends { kind: string; version: number }>(documents: T[], kind: string) {
  return documents.filter((document) => document.kind === kind).sort((left, right) => right.version - left.version)[0] ?? null;
}

export function verifiedEvidence(facts: Array<{ fact: string; verified: boolean; sourceType: string }>) {
  return facts.filter((fact) => fact.verified).map((fact) => ({ claim: fact.fact, source: fact.sourceType, verification: "VERIFIED" as const }));
}

export function packageApproval(input: { status: string; decision: "APPROVED" | "REJECTED"; reason: string; packageVersion: number; blocker: string | null }) {
  if (input.decision === "APPROVED") {
    const staysManual = input.status === "REQUIRES_MANUAL_ACTION";
    return {
      status: staysManual ? input.status : "APPROVED",
      requiresTransition: !staysManual,
      submits: false as const,
      event: "APPROVED" as const,
      detail: safeAuditDetail(`Package approved for manual completion. Not submitted. previous ${input.status}. new ${staysManual ? input.status : "APPROVED"}. version ${input.packageVersion}. blocker ${input.blocker ?? "none"}.`),
    };
  }
  if (!input.reason.trim()) return { error: "A rejection reason is required." as const };
  return {
    status: "REJECTED",
    requiresTransition: true,
    submits: false as const,
    event: "REJECTED" as const,
    detail: safeAuditDetail(`Package rejected. Reason: ${input.reason.trim()}. previous ${input.status}. new REJECTED. version ${input.packageVersion}. blocker ${input.blocker ?? "none"}. Not submitted.`),
  };
}

export function manualReviewRecord(input: { marker: string; status: ApplicationStatus; packageVersion: number; blocker: string | null; reason?: string }) {
  if (!MANUAL_MARKERS.includes(input.marker as ManualMarker)) return { error: "Unknown manual review action." as const };
  if (input.status === "SUBMITTED" || input.status === "SUBMITTING") return { error: "Manual review cannot create a submission." as const };
  const next = input.status;
  return {
    status: next,
    submittedAt: null,
    event: "MANUAL_ACTION_REQUIRED" as const,
    detail: safeAuditDetail(`${input.marker}; previous ${input.status}; new ${next}; version ${input.packageVersion}; blocker ${input.blocker ?? "none"}; reason ${input.reason?.trim() || "none"}`),
  };
}

export function latestManualMarker(events: Array<{ type: string; detail: string | null }>) {
  for (const event of events) {
    if (event.type !== "MANUAL_ACTION_REQUIRED" || !event.detail) continue;
    const marker = MANUAL_MARKERS.find((item) => event.detail?.startsWith(item));
    if (marker) return marker;
  }
  return null;
}

export function blockerFromTimings(timings: unknown) {
  if (!timings || typeof timings !== "object" || Array.isArray(timings)) return null;
  const blocker = (timings as { blocker?: unknown }).blocker;
  return typeof blocker === "string" ? blocker : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" ? value : null;
}
