export type FactState = "KNOWN" | "UNKNOWN" | "REVIEW_REQUIRED";

export type ReadinessGroup = "IDENTITY" | "PROFESSIONAL" | "EMPLOYMENT" | "EDUCATION" | "CERTIFICATIONS" | "COMPENSATION";

export type ReadinessField = {
  group: ReadinessGroup;
  field: string;
  state: FactState;
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

const FIELDS: Array<{ group: ReadinessGroup; field: string; key: keyof CandidateReadinessInput }> = [
  { group: "IDENTITY", field: "email", key: "email" },
  { group: "IDENTITY", field: "phone", key: "phone" },
  { group: "IDENTITY", field: "location", key: "location" },
  { group: "PROFESSIONAL", field: "LinkedIn", key: "linkedinUrl" },
  { group: "PROFESSIONAL", field: "portfolio", key: "portfolioUrl" },
  { group: "PROFESSIONAL", field: "GitHub", key: "githubUrl" },
  { group: "EMPLOYMENT", field: "work authorization", key: "workAuthorization" },
  { group: "EMPLOYMENT", field: "sponsorship", key: "sponsorship" },
  { group: "EMPLOYMENT", field: "availability", key: "availability" },
  { group: "EMPLOYMENT", field: "notice period", key: "noticePeriod" },
  { group: "EDUCATION", field: "degree", key: "degree" },
  { group: "EDUCATION", field: "institution", key: "institution" },
  { group: "CERTIFICATIONS", field: "certifications", key: "certification" },
  { group: "COMPENSATION", field: "salary expectation", key: "salaryExpectation" },
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
  }));
  const missing = fields.filter((item) => item.state !== "KNOWN").map((item) => item.field);
  return {
    status: missing.length === 0 ? "READY" as const : "INCOMPLETE" as const,
    missing,
    fields,
  };
}
