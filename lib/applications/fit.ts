import { factIsAutomaticEvidence } from "@/lib/applications/evidence-management";
import type { CandidateFactInput, CandidateProjectInput, CandidateRecord, CareerProfile, ExtractedRequirement, JobInput } from "@/lib/applications/types";
import { selectEvidence, type EvidenceSelection } from "@/lib/applications/evidence-selection";
import { contactIsReady } from "@/lib/applications/seed-data";
import { canonicalTechnology, technologiesMentioned } from "@/lib/applications/technologies";

const PROFILE_TERMS: Record<CareerProfile, string[]> = {
  SOFTWARE: ["software", "engineer", "backend", "frontend", "full-stack", "fullstack", "api", "developer"],
  WEB: ["web design", "web designer", "website", "landing page", "ui", "web developer"],
  MARKETING: ["marketing", "performance", "acquisition", "ads", "brand", "demand", "affiliate"],
  SAAS: ["saas", "product manager", "product engineer", "platform"],
  GROWTH: ["go-to-market", "gtm", "head of growth", "growth lead", "partnerships"],
  FOUNDER: ["founder", "co-founder", "owner"],
  HYBRID: ["growth engineer", "technical marketing", "full-stack marketer"],
};

export type EvidenceLink = { requirement: string; fact: string };

export type FitResult = {
  profile: CareerProfile;
  overallMatch: number;
  profileMatch: number;
  requirementMatches: string[];
  missingRequirements: string[];
  preferredMatches: string[];
  preferredGaps: string[];
  evidence: EvidenceLink[];
  transferable: string[];
  uncertain: string[];
  blockers: string[];
  missingInformation: string[];
  strongEvidence: string[];
  weakEvidence: string[];
  advantages: string[];
  gaps: string[];
  selectedFacts: CandidateFactInput[];
  selectedProjects: CandidateProjectInput[];
  recommendedExperiences: string[];
  recommendedSkills: string[];
  recommendedKeywords: string[];
  cvStructure: string[];
  responsibilities: string[];
  recommendation: "PREPARE" | "REVIEW" | "MANUAL_REVIEW" | "DO_NOT_PREPARE" | "SKIP";
  selections: EvidenceSelection[];
};

