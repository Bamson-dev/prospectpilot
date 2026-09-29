export type EvidenceGroup = "EXPERIENCE" | "PROJECT" | "SKILL" | "TECHNOLOGY" | "ACHIEVEMENT" | "EDUCATION" | "CERTIFICATION" | "CONTACT" | "PREFERENCE";

export type EvidenceItem = {
  group: EvidenceGroup;
  value: string;
  source: string;
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
  projects?: Array<{ name: string; source: string; verified: boolean; technologies: string[]; profiles?: string[] }>;
}) {
  const items: EvidenceItem[] = [];
  for (const fact of input.facts) {
    if (!fact.verified || fact.sourceType === "SYSTEM_GENERATED") continue;
    const group = groupFor(fact.category, fact.subcategory ?? "");
    if (!group) continue;
    items.push({
      group,
      value: fact.fact,
      source: fact.source,
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
      verification: "VERIFIED",
      usableFor: labels(project.profiles ?? []),
    });
  }
  return items;
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
