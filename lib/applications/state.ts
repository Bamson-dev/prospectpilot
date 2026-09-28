import type { ApplicationStatus } from "@/lib/applications/types";

const NEXT: Record<ApplicationStatus, ApplicationStatus[]> = {
  PREPARED: ["READY_FOR_REVIEW", "FAILED", "WITHDRAWN", "REQUIRES_MANUAL_ACTION"],
  READY_FOR_REVIEW: ["READY_TO_SUBMIT", "REQUIRES_MANUAL_ACTION", "FAILED", "WITHDRAWN"],
  READY_TO_SUBMIT: ["SUBMITTING", "REQUIRES_MANUAL_ACTION", "WITHDRAWN"],
  SUBMITTING: ["SUBMITTED", "VERIFICATION_REQUIRED", "FAILED", "REQUIRES_MANUAL_ACTION"],
  SUBMITTED: [],
  VERIFICATION_REQUIRED: ["SUBMITTED", "FAILED", "REQUIRES_MANUAL_ACTION"],
  FAILED: ["PREPARED"],
  REQUIRES_MANUAL_ACTION: ["READY_FOR_REVIEW", "WITHDRAWN", "FAILED"],
  WITHDRAWN: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus) {
  return NEXT[from].includes(to);
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