export function scoreJobFit(job: JobInput, candidate: CandidateRecord, requirements: ExtractedRequirement[]): FitResult {
  const profile = chooseProfile(job);
  const verifiedFacts = candidate.facts.filter((fact) => usableFact(fact));
  const verifiedProjects = candidate.projects.filter((project) => project.verified && hasEvidence(project));
  const corpus = evidenceText(verifiedFacts, verifiedProjects, candidate.experiences.filter((item) => item.verified));
  const required = requirements.filter((item) => isRequired(item));
  const preferred = requirements.filter((item) => item.certainty === "preferred" || (!item.certainty && !isRequired(item) && !META_KINDS.includes(item.kind)));
  const matched: string[] = [];
  const missing: string[] = [];
  const evidence: EvidenceLink[] = [];
  const uncertain = requirements.filter((item) => item.certainty === "uncertain" || item.kind === "SOFT_SKILL" || /authorization|visa|notice|salary/i.test(item.text)).map((item) => item.text);
  const responsibilities = requirements.filter((item) => item.certainty === "responsibility" || item.kind === "RESPONSIBILITY").map((item) => item.text);
  for (const requirement of required) {
    const years = yearsVerdict(requirement, candidate, verifiedFacts);
    if (years === "unknown" || (/\d+\+?\s*(?:years|yrs)/i.test(requirement.text) && statedYears(candidate, verifiedFacts, requirement) == null)) {
      uncertain.push(`${requirement.text} Experience duration: UNKNOWN.`);
      continue;
    }
    const support = years === "matched" ? yearsEvidence(requirement, candidate, verifiedFacts) : supportingFact(requirement, verifiedFacts, corpus);
    if (support) {
      matched.push(requirement.text);
      evidence.push({ requirement: requirement.text, fact: support });
    } else missing.push(requirement.text);
  }
  const preferredMatches: string[] = [];
  const preferredGaps: string[] = [];
  for (const requirement of preferred) {
    const years = yearsVerdict(requirement, candidate, verifiedFacts);
    if (years === "unknown" || (/\d+\+?\s*(?:years|yrs)/i.test(requirement.text) && statedYears(candidate, verifiedFacts, requirement) == null)) {
      uncertain.push(`${requirement.text} Experience duration: UNKNOWN.`);
      continue;
    }
    const support = years === "matched" ? yearsEvidence(requirement, candidate, verifiedFacts) : supportingFact(requirement, verifiedFacts, corpus);
    if (support) preferredMatches.push(requirement.text);
    else preferredGaps.push(requirement.text);
  }
  const blockers = missing.filter((item) => /bachelor|degree|certification|phd|mba/i.test(item));
  const transferable = verifiedFacts
    .filter((fact) => fact.category === "EXPERIENCE" || fact.category === "METRIC")
    .slice(0, 3)
    .map((fact) => fact.fact);
  const missingInformation = [
    contactIsReady(candidate.email) ? "" : "email",
    candidate.location ? "" : "location",
    candidate.phone ? "" : "phone",
    candidate.facts.some((fact) => fact.category === "EDUCATION" && usableFact(fact)) ? "" : "education",
    candidate.facts.some((fact) => fact.category === "CERTIFICATION" && usableFact(fact)) ? "" : "certifications",
    candidate.facts.some((fact) => fact.category === "LINK" && /linkedin/i.test(fact.fact) && usableFact(fact)) ? "" : "linkedin",
    candidate.workAuthorization ? "" : "work authorization",
  ].filter(Boolean);
  const projectHits = verifiedProjects.filter((project) => overlaps(`${job.title} ${job.description}`, projectText(project)));
  const profileMatch = profileScore(job, profile);
  const mustScore = required.length === 0 ? 70 : Math.round((matched.length / required.length) * 100);
  const projectScore = verifiedProjects.length === 0 ? 0 : Math.round((Math.max(projectHits.length, verifiedProjects.length ? 1 : 0) / verifiedProjects.length) * 100);
  const overall = clamp(Math.round(mustScore * 0.6 + profileMatch * 0.25 + Math.min(projectScore, 100) * 0.15));
  const selectedFacts = rankFacts(verifiedFacts, job, profile).filter(f => overlapCount(f.fact, `${job.title} ${job.description}`.toLowerCase()) > 0 || f.profiles.includes(profile)).slice(0, 8);
  const rankedProjects = rankProjects(verifiedProjects, job, profile);
  const selectedProjects = rankedProjects.filter(p => overlapCount(projectText(p), `${job.title} ${job.description}`.toLowerCase()) > 0 || p.profiles.includes(profile)).slice(0, 3);
  const skills = unique(selectedFacts.flatMap((fact) => fact.skills ?? []).concat(selectedProjects.flatMap((project) => project.technologies)));
  const legalUnknown = uncertain.some((item) => /authorization|visa|salary|notice|location/i.test(item)) || missingInformation.includes("work authorization");
  const evidenceFacts = candidate.yearsExperience == null
    ? verifiedFacts
    : [...verifiedFacts, { fact: `${candidate.yearsExperience} years are recorded on the candidate profile.`, technologies: [] as string[] }];
  const selections = requirements.flatMap((requirement) => {
    const selection = selectionFor(requirement, evidenceFacts);
    return selection ? [selection] : [];
  });
  const requirementSelections = selections;
  const recommendation = selectedFacts.length === 0 && selectedProjects.length === 0
    ? "DO_NOT_PREPARE"
    : blockers.length || missing.length
      ? "REVIEW"
      : legalUnknown
        ? "MANUAL_REVIEW"
        : "PREPARE";
  return {
    profile,
    overallMatch: overall,
    profileMatch,
    requirementMatches: matched,
    missingRequirements: missing,
    preferredMatches,
    preferredGaps,
    evidence,
    transferable,
    uncertain,
    blockers,
    missingInformation,
    strongEvidence: selectedFacts.slice(0, 4).map((fact) => fact.fact),
    weakEvidence: selectedFacts.slice(4).map((fact) => fact.fact),
    advantages: selectedProjects.map((project) => project.name),
    gaps: missing,
    selectedFacts,
    selectedProjects,
    recommendedExperiences: candidate.experiences.filter((item) => item.verified)
      .sort((a, b) => {
        const leftScore = overlapCount(`${a.title} ${a.organizationName} ${a.summary}`, `${job.title} ${job.description}`.toLowerCase()) + (a.profiles.includes(profile) ? 2 : 0);
        const rightScore = overlapCount(`${b.title} ${b.organizationName} ${b.summary}`, `${job.title} ${job.description}`.toLowerCase()) + (b.profiles.includes(profile) ? 2 : 0);
        return rightScore - leftScore;
      })
      .filter((item) => overlapCount(`${item.title} ${item.summary}`, `${job.title} ${job.description}`.toLowerCase()) > 0 || item.profiles.includes(profile))
      .map((item) => `${item.title}, ${item.organizationName}`),
    recommendedSkills: skills.slice(0, 12),
    recommendedKeywords: skills.slice(0, 8),
    cvStructure: ["Summary", "Skills", "Experience", "Projects"],
    responsibilities: unique(responsibilities).slice(0, 8),
    recommendation,
    selections: requirementSelections,
  };
}

