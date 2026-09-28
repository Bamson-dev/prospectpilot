import type { CandidateFactInput, CandidateProjectInput, CandidateRecord, CareerProfile, ExtractedRequirement, JobInput } from "@/lib/applications/types";

const PROFILE_TERMS: Record<CareerProfile, string[]> = {
  SOFTWARE: ["software", "engineer", "backend", "frontend", "full-stack", "fullstack", "api", "saas", "developer"],
  WEB: ["web design", "web designer", "website", "landing page", "wordpress", "ui", "frontend", "web developer"],
  MARKETING: ["marketing", "growth", "performance", "acquisition", "go-to-market", "gtm", "ads", "brand", "demand"],
};

export type FitResult = {
  profile: CareerProfile;
  overallMatch: number;
  profileMatch: number;
  requirementMatches: string[];
  missingRequirements: string[];
  strongEvidence: string[];
  weakEvidence: string[];
  advantages: string[];
  gaps: string[];
  selectedFacts: CandidateFactInput[];
  selectedProjects: CandidateProjectInput[];
  recommendation: "PREPARE" | "REVIEW" | "SKIP";
};

export function scoreJobFit(job: JobInput, candidate: CandidateRecord, requirements: ExtractedRequirement[]): FitResult {
  const profile = chooseProfile(job);
  const verifiedFacts = candidate.facts.filter((fact) => fact.verified && (fact.profiles.length === 0 || fact.profiles.includes(profile)));
  const verifiedProjects = candidate.projects.filter((project) => project.verified && (project.profiles.length === 0 || project.profiles.includes(profile)));
  const corpus = evidenceText(verifiedFacts, verifiedProjects, candidate.experiences.filter((item) => item.verified));
  const must = requirements.filter((item) => item.required || item.kind === "MUST_HAVE" || item.kind === "EDUCATION");
  const matched: string[] = [];
  const missing: string[] = [];
  for (const requirement of must) {
    if (requirementSupported(requirement, corpus, verifiedFacts)) matched.push(requirement.text);
    else missing.push(requirement.text);
  }
  const projectHits = verifiedProjects.filter((project) => overlaps(job.title + " " + job.description, `${project.name} ${project.description} ${project.technologies.join(" ")} ${project.features.join(" ")}`));
  const profileMatch = profileScore(job, profile);
  const mustScore = must.length === 0 ? 70 : Math.round((matched.length / must.length) * 100);
  const projectScore = verifiedProjects.length === 0 ? 0 : Math.round((projectHits.length / verifiedProjects.length) * 100);
  const overall = clamp(Math.round(mustScore * 0.5 + profileMatch * 0.3 + projectScore * 0.2));
  const selectedFacts = rankFacts(verifiedFacts, job).slice(0, 8);
  const selectedProjects = (projectHits.length ? projectHits : rankProjects(verifiedProjects, job)).slice(0, 4);
  const recommendation = overall >= 55 && missing.filter((item) => /degree|certification|bachelor/.test(item.toLowerCase())).length === 0
    ? "PREPARE"
    : overall >= 35
      ? "REVIEW"
      : "SKIP";
  return {
    profile,
    overallMatch: overall,
    profileMatch,
    requirementMatches: matched,
    missingRequirements: missing,
    strongEvidence: selectedFacts.slice(0, 4).map((fact) => fact.fact),
    weakEvidence: selectedFacts.slice(4).map((fact) => fact.fact),
    advantages: selectedProjects.map((project) => project.name),
    gaps: missing,
    selectedFacts,
    selectedProjects,
    recommendation,
  };
}

export function chooseProfile(job: JobInput): CareerProfile {
  const text = `${job.title} ${job.description}`.toLowerCase();
  const scores = (Object.keys(PROFILE_TERMS) as CareerProfile[]).map((profile) => ({
    profile,
    score: PROFILE_TERMS[profile].reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0),
  }));
  scores.sort((left, right) => right.score - left.score);
  if (scores[0].score === 0) return "SOFTWARE";
  if (/web design|website designer|landing page/.test(text) && scores.find((item) => item.profile === "WEB")!.score > 0) return "WEB";
  return scores[0].profile;
}

function profileScore(job: JobInput, profile: CareerProfile) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  const terms = PROFILE_TERMS[profile];
  const hits = terms.filter((term) => text.includes(term)).length;
  return clamp(Math.round((hits / terms.length) * 100));
}

function requirementSupported(requirement: ExtractedRequirement, corpus: string, facts: CandidateFactInput[]) {
  if (requirement.kind === "EXPERIENCE_YEARS" && requirement.years) {
    return facts.some((fact) => fact.verified && new RegExp(`${requirement.years}\\+?\\s*(?:years|yrs)`, "i").test(fact.fact));
  }
  if (requirement.kind === "EDUCATION" && /bachelor|degree|mba|phd/.test(requirement.text.toLowerCase())) {
    return facts.some((fact) => fact.category === "EDUCATION" && fact.verified);
  }
  return overlaps(requirement.text, corpus);
}

function evidenceText(facts: CandidateFactInput[], projects: CandidateProjectInput[], experiences: CandidateRecord["experiences"]) {
  return [
    ...facts.map((fact) => [fact.fact, ...(fact.skills ?? []), ...(fact.technologies ?? []), ...(fact.keywords ?? [])].join(" ")),
    ...projects.map((project) => [project.name, project.description, project.role, ...project.technologies, ...project.features, ...project.outcomes].join(" ")),
    ...experiences.map((item) => `${item.title} ${item.organizationName} ${item.summary}`),
  ].join(" ").toLowerCase();
}

function overlaps(left: string, right: string) {
  const tokens = tokenize(left);
  if (tokens.length === 0) return false;
  const haystack = right.toLowerCase();
  const hits = tokens.filter((token) => haystack.includes(token));
  return hits.length >= Math.min(2, tokens.length);
}

function tokenize(value: string) {
  return value.toLowerCase().split(/[^a-z0-9+#.]+/).filter((token) => token.length > 3);
}

function rankFacts(facts: CandidateFactInput[], job: JobInput) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  return [...facts].sort((left, right) => overlapCount(right.fact, text) - overlapCount(left.fact, text));
}

function rankProjects(projects: CandidateProjectInput[], job: JobInput) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  return [...projects].sort((left, right) => overlapCount(`${right.name} ${right.description}`, text) - overlapCount(`${left.name} ${left.description}`, text));
}

function overlapCount(fact: string, text: string) {
  return tokenize(fact).filter((token) => text.includes(token)).length;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}
