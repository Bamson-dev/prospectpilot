import { classifyBlockers } from "@/lib/applications/blockers";

export function applicationReadinessReport(input: {
  candidateName: string;
  jobTitle: string;
  cvReady: boolean;
  coverLetterReady: boolean;
  contactReady: boolean;
  workAuthorization?: string | null;
  salary?: string | null;
  salaryAsked?: boolean;
  educationKnown?: boolean;
  certificationKnown?: boolean;
  reviewQuestions?: number;
  captcha?: boolean;
  authentication?: boolean;
  cloudflare?: boolean;
  writing?: "PASS" | "REVIEW_REQUIRED";
  facts?: "PASS" | "FAIL";
}) {
  const blockers = classifyBlockers({
    captcha: input.captcha,
    cloudflare: input.cloudflare,
    authentication: input.authentication,
    workAuthorizationKnown: Boolean(input.workAuthorization?.trim()),
    workAuthorizationAsked: true,
    salaryKnown: Boolean(input.salary?.trim()),
    salaryAsked: input.salaryAsked,
    linkedinKnown: true,
    unknownRequired: input.reviewQuestions ? [`${input.reviewQuestions} required questions`] : [],
  });
  const hard = blockers.some((item) => item.class === "HARD_BLOCKER");
  const review = blockers.some((item) => item.class === "REVIEW_REQUIRED") || input.writing === "REVIEW_REQUIRED" || input.facts === "FAIL" || !input.contactReady;
  return {
    candidate: input.candidateName,
    job: input.jobTitle,
    cv: input.cvReady ? "READY" as const : "INCOMPLETE" as const,
    coverLetter: input.coverLetterReady ? "READY" as const : "INCOMPLETE" as const,
    contact: input.contactReady ? "KNOWN" as const : "INCOMPLETE" as const,
    workAuthorization: input.workAuthorization?.trim() ? "KNOWN" as const : "UNKNOWN" as const,
    salary: input.salary?.trim() ? "KNOWN" as const : "UNKNOWN" as const,
    education: input.educationKnown ? "KNOWN" as const : "UNKNOWN" as const,
    certifications: input.certificationKnown ? "KNOWN" as const : "UNKNOWN" as const,
    requiredQuestions: input.reviewQuestions ?? 0,
    security: hard ? "HARD_BLOCKER" as const : "PASS" as const,
    captcha: input.captcha ? "DETECTED" as const : "not detected" as const,
    writing: input.writing ?? "PASS",
    facts: input.facts ?? "PASS",
    blockers,
    overall: hard || review ? "REQUIRES_MANUAL_ACTION" as const : "READY_FOR_REVIEW" as const,
  };
}