export function chooseProfile(job: JobInput): CareerProfile {
  const title = job.title.toLowerCase();
  const text = `${title} ${job.description}`.toLowerCase();
  if (/web design|web designer|landing page|website designer/.test(title)) return "WEB";
  if (/founder|co-founder/.test(title)) return "FOUNDER";
  if (/go-to-market|\bgtm\b|head of growth|growth lead/.test(title)) return "GROWTH";
  if (/performance marketing|growth marketing|digital marketing|marketing manager/.test(title)) return "MARKETING";
  if (/technical project manager/.test(title)) return "HYBRID";
  if (/product manager|product engineer/.test(title)) return "SAAS";
  if (/\bproject manager\b|\bprogram manager\b|\bdelivery manager\b/.test(title)) return "FOUNDER";
  if (/business development|partnership manager|head of partnerships/.test(title)) return "GROWTH";
  if (/operations manager|chief of staff|\bstrategy\b/.test(title)) return "FOUNDER";
  if (/frontend developer|front-end developer|web developer|website developer|landing page developer|e-?commerce developer|ui-focused/.test(title)) return "WEB";
  const software = scoreTerms(text, PROFILE_TERMS.SOFTWARE);
  const marketing = scoreTerms(text, PROFILE_TERMS.MARKETING) + scoreTerms(text, PROFILE_TERMS.GROWTH);
  if (software > 0 && marketing > 0 && /growth|marketing/.test(title) && /engineer|developer/.test(title)) return "HYBRID";
  if (/engineer|developer|full-stack|fullstack|backend/.test(title)) return "SOFTWARE";
  if (marketing > software) return "MARKETING";
  return "SOFTWARE";
}

const META_KINDS = ["RESPONSIBILITY", "SALARY", "REMOTE_POLICY", "EMPLOYMENT_TYPE", "APPLICATION_PLATFORM", "APPLICATION_METHOD", "LOCATION"];

function isRequired(item: ExtractedRequirement) {
  if (item.certainty === "preferred" || item.certainty === "uncertain" || item.certainty === "responsibility") return false;
  if (item.certainty === "required") return item.kind !== "RESPONSIBILITY";
  return item.required || item.kind === "MUST_HAVE" || item.kind === "EDUCATION";
}

function selectionFor(requirement: ExtractedRequirement, facts: Parameters<typeof selectEvidence>[1]) {
  const role = requirement.role;
  if (role === "RESPONSIBILITY" || role === "CONTEXT") return null;
  if (role === "UNKNOWN") {
    return {
      requirement: requirement.text,
      evidence: null,
      source: null,
      match: "UNCERTAIN" as const,
      confidence: 0.4,
      reason: "The employer wording does not state a concrete hard requirement.",
    };
  }
  return selectEvidence(requirement.text, facts);
}

function usableFact(fact: CandidateFactInput) {
  return factIsAutomaticEvidence(fact);
}

function yearsVerdict(requirement: ExtractedRequirement, candidate: CandidateRecord, facts: CandidateFactInput[]) {
  if (requirement.kind !== "EXPERIENCE_YEARS" || !requirement.years) return "other" as const;
  const stated = statedYears(candidate, facts, requirement);
  if (stated == null) return "unknown" as const;
  return stated >= requirement.years ? "matched" as const : "short" as const;
}

function yearsEvidence(requirement: ExtractedRequirement, candidate: CandidateRecord, facts: CandidateFactInput[]) {
  const fact = facts.find((item) => new RegExp(`${requirement.years}\\+?\\s*(?:years|yrs)`, "i").test(item.fact));
  if (fact) return fact.fact;
  if (candidate.yearsExperience != null) return `${candidate.yearsExperience} years are recorded on the candidate profile.`;
  return undefined;
}

