import { usableEvidence } from "@/lib/applications/evidence-library";
import type { CareerProfile, FactCategory } from "@/lib/applications/types";

export const EVIDENCE_TYPES = [
  "EXPERIENCE",
  "PROJECT",
  "TECHNOLOGY",
  "LANGUAGE",
  "FRAMEWORK",
  "DATABASE",
  "CLOUD",
  "TOOL",
  "RESPONSIBILITY",
  "ACHIEVEMENT",
  "DOMAIN",
  "EDUCATION",
  "CERTIFICATION",
  "SKILL",
  "OTHER",
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const EVIDENCE_VERIFICATIONS = ["VERIFIED", "REVIEW_REQUIRED", "UNVERIFIED", "PENDING_REVIEW", "REJECTED"] as const;

export type EvidenceVerification = (typeof EVIDENCE_VERIFICATIONS)[number];

export type EvidenceOrigin = "CANDIDATE_ENTERED" | "VERIFIED_SOURCE" | "SYSTEM_GENERATED";

export type EvidenceChangeKind = "CREATED" | "UPDATED" | "REPLACED" | "REMOVED" | "VERIFICATION_CHANGED" | "PROFILE_ASSIGNMENT_CHANGED";

export const CAREER_PROFILES: CareerProfile[] = ["SOFTWARE", "WEB", "SAAS", "MARKETING", "GROWTH", "FOUNDER", "HYBRID"];

export const PROFILE_LABELS: Record<CareerProfile, string> = {
  SOFTWARE: "Software Engineer",
  WEB: "Web Developer",
  SAAS: "Product Engineer",
  MARKETING: "Growth Marketer",
  GROWTH: "Growth / GTM",
  FOUNDER: "Founder",
  HYBRID: "Technical Growth",
};

export const EVIDENCE_GROUPS: Array<{ title: string; types: EvidenceType[] }> = [
  { title: "Professional Experience", types: ["EXPERIENCE"] },
  { title: "Projects", types: ["PROJECT"] },
  { title: "Technologies", types: ["TECHNOLOGY"] },
  { title: "Programming Languages", types: ["LANGUAGE"] },
  { title: "Frameworks", types: ["FRAMEWORK"] },
  { title: "Databases", types: ["DATABASE"] },
  { title: "Cloud / Infrastructure", types: ["CLOUD"] },
  { title: "Tools", types: ["TOOL"] },
  { title: "Responsibilities", types: ["RESPONSIBILITY"] },
  { title: "Achievements", types: ["ACHIEVEMENT"] },
  { title: "Domain Experience", types: ["DOMAIN"] },
  { title: "Education", types: ["EDUCATION"] },
  { title: "Certifications", types: ["CERTIFICATION"] },
  { title: "Skills", types: ["SKILL"] },
  { title: "Other Verified Experience", types: ["OTHER"] },
];

const TYPE_STORAGE: Record<EvidenceType, { category: FactCategory; subcategory: string }> = {
  EXPERIENCE: { category: "EXPERIENCE", subcategory: "EXPERIENCE" },
  RESPONSIBILITY: { category: "EXPERIENCE", subcategory: "RESPONSIBILITY" },
  DOMAIN: { category: "EXPERIENCE", subcategory: "DOMAIN" },
  PROJECT: { category: "PROJECT", subcategory: "PROJECT" },
  TECHNOLOGY: { category: "TECHNOLOGY", subcategory: "TECHNOLOGY" },
  LANGUAGE: { category: "TECHNOLOGY", subcategory: "LANGUAGE" },
  FRAMEWORK: { category: "TECHNOLOGY", subcategory: "FRAMEWORK" },
  DATABASE: { category: "TECHNOLOGY", subcategory: "DATABASE" },
  CLOUD: { category: "TECHNOLOGY", subcategory: "CLOUD" },
  TOOL: { category: "TECHNOLOGY", subcategory: "TOOL" },
  ACHIEVEMENT: { category: "ACHIEVEMENT", subcategory: "ACHIEVEMENT" },
  EDUCATION: { category: "EDUCATION", subcategory: "EDUCATION" },
  CERTIFICATION: { category: "CERTIFICATION", subcategory: "CERTIFICATION" },
  SKILL: { category: "SKILL", subcategory: "SKILL" },
  OTHER: { category: "EXPERIENCE", subcategory: "OTHER" },
};

const PRECISE_TYPES = new Set<string>(EVIDENCE_TYPES);

export type EvidenceRecord = {
  id: string;
  claim: string;
  type: EvidenceType;
  category: FactCategory;
  subcategory: string | null;
  source: string;
  origin: EvidenceOrigin;
  storedOrigin: string;
  verification: EvidenceVerification;
  profiles: CareerProfile[];
  duration: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredFact = {
  id: string;
  category: string;
  subcategory?: string | null;
  fact: string;
  source: string;
  sourceType?: string | null;
  verified: boolean;
  verification?: string | null;
  duration?: string | null;
  profiles?: string[];
  technologies?: string[];
  skills?: string[];
  createdAt?: Date;
  updatedAt?: Date;
};

const SECRET = /(api[_ -]?key|password|secret|bearer\s+[a-z0-9._-]{8,}|authorization\s*[:=]\s*\S+|cookie\s*[:=]|token\s*[:=])/i;

export function containsSecret(value: string) {
  return SECRET.test(value);
}

export function factIsAutomaticEvidence(fact: { verified: boolean; sourceType?: string | null; source?: string | null; fact?: string | null; verification?: string | null }) {
  if (fact.verification && fact.verification !== "VERIFIED") return false;
  return usableEvidence(fact);
}

export function storageFor(type: EvidenceType) {
  return TYPE_STORAGE[type];
}

export function evidenceType(category: string, subcategory: string | null | undefined): EvidenceType {
  if (subcategory && PRECISE_TYPES.has(subcategory) && subcategory !== "EXPERIENCE" && subcategory !== "PROJECT" && subcategory !== "TECHNOLOGY" && subcategory !== "ACHIEVEMENT" && subcategory !== "EDUCATION" && subcategory !== "CERTIFICATION" && subcategory !== "SKILL") {
    return subcategory as EvidenceType;
  }
  if (category === "TECHNOLOGY") return "TECHNOLOGY";
  if (category === "SKILL") return "SKILL";
  if (category === "ACHIEVEMENT" || category === "METRIC") return "ACHIEVEMENT";
  if (category === "EDUCATION") return "EDUCATION";
  if (category === "CERTIFICATION") return "CERTIFICATION";
  if (category === "PROJECT") return "PROJECT";
  if (category === "EXPERIENCE") return "EXPERIENCE";
  return "OTHER";
}

export function originFor(sourceType: string | null | undefined): EvidenceOrigin {
  if (sourceType === "SYSTEM_GENERATED") return "SYSTEM_GENERATED";
  if (sourceType === "REPOSITORY_VERIFIED" || sourceType === "DOCUMENT_VERIFIED") return "VERIFIED_SOURCE";
  return "CANDIDATE_ENTERED";
}

export function verificationFor(fact: { verified: boolean; verification?: string | null }): EvidenceVerification {
  if (fact.verification && (EVIDENCE_VERIFICATIONS as readonly string[]).includes(fact.verification)) return fact.verification as EvidenceVerification;
  return fact.verified ? "VERIFIED" : "UNVERIFIED";
}

export function toEvidenceRecord(fact: StoredFact): EvidenceRecord {
  const type = evidenceType(fact.category, fact.subcategory);
  const stored = storageFor(type);
  const now = new Date(0);
  return {
    id: fact.id,
    claim: fact.fact,
    type,
    category: stored.category,
    subcategory: fact.subcategory ?? stored.subcategory,
    source: fact.source,
    origin: originFor(fact.sourceType),
    storedOrigin: fact.sourceType ?? "CANDIDATE_ENTERED",
    verification: verificationFor(fact),
    profiles: (fact.profiles ?? []).filter((profile): profile is CareerProfile => (CAREER_PROFILES as string[]).includes(profile)),
    duration: fact.duration?.trim() ? fact.duration.trim() : null,
    createdAt: fact.createdAt ?? now,
    updatedAt: fact.updatedAt ?? now,
  };
}

export function durationLabel(duration: string | null | undefined) {
  return duration?.trim() ? duration.trim() : "UNKNOWN";
}

export function normalizeClaim(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function evidenceIdentity(type: EvidenceType, claim: string) {
  const technical = type === "TECHNOLOGY" || type === "LANGUAGE" || type === "FRAMEWORK" || type === "DATABASE" || type === "CLOUD" || type === "TOOL";
  return `${technical ? "TECHNOLOGY" : type}:${normalizeClaim(claim)}`;
}

export function groupEvidence(records: EvidenceRecord[]) {
  return EVIDENCE_GROUPS.map((group) => ({
    title: group.title,
    items: records.filter((record) => group.types.includes(record.type)),
  }));
}

export type EvidenceDraft = {
  claim: string;
  type: EvidenceType;
  source: string;
  origin: "CANDIDATE_ENTERED" | "VERIFIED_SOURCE";
  verification: EvidenceVerification;
  profiles: CareerProfile[];
  duration: string | null;
};

export type WritePlan =
  | { action: "reject"; reason: string }
  | { action: "conflict"; existingId: string; reason: string }
  | { action: "create"; draft: EvidenceDraft }
  | { action: "update"; existingId: string; draft: EvidenceDraft; replaced: boolean; verificationChanged: boolean; profilesChanged: boolean };

export function planEvidenceWrite(existing: EvidenceRecord[], draft: EvidenceDraft): WritePlan {
  const claim = draft.claim.replace(/\s+/g, " ").trim();
  const source = draft.source.replace(/\s+/g, " ").trim();
  if (claim.length < 2 || source.length < 3) return { action: "reject", reason: "Evidence needs a claim and a source." };
  if (containsSecret(`${claim} ${source} ${draft.duration ?? ""}`)) return { action: "reject", reason: "Evidence cannot store secrets." };
  if (draft.origin !== "CANDIDATE_ENTERED" && draft.origin !== "VERIFIED_SOURCE") return { action: "reject", reason: "That origin cannot be saved as evidence." };
  const next: EvidenceDraft = { ...draft, claim, source, duration: draft.duration?.trim() ? draft.duration.trim() : null, profiles: uniqueProfiles(draft.profiles) };
  const match = existing.find((record) => evidenceIdentity(record.type, record.claim) === evidenceIdentity(next.type, next.claim));
  if (!match) return { action: "create", draft: next };
  if (match.verification === "VERIFIED" && next.verification !== "VERIFIED") {
    return { action: "conflict", existingId: match.id, reason: "A verified fact already exists and was not downgraded." };
  }
  if (match.verification === "REJECTED" && next.verification !== "VERIFIED") {
    return { action: "conflict", existingId: match.id, reason: "Rejected evidence stays unused until a verified replacement is entered." };
  }
  return {
    action: "update",
    existingId: match.id,
    draft: next,
    replaced: normalizeClaim(match.claim) === normalizeClaim(next.claim) && (match.duration !== next.duration || match.source !== next.source),
    verificationChanged: match.verification !== next.verification,
    profilesChanged: match.profiles.join(",") !== next.profiles.join(","),
  };
}

export function parseEvidenceImport(text: string): { items: EvidenceDraft[]; errors: string[] } {
  const raw = text.trim();
  if (!raw) return { items: [], errors: ["Import text is empty."] };
  if (raw.startsWith("[")) return parseJsonImport(raw);
  return parseCsvImport(raw);
}

export function confirmEvidence(record: EvidenceRecord): EvidenceVerification | null {
  if (record.origin === "SYSTEM_GENERATED") return null;
  if (record.verification !== "PENDING_REVIEW" && record.verification !== "REVIEW_REQUIRED" && record.verification !== "UNVERIFIED") return null;
  return "VERIFIED";
}

export function rejectEvidence(record: EvidenceRecord): EvidenceVerification | null {
  if (record.verification === "REJECTED") return null;
  if (record.origin === "SYSTEM_GENERATED") return "REJECTED";
  return "REJECTED";
}

export function explicitProjectTechnologies(project: { technologies: string[]; verified: boolean; description?: string }) {
  if (!project.verified) return [];
  return project.technologies.map((item) => item.trim()).filter(Boolean);
}

export function explicitYears(duration: string | null | undefined) {
  if (!duration) return null;
  const match = duration.match(/(\d{1,2})\s*(?:years|yrs)/i);
  return match ? Number(match[1]) : null;
}

export function explicitProficiency(claim: string) {
  const match = claim.match(/\b(beginner|intermediate|advanced|expert)\b/i);
  return match ? match[1] : null;
}

export function verifiedConflicts(records: EvidenceRecord[]) {
  const groups = new Map<string, EvidenceRecord[]>();
  for (const record of records) {
    if (record.verification !== "VERIFIED") continue;
    const key = evidenceIdentity(record.type, record.claim);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const conflicts: string[] = [];
  for (const group of groups.values()) {
    const durations = new Set(group.map((record) => record.duration ?? ""));
    if (group.length > 1 && durations.size > 1) conflicts.push(`${group[0]?.claim} has conflicting verified durations.`);
  }
  return conflicts;
}

export function evidenceForProfile(records: EvidenceRecord[], profile: CareerProfile) {
  const technical = new Set<EvidenceType>(["PROJECT", "TECHNOLOGY", "LANGUAGE", "FRAMEWORK", "DATABASE", "CLOUD", "TOOL", "RESPONSIBILITY"]);
  const growth = new Set<EvidenceType>(["ACHIEVEMENT", "DOMAIN", "EXPERIENCE", "SKILL"]);
  return records.filter((record) => {
    if (!factIsAutomaticEvidence({ verified: record.verification === "VERIFIED", verification: record.verification, sourceType: record.storedOrigin, source: record.source, fact: record.claim })) return false;
    if (record.profiles.length && !record.profiles.includes(profile)) return false;
    if (profile === "SOFTWARE" || profile === "WEB" || profile === "SAAS") return technical.has(record.type) || record.type === "ACHIEVEMENT" || record.type === "EDUCATION" || record.type === "CERTIFICATION";
    if (profile === "MARKETING" || profile === "GROWTH") return growth.has(record.type) || record.type === "TOOL" || record.type === "PROJECT";
    return true;
  });
}

export function reviewerMapping(requirement: string, records: EvidenceRecord[]) {
  const allowed = records.filter((record) => factIsAutomaticEvidence({
    verified: record.verification === "VERIFIED",
    verification: record.verification,
    sourceType: record.storedOrigin,
    source: record.source,
    fact: record.claim,
  }));
  const match = allowed.find((record) => requirement.toLowerCase().includes(record.claim.toLowerCase()) || record.claim.toLowerCase().includes(requirement.toLowerCase()));
  if (!match) {
    return { requirement, evidence: null, type: null, classification: "MISSING" as const, source: null, verification: null };
  }
  return {
    requirement,
    evidence: match.claim,
    type: match.type,
    classification: "DIRECT" as const,
    source: match.origin,
    verification: match.verification,
  };
}

export function historyDetail(action: EvidenceChangeKind, claim: string) {
  const clean = claim.replace(SECRET, "[redacted]").replace(/\s+/g, " ").trim().slice(0, 240);
  if (action === "CREATED") return `Created ${clean}`;
  if (action === "UPDATED") return `Updated ${clean}`;
  if (action === "REPLACED") return `Replaced ${clean}`;
  if (action === "REMOVED") return `Removed ${clean}`;
  if (action === "VERIFICATION_CHANGED") return `Verification changed for ${clean}`;
  return `Profile assignment changed for ${clean}`;
}

function uniqueProfiles(profiles: CareerProfile[]) {
  return CAREER_PROFILES.filter((profile) => profiles.includes(profile));
}

function parseJsonImport(raw: string): { items: EvidenceDraft[]; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { items: [], errors: ["Import JSON could not be read."] };
  }
  if (!Array.isArray(parsed)) return { items: [], errors: ["Import JSON must be a list."] };
  const items: EvidenceDraft[] = [];
  const errors: string[] = [];
  parsed.forEach((row, index) => {
    const draft = draftFromRow(row);
    if (!draft) errors.push(`Row ${index + 1} is missing a claim, type, or source.`);
    else if ("error" in draft) errors.push(draft.error);
    else items.push(draft);
  });
  return { items, errors };
}

function parseCsvImport(raw: string): { items: EvidenceDraft[]; errors: string[] } {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines[0]?.toLowerCase() ?? "";
  const body = header.includes("claim") ? lines.slice(1) : lines;
  const items: EvidenceDraft[] = [];
  const errors: string[] = [];
  body.forEach((line, index) => {
    const [claim, type, source, profiles, duration] = splitCsv(line);
    const draft = draftFromRow({ claim, type, source, profiles, duration });
    if (!draft) errors.push(`Row ${index + 1} is missing a claim, type, or source.`);
    else if ("error" in draft) errors.push(draft.error);
    else items.push(draft);
  });
  return { items, errors };
}

function draftFromRow(row: unknown): EvidenceDraft | { error: string } | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  const claim = String(value.claim ?? value.fact ?? "").trim();
  const type = String(value.type ?? value.category ?? "").trim().toUpperCase();
  const source = String(value.source ?? "").trim();
  if (!claim || !source || !PRECISE_TYPES.has(type)) return null;
  if (containsSecret(`${claim} ${source}`)) return { error: "Import row contains a secret and was skipped." };
  const profiles = Array.isArray(value.profiles)
    ? value.profiles.map((item) => String(item).trim().toUpperCase())
    : String(value.profiles ?? "").split(/[|,]/).map((item) => item.trim().toUpperCase()).filter(Boolean);
  return {
    claim,
    type: type as EvidenceType,
    source,
    origin: "CANDIDATE_ENTERED",
    verification: "PENDING_REVIEW",
    profiles: profiles.filter((profile): profile is CareerProfile => (CAREER_PROFILES as string[]).includes(profile)),
    duration: String(value.duration ?? "").trim() || null,
  };
}

function splitCsv(line: string) {
  return line.split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
}

export function testEvidenceFixture(): EvidenceRecord[] {
  const now = new Date("2026-09-29T00:00:00.000Z");
  const row = (input: Omit<EvidenceRecord, "createdAt" | "updatedAt" | "category" | "subcategory" | "storedOrigin"> & { storedOrigin?: string }): EvidenceRecord => {
    const stored = storageFor(input.type);
    return {
      ...input,
      category: stored.category,
      subcategory: stored.subcategory,
      storedOrigin: input.storedOrigin ?? (input.origin === "VERIFIED_SOURCE" ? "REPOSITORY_VERIFIED" : input.origin === "SYSTEM_GENERATED" ? "SYSTEM_GENERATED" : "CANDIDATE_ENTERED"),
      createdAt: now,
      updatedAt: now,
    };
  };
  return [
    row({ id: "ts", claim: "TypeScript", type: "LANGUAGE", source: "ProspectPilot project", origin: "CANDIDATE_ENTERED", verification: "VERIFIED", profiles: ["SOFTWARE", "WEB"], duration: null }),
    row({ id: "pg", claim: "PostgreSQL", type: "DATABASE", source: "ProspectPilot project", origin: "CANDIDATE_ENTERED", verification: "VERIFIED", profiles: ["SOFTWARE"], duration: null }),
    row({ id: "graphql", claim: "GraphQL", type: "TECHNOLOGY", source: "import", origin: "CANDIDATE_ENTERED", verification: "REVIEW_REQUIRED", profiles: ["SOFTWARE"], duration: null }),
    row({ id: "saas", claim: "ProspectPilot SaaS product", type: "PROJECT", source: "ProspectPilot project", origin: "VERIFIED_SOURCE", verification: "VERIFIED", profiles: ["SOFTWARE", "SAAS", "FOUNDER", "HYBRID"], duration: null }),
    row({ id: "growth", claim: "PromptEarn growth marketing", type: "EXPERIENCE", source: "candidate brief", origin: "CANDIDATE_ENTERED", verification: "VERIFIED", profiles: ["MARKETING", "GROWTH", "FOUNDER"], duration: null }),
    row({ id: "salary", claim: "Salary expectation: 100000 USD per year", type: "OTHER", source: "candidate-settings", origin: "CANDIDATE_ENTERED", verification: "VERIFIED", profiles: [], duration: null }),
    row({ id: "education", claim: "Education, Example University, BSc", type: "EDUCATION", source: "candidate-settings", origin: "CANDIDATE_ENTERED", verification: "VERIFIED", profiles: ["SOFTWARE"], duration: null }),
    row({ id: "rating", claim: "TypeScript proficiency", type: "SKILL", source: "import", origin: "CANDIDATE_ENTERED", verification: "REVIEW_REQUIRED", profiles: ["SOFTWARE"], duration: null }),
    row({ id: "generated", claim: "Generated a CV sentence about Rust.", type: "EXPERIENCE", source: "generated-cv", origin: "SYSTEM_GENERATED", verification: "VERIFIED", profiles: ["SOFTWARE"], duration: null, storedOrigin: "SYSTEM_GENERATED" }),
  ];
}
