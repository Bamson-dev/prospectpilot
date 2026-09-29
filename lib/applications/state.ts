import type { ApplicationStatus } from "@/lib/applications/types";

const NEXT: Record<ApplicationStatus, ApplicationStatus[]> = {
  PREPARED: ["READY_FOR_REVIEW", "PREPARING", "FAILED", "WITHDRAWN", "REQUIRES_MANUAL_ACTION", "REJECTED"],
  PREPARING: ["FIT_EVALUATED", "READY_FOR_REVIEW", "FAILED", "REQUIRES_MANUAL_ACTION"],
  FIT_EVALUATED: ["READY_FOR_REVIEW", "FAILED", "REJECTED"],
  READY_FOR_REVIEW: ["APPROVED", "READY_TO_SUBMIT", "REQUIRES_MANUAL_ACTION", "FAILED", "WITHDRAWN", "REJECTED"],
  APPROVED: ["READY_FOR_SUBMISSION", "WITHDRAWN", "REQUIRES_MANUAL_ACTION"],
  READY_TO_SUBMIT: ["REQUIRES_MANUAL_ACTION", "WITHDRAWN"],
  READY_FOR_SUBMISSION: ["SUBMITTING", "REQUIRES_MANUAL_ACTION", "WITHDRAWN"],
  SUBMITTING: ["SUBMITTED", "VERIFICATION_REQUIRED", "VERIFICATION_PENDING", "FAILED", "REQUIRES_MANUAL_ACTION"],
  SUBMITTED: ["VERIFIED", "VERIFICATION_REQUIRED", "VERIFICATION_PENDING"],
  VERIFICATION_REQUIRED: ["VERIFIED", "SUBMITTED", "FAILED", "REQUIRES_MANUAL_ACTION"],
  VERIFICATION_PENDING: ["VERIFIED", "FAILED", "REQUIRES_MANUAL_ACTION"],
  VERIFIED: [],
  FAILED: ["PREPARED"],
  REQUIRES_MANUAL_ACTION: ["READY_FOR_REVIEW", "WITHDRAWN", "FAILED"],
  REQUIRES_REVIEW: ["READY_FOR_REVIEW", "APPROVED", "REJECTED", "WITHDRAWN", "REQUIRES_MANUAL_ACTION"],
  REJECTED: [],
  WITHDRAWN: [],
};

export type PipelineState = "DRAFT" | "GENERATING" | "REVIEW_REQUIRED" | "READY" | "APPROVED" | "REQUIRES_MANUAL_ACTION" | "REJECTED" | "SUPERSEDED";

export function canTransition(from: ApplicationStatus, to: ApplicationStatus) {
  if ((from === "REQUIRES_REVIEW" || from === "REQUIRES_MANUAL_ACTION") && (to === "SUBMITTED" || to === "SUBMITTING")) return false;
  return NEXT[from].includes(to);
}

export function pipelineState(status: ApplicationStatus): PipelineState {
  if (status === "PREPARING") return "GENERATING";
  if (status === "REQUIRES_REVIEW" || status === "VERIFICATION_REQUIRED" || status === "VERIFICATION_PENDING" || status === "FAILED") return "REVIEW_REQUIRED";
  if (status === "REQUIRES_MANUAL_ACTION") return "REQUIRES_MANUAL_ACTION";
  if (status === "APPROVED") return "APPROVED";
  if (status === "REJECTED" || status === "WITHDRAWN") return "REJECTED";
  if (status === "READY_FOR_REVIEW" || status === "READY_TO_SUBMIT" || status === "READY_FOR_SUBMISSION" || status === "FIT_EVALUATED") return "READY";
  if (status === "SUBMITTING" || status === "SUBMITTED" || status === "VERIFIED") return "REQUIRES_MANUAL_ACTION";
  return "DRAFT";
}

export function automaticSubmissionAllowed() {
  return false;
}

export function statusAfterBlock(reason: "captcha" | "rate-limit" | "unknown-field" | "verification") {
  if (reason === "verification") return "VERIFICATION_REQUIRED" as const;
  return "REQUIRES_MANUAL_ACTION" as const;
}

export function retryDecision(input: { statusCode: number; attempt: number; maxAttempts: number }) {
  if (input.statusCode !== 429 && input.statusCode < 500) return "fail" as const;
  if (input.attempt >= input.maxAttempts) return "fail" as const;
  return "retry" as const;
}
