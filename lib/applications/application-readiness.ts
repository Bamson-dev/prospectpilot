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
  sponsorship?: string | null;
  sponsorshipAsked?: boolean;
  formOpened?: boolean;
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
    sponsorshipKnown: Boolean(input.sponsorship?.trim()),
    sponsorshipAsked: input.sponsorshipAsked ?? true,
    salaryKnown: Boolean(input.salary?.trim()),
    salaryAsked: input.salaryAsked,
    linkedinKnown: true,
    unknownRequired: input.reviewQuestions ? [`${input.reviewQuestions} required questions`] : [],
  });
  const hard = blockers.some((item) => item.class === "HARD_BLOCKER");
  const review = blockers.some((item) => item.class === "REVIEW_REQUIRED") || input.writing === "REVIEW_REQUIRED" || input.facts === "FAIL" || !input.contactReady;
  const decision = hard ? "HARD_BLOCKED" as const : review ? "REVIEW_REQUIRED" as const : "READY" as const;
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
    decision,
    reasons: readinessReasons(decision, blockers, input.writing, input.facts),
    overall: decision === "READY" ? "READY_FOR_REVIEW" as const : "REQUIRES_MANUAL_ACTION" as const,
  };
}

export function readinessReasons(
  decision: "READY" | "REVIEW_REQUIRED" | "HARD_BLOCKED",
  blockers: Array<{ label: string; class: "HARD_BLOCKER" | "REVIEW_REQUIRED" | "OPTIONAL" }>,
  writing?: "PASS" | "REVIEW_REQUIRED",
  facts?: "PASS" | "FAIL",
) {
  const reasons: string[] = [];
  for (const blocker of blockers) {
    if (blocker.class === "OPTIONAL") continue;
    if (blocker.label === "CAPTCHA") reasons.push("BLOCKED: CAPTCHA detected on the employer form.");
    else if (blocker.label === "Cloudflare") reasons.push("BLOCKED: Cloudflare challenge detected.");
    else if (blocker.label === "Authentication") reasons.push("BLOCKED: The employer form requires login.");
    else if (blocker.class === "HARD_BLOCKER") reasons.push(`BLOCKED: ${blocker.label}.`);
    else if (/sponsorship/i.test(blocker.label)) reasons.push("REVIEW REQUIRED: The employer asks for sponsorship information, and no answer is saved.");
    else if (/work authorization/i.test(blocker.label)) reasons.push("REVIEW REQUIRED: The employer asks for work authorization, and no answer is saved.");
    else if (/salary/i.test(blocker.label)) reasons.push("REVIEW REQUIRED: The employer asks for salary, and no salary is saved.");
    else reasons.push(`REVIEW REQUIRED: ${blocker.label}.`);
  }
  if (writing === "REVIEW_REQUIRED") reasons.push("REVIEW REQUIRED: The cover letter needs a writing review.");
  if (facts === "FAIL") reasons.push("REVIEW REQUIRED: A claim is not supported by verified evidence.");
  if (decision === "READY") reasons.push("READY: Required candidate information and application materials are available, and no security barrier was detected.");
  return reasons;
}
