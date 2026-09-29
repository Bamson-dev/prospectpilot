export type EvidenceGroup = "EXPERIENCE" | "PROJECT" | "SKILL" | "TECHNOLOGY" | "ACHIEVEMENT" | "EDUCATION" | "CERTIFICATION" | "CONTACT" | "PREFERENCE";

export type EvidenceOrigin = "CANDIDATE_ENTERED" | "REPOSITORY_VERIFIED" | "DOCUMENT_VERIFIED";

export type EvidenceItem = {
  group: EvidenceGroup;
  value: string;
  source: string;
  origin: EvidenceOrigin;
  verification: "VERIFIED";
  usableFor: string[];
};

const PROFILE_LABELS: Record<string, string> = {
  SOFTWARE: "Software",
  WEB: "Web",
  SAAS: "Product",
  MARKETING: "Marketing",
  GROWTH: "GTM",
  FOUNDER: "Founder",
  HYBRID: "Technical and Growth",
};

export function evidenceLibrary(input: {
  facts: Array<{ category: string; subcategory?: string | null; fact: string; source: string; sourceType?: string | null; verified: boolean; profiles?: string[] }>;
  projects?: Array<{ name: string; source: string; sourceType?: string | null; verified: boolean; technologies: string[]; profiles?: string[] }>;
}) {
  const items: EvidenceItem[] = [];
  for (const fact of input.facts) {
    if (!usableEvidence(fact)) continue;
    const group = groupFor(fact.category, fact.subcategory ?? "");
    if (!group) continue;
    items.push({
      group,
      value: fact.fact,
      source: fact.source,
      origin: originFor(fact.sourceType, fact.source),
      verification: "VERIFIED",
      usableFor: labels(fact.profiles ?? []),
    });
  }
  for (const project of input.projects ?? []) {
    if (!project.verified) continue;
    items.push({
      group: "PROJECT",
      value: project.technologies.length ? `${project.name}: ${project.technologies.join(", ")}` : project.name,
      source: project.source,
      origin: originFor(project.sourceType, project.source),
      verification: "VERIFIED",
      usableFor: labels(project.profiles ?? []),
    });
  }
  return items;
}

export function usableEvidence(fact: { verified: boolean; sourceType?: string | null; source?: string | null; fact?: string | null; verification?: string | null }) {
  if (fact.verification && fact.verification !== "VERIFIED") return false;
  if (!fact.verified || fact.sourceType === "SYSTEM_GENERATED") return false;
  const source = `${fact.source ?? ""} ${fact.fact ?? ""}`;
  return !/generated[- ](?:cv|cover|document)|cover letter text|cv text/i.test(source);
}

export function supportsClaim(claim: string, items: EvidenceItem[]) {
  const text = claim.trim().toLowerCase();
  if (!text) return null;
  return items.find((item) => item.value.toLowerCase().includes(text) || text.includes(item.value.toLowerCase())) ?? null;
}

function originFor(sourceType: string | null | undefined, source: string | null | undefined): EvidenceOrigin {
  if (sourceType === "REPOSITORY_VERIFIED" || sourceType === "DOCUMENT_VERIFIED" || sourceType === "CANDIDATE_ENTERED") return sourceType;
  if (/repository/i.test(source ?? "")) return "REPOSITORY_VERIFIED";
  if (/document/i.test(source ?? "")) return "DOCUMENT_VERIFIED";
  return "CANDIDATE_ENTERED";
}

function groupFor(category: string, subcategory: string): EvidenceGroup | null {
  if (category === "TECHNOLOGY") return "TECHNOLOGY";
  if (category === "SKILL") return "SKILL";
  if (category === "ACHIEVEMENT" || category === "METRIC") return "ACHIEVEMENT";
  if (category === "EDUCATION") return "EDUCATION";
  if (category === "CERTIFICATION") return "CERTIFICATION";
  if (category === "PROJECT") return "PROJECT";
  if (category === "EXPERIENCE") return "EXPERIENCE";
  if (category === "LINK") return "CONTACT";
  if (category === "IDENTITY" && /salary|availability|sponsorship|authorization|notice|remote|relocation/.test(subcategory)) return "PREFERENCE";
  if (category === "IDENTITY") return "CONTACT";
  return null;
}

function labels(profiles: string[]) {
  return profiles.map((profile) => PROFILE_LABELS[profile] ?? profile);
}
