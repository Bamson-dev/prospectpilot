import type { CandidateRecord } from "@/lib/applications/types";

const COMMON_TECH = [
  "react", "vue", "angular", "kubernetes", "aws", "azure", "gcp", "java", "golang", "go", "ruby", "php",
  "django", "spring", "terraform", "docker", "graphql", "swift", "kotlin", "dotnet", "salesforce", "rust",
];

export type ClaimCheck = { ok: boolean; unsupported: string[] };

export function unsupportedClaims(text: string, candidate: CandidateRecord, allowedNames: string[] = []): ClaimCheck {
  const corpus = [
    candidate.fullName,
    ...candidate.facts.filter((fact) => fact.verified && fact.sourceType !== "SYSTEM_GENERATED").map((fact) => fact.fact),
    ...candidate.facts.filter((fact) => fact.verified && fact.sourceType !== "SYSTEM_GENERATED").flatMap((fact) => [...(fact.technologies ?? []), ...(fact.skills ?? [])]),
    ...candidate.projects.filter((project) => project.verified).flatMap((project) => [project.name, project.description, project.role, ...project.technologies, ...project.features, ...project.outcomes, ...project.metrics]),
    ...candidate.experiences.filter((item) => item.verified).map((item) => `${item.title} ${item.organizationName} ${item.summary}`),
  ].join(" ").toLowerCase();
  const unsupported = new Set<string>();
  for (const tech of COMMON_TECH) {
    if (new RegExp(`\\b${tech.replace(/[.#+]/g, "\\$&")}\\b`, "i").test(text) && !corpus.includes(tech)) unsupported.add(tech);
  }
  const allowed = new Set(allowedNames.map((name) => name.toLowerCase()));
  const employers = text.match(/\bat[ \t]+([A-Z][A-Za-z0-9&'-]+(?:[ \t]+[A-Z][A-Za-z0-9&'-]+){0,3})/g) ?? [];
  for (const phrase of employers) {
    const name = phrase.replace(/^at\s+/i, "");
    if (allowed.has(name.toLowerCase())) continue;
    if (!corpus.includes(name.toLowerCase()) && !candidate.projects.some((project) => project.name.toLowerCase() === name.toLowerCase())) {
      unsupported.add(name);
    }
  }
  if (!candidate.facts.some((fact) => fact.category === "EDUCATION" && fact.verified)) {
    for (const sentence of text.split(/[.\n]/)) {
      if (/\b(ph\.?d|mba|bachelor|master'?s degree)\b/i.test(sentence) && !/\b(required|preferred|missing|gap|open points|not claimed)\b/i.test(sentence)) {
        unsupported.add("education credential");
      }
    }
  }
  return { ok: unsupported.size === 0, unsupported: [...unsupported] };
}

export function verifiedCorpus(candidate: CandidateRecord) {
  return candidate.facts.filter((fact) => fact.verified && fact.sourceType !== "SYSTEM_GENERATED").map((fact) => fact.fact);
}

export type CvClaimIssue = {
  kind: "employer" | "technology" | "metric" | "duration" | "certification" | "education" | "job title" | "achievement" | "responsibility";
  value: string;
};

export function validateCvFacts(text: string, candidate: CandidateRecord, allowedNames: string[] = []) {
  const corpus = [
    ...verifiedCorpus(candidate),
    ...candidate.projects.filter((project) => project.verified).flatMap((project) => [project.name, project.description, project.role, ...project.technologies, ...project.features, ...project.outcomes, ...project.metrics]),
    ...candidate.experiences.filter((item) => item.verified).flatMap((item) => [item.title, item.organizationName, item.summary]),
    candidate.fullName,
    ...allowedNames,
  ].join(" ").toLowerCase();
  const issues: CvClaimIssue[] = [];
  const base = unsupportedClaims(text, candidate, allowedNames);
  for (const value of base.unsupported) {
    issues.push({ kind: value === "education credential" ? "education" : COMMON_TECH.includes(value.toLowerCase()) ? "technology" : "employer", value });
  }
  for (const match of text.matchAll(/\b(\d{1,2})\s*(?:\+|plus)?\s*years?\b/gi)) {
    const phrase = match[0].toLowerCase();
    if (!corpus.includes(phrase) && !corpus.includes(`${match[1]} year`)) issues.push({ kind: "duration", value: match[0] });
  }
  for (const match of text.matchAll(/\$\d[\d,]*(?:\.\d+)?(?:\s*(?:million|billion|k|m))?|\b\d+(?:\.\d+)?%/gi)) {
    if (!corpus.includes(match[0].toLowerCase())) issues.push({ kind: "metric", value: match[0] });
  }
  for (const match of text.matchAll(/\b(aws certified|pmp|cissp|comptia [a-z0-9+]+)\b/gi)) {
    if (!corpus.includes(match[0].toLowerCase())) issues.push({ kind: "certification", value: match[0] });
  }
  const allowedTitles = new Set(candidate.experiences.filter((item) => item.verified).map((item) => item.title.toLowerCase()));
  for (const name of allowedNames) allowedTitles.add(name.toLowerCase());
  for (const match of text.matchAll(/\b(?:i worked as|title:)\s+([A-Za-z][A-Za-z0-9 /+-]{2,60})/gi)) {
    const title = match[1].trim().replace(/[.]/g, "");
    if (!allowedTitles.has(title.toLowerCase()) && !corpus.includes(title.toLowerCase())) issues.push({ kind: "job title", value: title });
  }
  for (const match of text.matchAll(/\bresponsible for ([a-z][^.]{3,80})/gi)) {
    if (!corpus.includes(match[1].trim().toLowerCase())) issues.push({ kind: "responsibility", value: match[1].trim() });
  }
  return { status: issues.length ? "REVIEW_REQUIRED" as const : "PASS" as const, issues };
}
