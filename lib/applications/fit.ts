import type { CandidateFactInput, CandidateProjectInput, CandidateRecord, CareerProfile, ExtractedRequirement, JobInput } from "@/lib/applications/types";
import { contactIsReady } from "@/lib/applications/seed-data";

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
  recommendation: "PREPARE" | "REVIEW" | "SKIP";
};

export function scoreJobFit(job: JobInput, candidate: CandidateRecord, requirements: ExtractedRequirement[]): FitResult {
  const profile = chooseProfile(job);
  const verifiedFacts = candidate.facts.filter((fact) => fact.verified && fact.profiles.includes(profile));
  const verifiedProjects = candidate.projects.filter((project) => project.verified && project.profiles.includes(profile) && hasEvidence(project));
  const corpus = evidenceText(verifiedFacts, verifiedProjects, candidate.experiences.filter((item) => item.verified && item.profiles.includes(profile)));
  const required = requirements.filter((item) => isRequired(item));
  const preferred = requirements.filter((item) => !isRequired(item) && !["RESPONSIBILITY", "SALARY", "REMOTE_POLICY", "EMPLOYMENT_TYPE", "APPLICATION_PLATFORM", "APPLICATION_METHOD", "LOCATION"].includes(item.kind));
  const matched: string[] = [];
  const missing: string[] = [];
  const evidence: EvidenceLink[] = [];
  for (const requirement of required) {
    const support = supportingFact(requirement, verifiedFacts, corpus);
    if (support) {
      matched.push(requirement.text);
      evidence.push({ requirement: requirement.text, fact: support });
    } else missing.push(requirement.text);
  }
  const preferredMatches: string[] = [];
  const preferredGaps: string[] = [];
  for (const requirement of preferred) {
    const support = supportingFact(requirement, verifiedFacts, corpus);
    if (support) preferredMatches.push(requirement.text);
    else preferredGaps.push(requirement.text);
  }
  const blockers = missing.filter((item) => /bachelor|degree|certification|phd|mba|\byears\b/i.test(item));
  const transferable = verifiedFacts
    .filter((fact) => fact.category === "EXPERIENCE" || fact.category === "METRIC")
    .slice(0, 3)
    .map((fact) => fact.fact);
  const uncertain = requirements.filter((item) => item.kind === "SOFT_SKILL" || /authorization|visa|notice|salary/i.test(item.text)).map((item) => item.text);
  const missingInformation = [
    contactIsReady(candidate.email) ? "" : "email",
    candidate.location ? "" : "location",
    candidate.phone ? "" : "phone",
    candidate.facts.some((fact) => fact.category === "EDUCATION" && fact.verified) ? "" : "education",
    candidate.facts.some((fact) => fact.category === "CERTIFICATION" && fact.verified) ? "" : "certifications",
    candidate.facts.some((fact) => fact.category === "LINK" && /linkedin/i.test(fact.fact) && fact.verified) ? "" : "linkedin",
  ].filter(Boolean);
  const projectHits = verifiedProjects.filter((project) => overlaps(`${job.title} ${job.description}`, projectText(project)));
  const profileMatch = profileScore(job, profile);
  const mustScore = required.length === 0 ? 70 : Math.round((matched.length / required.length) * 100);
  const projectScore = verifiedProjects.length === 0 ? 0 : Math.round((Math.max(projectHits.length, verifiedProjects.length ? 1 : 0) / verifiedProjects.length) * 100);
  const overall = clamp(Math.round(mustScore * 0.6 + profileMatch * 0.25 + Math.min(projectScore, 100) * 0.15));
  const selectedFacts = rankFacts(verifiedFacts, job).slice(0, 8);
  const selectedProjects = (projectHits.length ? projectHits : rankProjects(verifiedProjects, job)).slice(0, 3);
  const skills = unique(selectedFacts.flatMap((fact) => fact.skills ?? []).concat(selectedProjects.flatMap((project) => project.technologies)));
  const recommendation = selectedFacts.length === 0 && selectedProjects.length === 0
    ? "SKIP"
    : blockers.length || missing.length
      ? "REVIEW"
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
    recommendedExperiences: candidate.experiences.filter((item) => item.verified && item.profiles.includes(profile)).map((item) => `${item.title}, ${item.organizationName}`),
    recommendedSkills: skills.slice(0, 12),
    recommendedKeywords: skills.slice(0, 8),
    cvStructure: ["Summary", "Skills", "Experience", "Projects"],
    recommendation,
  };
}

export function chooseProfile(job: JobInput): CareerProfile {
  const title = job.title.toLowerCase();
  const text = `${title} ${job.description}`.toLowerCase();
  if (/web design|web designer|landing page|website designer/.test(title)) return "WEB";
  if (/founder|co-founder/.test(title)) return "FOUNDER";
  if (/go-to-market|\bgtm\b|head of growth|growth lead/.test(title)) return "GROWTH";
  if (/performance marketing|growth marketing|digital marketing|marketing manager/.test(title)) return "MARKETING";
  if (/product manager|product engineer/.test(title)) return "SAAS";
  if (/frontend developer|front-end developer|web developer/.test(title)) return "WEB";
  const software = scoreTerms(text, PROFILE_TERMS.SOFTWARE);
  const marketing = scoreTerms(text, PROFILE_TERMS.MARKETING) + scoreTerms(text, PROFILE_TERMS.GROWTH);
  if (software > 0 && marketing > 0 && /growth|marketing/.test(title) && /engineer|developer/.test(title)) return "HYBRID";
  if (/engineer|developer|full-stack|fullstack|backend/.test(title)) return "SOFTWARE";
  if (marketing > software) return "MARKETING";
  return "SOFTWARE";
}

function isRequired(item: ExtractedRequirement) {
  return item.required || item.kind === "MUST_HAVE" || item.kind === "EDUCATION";
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
    const fact = facts.find((item) => (item.technologies ?? []).some((tech) => requirement.text.toLowerCase().includes(tech.toLowerCase())));
    if (fact) return fact.fact;
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

function rankFacts(facts: CandidateFactInput[], job: JobInput) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  return [...facts].sort((left, right) => overlapCount(right.fact, text) - overlapCount(left.fact, text));
}

function rankProjects(projects: CandidateProjectInput[], job: JobInput) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  return [...projects].sort((left, right) => overlapCount(projectText(right), text) - overlapCount(projectText(left), text));
}

function overlapCount(fact: string, text: string) {
  return tokenize(fact).filter((token) => text.includes(token)).length;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}
