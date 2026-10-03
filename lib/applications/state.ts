import type { ApplicationStatus } from "@/lib/applications/types";

const PRECISE_BLOCKERS = [
  "CAPTCHA_REQUIRED",
  "RATE_LIMITED",
  "UNKNOWN_REQUIRED_FIELD",
  "LOGIN_REQUIRED",
  "AUTH_REQUIRED",
  "CLOUDFLARE_CHALLENGE",
  "FORM_NOT_FOUND",
] as const satisfies readonly ApplicationStatus[];

const BLOCKER_STATUS: Record<string, ApplicationStatus> = {
  captcha: "CAPTCHA_REQUIRED",
  CAPTCHA_REQUIRED: "CAPTCHA_REQUIRED",
  "rate-limit": "RATE_LIMITED",
  RATE_LIMITED: "RATE_LIMITED",
  HTTP_429: "RATE_LIMITED",
  "unknown-field": "UNKNOWN_REQUIRED_FIELD",
  "unknown-required-field": "UNKNOWN_REQUIRED_FIELD",
  "required-field-needs-review": "UNKNOWN_REQUIRED_FIELD",
  UNRESOLVED_REQUIRED_FIELD: "UNKNOWN_REQUIRED_FIELD",
  UNKNOWN_REQUIRED_FIELD: "UNKNOWN_REQUIRED_FIELD",
  LOGIN_REQUIRED: "LOGIN_REQUIRED",
  authentication: "LOGIN_REQUIRED",
  "account-creation": "LOGIN_REQUIRED",
  "unexpected-redirect": "LOGIN_REQUIRED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  verification: "SUBMISSION_UNVERIFIED",
  CLOUDFLARE_CHALLENGE: "CLOUDFLARE_CHALLENGE",
  cloudflare: "CLOUDFLARE_CHALLENGE",
  FORM_NOT_FOUND: "FORM_NOT_FOUND",
  APPLICATION_FORM_NOT_FOUND: "FORM_NOT_FOUND",
  SUBMISSION_UNVERIFIED: "SUBMISSION_UNVERIFIED",
  unconfirmed: "SUBMISSION_UNVERIFIED",
};

const NEXT: Record<ApplicationStatus, ApplicationStatus[]> = {
  PREPARED: ["READY_FOR_REVIEW", "PREPARING", "FAILED", "WITHDRAWN", "REQUIRES_MANUAL_ACTION", "REJECTED", ...PRECISE_BLOCKERS],
  PREPARING: ["FIT_EVALUATED", "READY_FOR_REVIEW", "FAILED", "REQUIRES_MANUAL_ACTION", ...PRECISE_BLOCKERS],
  FIT_EVALUATED: ["READY_FOR_REVIEW", "FAILED", "REJECTED"],
  READY_FOR_REVIEW: ["APPROVED", "READY_TO_SUBMIT", "REQUIRES_MANUAL_ACTION", "FAILED", "WITHDRAWN", "REJECTED", ...PRECISE_BLOCKERS],
  APPROVED: ["READY_FOR_SUBMISSION", "WITHDRAWN", "REQUIRES_MANUAL_ACTION", ...PRECISE_BLOCKERS],
  READY_TO_SUBMIT: ["REQUIRES_MANUAL_ACTION", "WITHDRAWN", ...PRECISE_BLOCKERS],
  READY_FOR_SUBMISSION: ["SUBMITTING", "REQUIRES_MANUAL_ACTION", "WITHDRAWN", ...PRECISE_BLOCKERS],
  SUBMITTING: ["SUBMITTED", "SUBMISSION_UNVERIFIED", "VERIFICATION_PENDING", "FAILED", "REQUIRES_MANUAL_ACTION", ...PRECISE_BLOCKERS],
  SUBMITTED: ["VERIFIED", "SUBMISSION_UNVERIFIED", "VERIFICATION_PENDING", "REJECTED_BY_EMPLOYER", "OFFER"],
  SUBMISSION_UNVERIFIED: ["VERIFIED", "SUBMITTED", "FAILED", "REQUIRES_MANUAL_ACTION", "REJECTED_BY_EMPLOYER", "OFFER", ...PRECISE_BLOCKERS],
  VERIFICATION_PENDING: ["VERIFIED", "FAILED", "REQUIRES_MANUAL_ACTION", "REJECTED_BY_EMPLOYER", "OFFER", ...PRECISE_BLOCKERS],
  VERIFIED: ["REJECTED_BY_EMPLOYER", "OFFER"],
  FAILED: ["PREPARED"],
  REQUIRES_MANUAL_ACTION: ["READY_FOR_REVIEW", "READY_FOR_SUBMISSION", "SUBMITTING", "WITHDRAWN", "FAILED", "REJECTED"],
  REQUIRES_REVIEW: ["READY_FOR_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN", "REQUIRES_MANUAL_ACTION", ...PRECISE_BLOCKERS],
  REJECTED: [],
  WITHDRAWN: [],
  REJECTED_BY_EMPLOYER: [],
  OFFER: [],
  CAPTCHA_REQUIRED: ["READY_FOR_SUBMISSION", "READY_FOR_REVIEW", "WITHDRAWN", "FAILED"],
  RATE_LIMITED: ["READY_FOR_SUBMISSION", "READY_FOR_REVIEW", "WITHDRAWN", "FAILED"],
  UNKNOWN_REQUIRED_FIELD: ["READY_FOR_REVIEW", "WITHDRAWN", "FAILED"],
  LOGIN_REQUIRED: ["READY_FOR_REVIEW", "WITHDRAWN", "FAILED"],
  AUTH_REQUIRED: ["READY_FOR_REVIEW", "WITHDRAWN", "FAILED"],
  CLOUDFLARE_CHALLENGE: ["READY_FOR_REVIEW", "WITHDRAWN", "FAILED"],
  FORM_NOT_FOUND: ["READY_FOR_REVIEW", "WITHDRAWN", "FAILED"],

};