function statedYears(candidate: CandidateRecord, facts: CandidateFactInput[], requirement?: ExtractedRequirement) {
  const named = requirement ? technologiesMentioned(requirement.text) : [];
  const fact = facts.map((item) => {
    const match = item.fact.match(/(\d{1,2})\+?\s*(?:years|yrs)/i);
    if (!match) return null;
    if (named.length && !named.some((name) => (item.technologies ?? []).some((tech) => canonicalTechnology(tech) === name) || canonicalTechnology(item.fact) === name)) return null;
    return Number(match[1]);
  }).find((value) => value != null);
  if (fact != null) return fact;
  if (named.length) return null;
  return candidate.yearsExperience ?? null;
}

function hasEvidence(project: CandidateProjectInput) {
  return project.technologies.length > 0 || project.outcomes.length > 0 || project.metrics.length > 0;
}

function supportingFact(requirement: ExtractedRequirement, facts: CandidateFactInput[], corpus: string) {
  if (requirement.kind === "EXPERIENCE_YEARS" && requirement.years) {
    const fact = facts.find((item) => new RegExp(`${requirement.years}\\+?\\s*(?:years|yrs)`, "i").test(item.fact));
    return fact?.fact;
  }
  if (/bachelor|degree|mba|phd|certification/.test(requirement.text.toLowerCase())) {
    const fact = facts.find((item) => (item.category === "EDUCATION" || item.category === "CERTIFICATION") && item.verified);
    return fact?.fact;
  }
  if (requirement.kind === "TECHNOLOGY") {
    const fact = facts.find((item) => (item.technologies ?? []).some((tech) => sameName(requirement.text, tech)));
    return fact?.fact;
  }
  if (!overlaps(requirement.text, corpus)) return undefined;
  const ranked = rankFacts(facts, { title: requirement.text, companyName: "", description: requirement.text, applicationUrl: "" });
  return ranked[0]?.fact;
}

function profileScore(job: JobInput, profile: CareerProfile) {
  const terms = PROFILE_TERMS[profile];
  const hits = scoreTerms(`${job.title} ${job.description}`.toLowerCase(), terms);
  return clamp(Math.round((hits / terms.length) * 100));
}

function scoreTerms(text: string, terms: string[]) {
  return terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
}

function evidenceText(facts: CandidateFactInput[], projects: CandidateProjectInput[], experiences: CandidateRecord["experiences"]) {
  return [
    ...facts.map((fact) => [fact.fact, ...(fact.skills ?? []), ...(fact.technologies ?? []), ...(fact.keywords ?? [])].join(" ")),
    ...projects.map((project) => projectText(project)),
    ...experiences.map((item) => `${item.title} ${item.organizationName} ${item.summary}`),
  ].join(" ").toLowerCase();
}

function projectText(project: CandidateProjectInput) {
  return [project.name, project.description, project.role, ...project.technologies, ...project.features, ...project.outcomes, ...project.metrics].join(" ");
}

function overlaps(left: string, right: string) {
  const tokens = tokenize(left);
  if (tokens.length === 0) return false;
  const haystack = right.toLowerCase();
  const hits = tokens.filter((token) => haystack.includes(token));
  return hits.length >= Math.min(2, tokens.length);
}

function tokenize(value: string) {
  return value.toLowerCase().split(/[^a-z0-9+#.]+/).filter((token) => token.length > 3 && !["with", "this", "that", "from", "your", "have", "will", "role"].includes(token));
}

function rankFacts(facts: CandidateFactInput[], job: JobInput, profile?: CareerProfile) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  return [...facts].sort((left, right) => {
    const leftScore = overlapCount(left.fact, text) + (profile && left.profiles.includes(profile) ? 2 : 0);
    const rightScore = overlapCount(right.fact, text) + (profile && right.profiles.includes(profile) ? 2 : 0);
    return rightScore - leftScore;
  });
}

function rankProjects(projects: CandidateProjectInput[], job: JobInput, profile?: CareerProfile) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  return [...projects].sort((left, right) => {
    const leftScore = overlapCount(projectText(left), text) + (profile && left.profiles.includes(profile) ? 2 : 0);
    const rightScore = overlapCount(projectText(right), text) + (profile && right.profiles.includes(profile) ? 2 : 0);
    return rightScore - leftScore;
  });
}

function overlapCount(fact: string, text: string) {
  return tokenize(fact).filter((token) => text.includes(token)).length;
}

function sameName(requirement: string, technology: string) {
  const wanted = canonicalTechnology(technology);
  return wanted.length > 1 && requirement.toLowerCase().split(/[^a-z0-9+#.]+/).some((token) => canonicalTechnology(token) === wanted);
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}
