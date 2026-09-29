const OPTIONAL_CANDIDATE_FACTS = [
  { field: "linkedin", category: "LINK", subcategory: "linkedin", label: "LinkedIn" },
  { field: "education", category: "EDUCATION", subcategory: "education", label: "Education" },
  { field: "certifications", category: "CERTIFICATION", subcategory: "certifications", label: "Certifications" },
  { field: "workAuthorization", category: "IDENTITY", subcategory: "work-authorization", label: "Work authorization" },
  { field: "noticePeriod", category: "IDENTITY", subcategory: "notice-period", label: "Notice period" },
  { field: "salaryExpectation", category: "IDENTITY", subcategory: "salary-expectation", label: "Salary expectation" },
] as const;

export type OptionalCandidateFact = {
  category: "LINK" | "EDUCATION" | "CERTIFICATION" | "IDENTITY";
  subcategory: string;
  fact: string;
};

export function optionalCandidateFacts(formData: FormData) {
  const facts: OptionalCandidateFact[] = [];
  for (const item of OPTIONAL_CANDIDATE_FACTS) {
    const value = String(formData.get(item.field) ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!value) {
      facts.push({ category: item.category, subcategory: item.subcategory, fact: "" });
      continue;
    }
    if (item.field === "linkedin" && !/^https:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(value)) {
      return { error: "Enter a full https LinkedIn URL, or leave it blank.", facts: [] as OptionalCandidateFact[] };
    }
    facts.push({ category: item.category, subcategory: item.subcategory, fact: `${item.label}: ${value}` });
  }
  return { error: null as string | null, facts };
}

export function factReplacement(existing: string | null, next: string) {
  const value = next.trim();
  if (!value) return "remove" as const;
  if (existing === value) return "keep" as const;
  if (existing) return "replace" as const;
  return "create" as const;
}

export function settingValue(facts: Array<{ subcategory: string | null; source: string; fact: string }>, subcategory: string) {
  const match = facts.find((fact) => fact.subcategory === subcategory && fact.source === "candidate-settings");
  return match ? match.fact.replace(/^[^:]+:\s*/, "") : "";
}

export function missingCandidateFields(candidate: {
  phone: string | null;
  location: string | null;
  facts: Array<{ category: string; fact: string; verified: boolean }>;
}) {
  const has = (category: string, pattern: RegExp) => candidate.facts.some((fact) => fact.verified && fact.category === category && pattern.test(fact.fact));
  return [
    candidate.phone ? "" : "phone",
    candidate.location ? "" : "location",
    has("LINK", /linkedin/i) ? "" : "linkedin",
    has("EDUCATION", /./) ? "" : "education",
    has("CERTIFICATION", /./) ? "" : "certifications",
    has("IDENTITY", /^work authorization:/i) ? "" : "work authorization",
    has("IDENTITY", /^notice period:/i) ? "" : "notice period",
    has("IDENTITY", /^salary expectation:/i) ? "" : "salary expectation",
  ].filter(Boolean);
}
