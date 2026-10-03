import type { SecurityReason } from "@/lib/applications/security";

export const CONFIRM_PHRASE = "CONFIRM SUBMISSION";

export type SubmissionPreview = {
  phrase: string;
  company: string;
  role: string;
  applicationUrl: string;
  cvFileName: string;
  coverLetterFileName: string;
  answers: Array<{ question: string; answer: string | null; status: string }>;
  workAuthorization: string | null;
  sponsorship: string | null;
  salary: string | null;
  reviewRequired: string[];
  security: SecurityReason | null;
};

export function evaluateSubmissionGate(input: SubmissionPreview, expected: { company: string; role: string; applicationUrl: string; cvFileName: string }) {
  const mismatches = [
    input.company !== expected.company ? "company" : "",
    input.role !== expected.role ? "role" : "",
    input.applicationUrl !== expected.applicationUrl ? "application URL" : "",
    input.cvFileName !== expected.cvFileName ? "CV filename" : "",
  ].filter(Boolean);
  if (input.phrase !== CONFIRM_PHRASE) {
    return { maySubmit: false, status: "REQUIRES_MANUAL_ACTION" as const, reason: "Confirmation phrase was not entered." };
  }
  if (mismatches.length || input.security || input.reviewRequired.length) {
    const reason = input.security ?? (input.reviewRequired[0] ? `Review required: ${input.reviewRequired.join(", ")}` : `Mismatch: ${mismatches.join(", ")}`);
    return { maySubmit: false, status: "REQUIRES_MANUAL_ACTION" as const, reason };
  }
  return { maySubmit: false, status: "READY_FOR_HUMAN_SUBMISSION" as const, reason: "Confirmation recorded. Live submission is disabled." };
}

export function submissionAllowed(input: { phrase: string; pageUrl: string; liveFlag: boolean; mode?: string }) {
  if (!input.liveFlag) return false;
  if (input.mode === "AUTO_SUBMIT") return true;
  if (input.phrase === CONFIRM_PHRASE) return true;
  return false;
}
