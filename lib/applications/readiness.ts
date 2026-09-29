export type FactState = "KNOWN" | "UNKNOWN" | "REVIEW_REQUIRED";

export type ReadinessGroup = "IDENTITY" | "PROFESSIONAL" | "EMPLOYMENT" | "EDUCATION" | "CERTIFICATIONS" | "COMPENSATION";

export type FieldPurpose = "CV" | "APPLICATION" | "OPTIONAL";

export type ReadinessField = {
  group: ReadinessGroup;
  field: string;
  state: FactState;
  purpose: FieldPurpose;
  note: string;
};

export type CandidateReadinessInput = {
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
  portfolioUrl?: string | null;
  githubUrl?: string | null;
  workAuthorization?: string | null;
  sponsorship?: string | null;
  availability?: string | null;
  noticePeriod?: string | null;
  institution?: string | null;
  degree?: string | null;
  certification?: string | null;
  salaryExpectation?: string | null;
};

const FIELDS: Array<{ group: ReadinessGroup; field: string; key: keyof CandidateReadinessInput; purpose: FieldPurpose; note: string }> = [
  { group: "IDENTITY", field: "email", key: "email", purpose: "CV", note: "Required before a CV or cover letter can be stored." },
  { group: "IDENTITY", field: "phone", key: "phone", purpose: "APPLICATION", note: "Used when an employer asks for a phone number." },
  { group: "IDENTITY", field: "location", key: "location", purpose: "APPLICATION", note: "Used when an employer asks where you are based." },
  { group: "PROFESSIONAL", field: "LinkedIn", key: "linkedinUrl", purpose: "OPTIONAL", note: "Useful when a form asks for it. A CV can be generated without it." },
  { group: "PROFESSIONAL", field: "portfolio", key: "portfolioUrl", purpose: "OPTIONAL", note: "Optional unless the vacancy asks for a portfolio." },
  { group: "PROFESSIONAL", field: "GitHub", key: "githubUrl", purpose: "OPTIONAL", note: "Optional unless the vacancy asks for it." },
  { group: "EMPLOYMENT", field: "work authorization", key: "workAuthorization", purpose: "APPLICATION", note: "Not required for a CV. An employer question stays review-required until you save an answer." },
  { group: "EMPLOYMENT", field: "sponsorship", key: "sponsorship", purpose: "APPLICATION", note: "Not required for a CV. Left blank when an employer asks and no answer is saved." },
  { group: "EMPLOYMENT", field: "availability", key: "availability", purpose: "OPTIONAL", note: "Optional unless an employer asks." },
  { group: "EMPLOYMENT", field: "notice period", key: "noticePeriod", purpose: "OPTIONAL", note: "Optional unless an employer asks." },
  { group: "EDUCATION", field: "degree", key: "degree", purpose: "APPLICATION", note: "Required only when the vacancy asks for education." },
  { group: "EDUCATION", field: "institution", key: "institution", purpose: "APPLICATION", note: "Required only when the vacancy asks for education." },
  { group: "CERTIFICATIONS", field: "certifications", key: "certification", purpose: "OPTIONAL", note: "Required only when the vacancy asks for a certification." },
  { group: "COMPENSATION", field: "salary expectation", key: "salaryExpectation", purpose: "OPTIONAL", note: "Not required for a CV. A salary question stays review-required until you save one." },
];

export function fieldState(value: string | null | undefined, key: keyof CandidateReadinessInput): FactState {
  const text = (value ?? "").trim();
  if (!text) return "UNKNOWN";
  if (key === "email" && (text.endsWith("@invalid.test") || /placeholder|example\.invalid/i.test(text))) return "REVIEW_REQUIRED";
  if (/^(unknown|n\/a|none|placeholder)$/i.test(text)) return "REVIEW_REQUIRED";
  return "KNOWN";
}

export function candidateReadiness(input: CandidateReadinessInput) {
  const fields = FIELDS.map((item) => ({
    group: item.group,
    field: item.field,
    state: fieldState(input[item.key], item.key),
    purpose: item.purpose,
    note: item.note,
  }));
  const missing = fields.filter((item) => item.state !== "KNOWN").map((item) => item.field);
  const cvBlocked = fields.some((item) => item.purpose === "CV" && item.state !== "KNOWN");
  return {
    status: missing.length === 0 ? "READY" as const : "INCOMPLETE" as const,
    cvStatus: cvBlocked ? "INCOMPLETE" as const : "READY" as const,
    missing,
    fields,
  };
}
