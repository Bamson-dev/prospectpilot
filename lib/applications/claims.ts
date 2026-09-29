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
  return candidate.facts.filter((fact) => fact.verified).map((fact) => fact.fact);
}