const PRECISE_DISPLAY: ApplicationStatus[] = [
  "SUBMITTING",
  "SUBMITTED",
  "SUBMISSION_UNVERIFIED",
  "VERIFICATION_PENDING",
  "VERIFIED",

  ...PRECISE_BLOCKERS,
];

export type PipelineState = ApplicationStatus | "DRAFT" | "GENERATING" | "REVIEW_REQUIRED" | "READY" | "SUPERSEDED";

export function canTransition(from: ApplicationStatus, to: ApplicationStatus) {
  if ((from === "REQUIRES_REVIEW" || isBlockerState(from) || from === "SUBMISSION_UNVERIFIED") && (to === "SUBMITTED" || to === "SUBMITTING")) return false;
  return NEXT[from].includes(to);
}

export function pipelineState(status: ApplicationStatus): PipelineState {
  if (PRECISE_DISPLAY.includes(status)) return status;
  if (status === "PREPARING") return "GENERATING";
  if (status === "REQUIRES_REVIEW" || status === "FAILED") return "REVIEW_REQUIRED";
  if (status === "REQUIRES_MANUAL_ACTION") return "REQUIRES_MANUAL_ACTION";
  if (status === "APPROVED") return "APPROVED";
  if (status === "REJECTED" || status === "WITHDRAWN") return "REJECTED";
  if (status === "READY_FOR_REVIEW" || status === "READY_TO_SUBMIT" || status === "READY_FOR_SUBMISSION" || status === "FIT_EVALUATED") return "READY";
  return "DRAFT";
}

export function automaticSubmissionAllowed(input?: {
  automationEnabled?: boolean;
  liveSubmit?: boolean;
  mode?: string | null;
  pageUrl?: string | null;
  status?: ApplicationStatus | null;
  packageReady?: boolean;
  blocker?: string | null;
}) {
  const automationEnabled = input?.automationEnabled ?? process.env.APPLICATION_AUTOMATION_ENABLED === "true";
  const liveSubmit = input?.liveSubmit ?? process.env.APPLICATION_LIVE_SUBMIT === "true";
  const mode = input && "mode" in input ? input.mode : process.env.APPLICATION_MODE;
  if (!automationEnabled || !liveSubmit || mode !== "AUTO_SUBMIT") return false;
  if (input?.blocker) return false;
  if (input?.packageReady === false) return false;
  if (input?.status !== "READY_FOR_SUBMISSION") return false;
  if (!input.pageUrl) return false;
  try {
    const host = new URL(input.pageUrl).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

export function statusAfterBlock(reason: string | null | undefined): ApplicationStatus {
  if (!reason) return "REQUIRES_MANUAL_ACTION";
  return BLOCKER_STATUS[reason] ?? "REQUIRES_MANUAL_ACTION";
}

export function isTerminalApplicationState(status: ApplicationStatus) {
  return status === "VERIFIED" || status === "REJECTED" || status === "WITHDRAWN" || status === "REJECTED_BY_EMPLOYER" || status === "OFFER";
}

export function isSubmissionState(status: ApplicationStatus) {
  return status === "READY_TO_SUBMIT"
    || status === "READY_FOR_SUBMISSION"
    || status === "SUBMITTING"
    || status === "SUBMITTED"
    || status === "SUBMISSION_UNVERIFIED"
    || status === "VERIFICATION_PENDING"
    || status === "VERIFIED";
}

export function isBlockerState(status: ApplicationStatus) {
  return (PRECISE_BLOCKERS as readonly ApplicationStatus[]).includes(status);
}

export function isRetryableState(status: ApplicationStatus) {
  return status === "RATE_LIMITED";
}

export function isSuccessfulSubmissionState(status: ApplicationStatus) {
  return status === "SUBMITTED" || status === "VERIFIED";
}

export function retryDecision(input: { statusCode: number; attempt: number; maxAttempts: number }) {
  if (input.statusCode !== 429 && input.statusCode < 500) return "fail" as const;
  if (input.attempt >= input.maxAttempts) return "fail" as const;
  return "retry" as const;
}
