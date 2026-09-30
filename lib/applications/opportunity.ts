import { factIsAutomaticEvidence } from "@/lib/applications/evidence-management";
import { selectEvidence } from "@/lib/applications/evidence-selection";
import { chooseProfile } from "@/lib/applications/fit";
import { technologiesMentioned } from "@/lib/applications/technologies";
import type { CandidateRecord, CareerProfile, ExtractedRequirement, JobInput } from "@/lib/applications/types";

export const OPPORTUNITY_PROFILES = [
  "SOFTWARE_ENGINEER",
  "WEB_DEVELOPER",
  "FULL_STACK_DEVELOPER",
  "PRODUCT_ENGINEER",
  "TECHNICAL_PRODUCT_MANAGER",
  "PRODUCT_MANAGER",
  "PROJECT_MANAGER",
  "TECHNICAL_PROJECT_MANAGER",
  "GROWTH_MARKETER",
  "PERFORMANCE_MARKETER",
  "GROWTH_GTM",
  "DIGITAL_MARKETING_MANAGER",
  "MARKETING_MANAGER",
  "DEMAND_GENERATION",
  "PRODUCT_MARKETING",
  "SAAS_GROWTH",
  "FOUNDER",
  "TECHNICAL_FOUNDER",
  "SOLUTIONS_IMPLEMENTATION",
  "BUSINESS_DEVELOPMENT",
  "PARTNERSHIPS",
  "ECOMMERCE",
  "EDTECH",
  "FINTECH",
  "TECHNICAL_GROWTH",
  "STRATEGY_OPERATIONS",
] as const;

export type OpportunityProfile = (typeof OPPORTUNITY_PROFILES)[number];

export type CareerLane =
  | "Engineering"
  | "Product"
  | "Project Management"
  | "Growth"
  | "Marketing"
  | "GTM"
  | "Sales/Business Development"
  | "Strategy/Operations"
  | "Technical/Business Hybrid"
  | "Founder/operator";

export type OpportunityMatch = "DIRECT" | "TRANSFERABLE" | "ADJACENT" | "EXPERIENCE_BASED" | "STRETCH" | "UNKNOWN" | "DISQUALIFIED";

export type OpportunityDecision = "APPLY" | "REVIEW" | "NOT_A_FIT";

export type OpportunityLink = { requirement: string; evidence: string | null; reason: string };

export type OpportunityReport = {
  decision: OpportunityDecision;
  lanes: CareerLane[];
  primaryProfile: OpportunityProfile | null;
  secondaryProfiles: OpportunityProfile[];
  documentProfile: CareerProfile;
  direct: OpportunityLink[];
  transferable: OpportunityLink[];
  adjacent: OpportunityLink[];
  experienceBased: OpportunityLink[];
  stretch: OpportunityLink[];
  missingPreferred: string[];
  unknown: OpportunityLink[];
  disqualifiers: OpportunityLink[];
  gaps: string[];
  reason: string;
  queue: "prepare" | "hold";
};

export const PROFILE_EVIDENCE_MAP: Record<OpportunityProfile, string[]> = {
  SOFTWARE_ENGINEER: ["programming languages", "frameworks", "databases", "cloud", "infrastructure", "software projects", "technical responsibilities", "engineering achievements"],
  WEB_DEVELOPER: ["web applications", "frontend frameworks", "user-facing interfaces"],
  FULL_STACK_DEVELOPER: ["web applications", "backend services", "databases", "background work"],
  PRODUCT_ENGINEER: ["software development", "product development", "product launches", "technical architecture", "user-facing applications", "product strategy", "growth and product intersection"],
  TECHNICAL_PRODUCT_MANAGER: ["technical architecture", "product development", "user-facing applications", "product decisions"],
  PRODUCT_MANAGER: ["product ownership", "requirements", "product launches", "roadmap and product decisions", "user and customer understanding", "cross-functional work", "monetization", "product analytics"],
  PROJECT_MANAGER: ["project ownership", "delivery", "coordination", "planning", "execution", "stakeholder management", "team leadership"],
  TECHNICAL_PROJECT_MANAGER: ["project delivery", "technical implementation", "software projects", "coordination"],
  GROWTH_MARKETER: ["paid advertising", "acquisition", "funnels", "conversion", "affiliate growth", "campaign performance", "revenue growth", "audience strategy"],
  PERFORMANCE_MARKETER: ["paid advertising", "campaign performance", "acquisition"],
  GROWTH_GTM: ["market entry", "positioning", "acquisition", "monetization", "product launches", "partnerships", "go-to-market strategy"],
  DIGITAL_MARKETING_MANAGER: ["digital marketing", "acquisition", "advertising"],
  MARKETING_MANAGER: ["marketing leadership", "acquisition", "campaigns"],
  DEMAND_GENERATION: ["acquisition", "audience strategy", "campaigns"],
  PRODUCT_MARKETING: ["positioning", "go-to-market", "product launches"],
  SAAS_GROWTH: ["saas product", "acquisition", "monetization"],
  FOUNDER: ["product ownership", "business building", "team leadership", "revenue", "strategy", "operations", "customer acquisition", "product development"],
  TECHNICAL_FOUNDER: ["founder ownership", "software projects", "product development"],
  SOLUTIONS_IMPLEMENTATION: ["implementation", "customer delivery", "technical setup"],
  BUSINESS_DEVELOPMENT: ["partnerships", "pipeline", "commercial development"],
  PARTNERSHIPS: ["partnerships", "alliances"],
  ECOMMERCE: ["ecommerce operations", "storefronts", "commerce crm"],
  EDTECH: ["digital education", "learning products"],
  FINTECH: ["fintech products", "financial workflows"],
  TECHNICAL_GROWTH: ["software", "automation", "growth", "analytics", "marketing", "product", "technical implementation"],
  STRATEGY_OPERATIONS: ["operations", "strategy", "business building"],
};

const LANE_PROFILES: Record<CareerLane, OpportunityProfile[]> = {
  Engineering: ["SOFTWARE_ENGINEER", "WEB_DEVELOPER", "FULL_STACK_DEVELOPER", "PRODUCT_ENGINEER", "TECHNICAL_FOUNDER"],
  Product: ["PRODUCT_MANAGER", "PRODUCT_ENGINEER", "TECHNICAL_PRODUCT_MANAGER", "FOUNDER", "TECHNICAL_GROWTH", "SAAS_GROWTH"],
  "Project Management": ["PROJECT_MANAGER", "TECHNICAL_PROJECT_MANAGER", "FOUNDER", "PRODUCT_ENGINEER", "SOFTWARE_ENGINEER"],
  Growth: ["GROWTH_MARKETER", "PERFORMANCE_MARKETER", "DEMAND_GENERATION", "SAAS_GROWTH", "TECHNICAL_GROWTH"],
  Marketing: ["GROWTH_MARKETER", "PERFORMANCE_MARKETER", "DIGITAL_MARKETING_MANAGER", "MARKETING_MANAGER", "PRODUCT_MARKETING"],
  GTM: ["GROWTH_GTM", "PRODUCT_MARKETING", "SAAS_GROWTH", "FOUNDER", "DEMAND_GENERATION"],
  "Sales/Business Development": ["BUSINESS_DEVELOPMENT", "PARTNERSHIPS", "GROWTH_GTM", "FOUNDER"],
  "Strategy/Operations": ["STRATEGY_OPERATIONS", "FOUNDER", "PRODUCT_MANAGER"],
  "Technical/Business Hybrid": ["TECHNICAL_GROWTH", "TECHNICAL_FOUNDER", "PRODUCT_ENGINEER", "TECHNICAL_PRODUCT_MANAGER"],
  "Founder/operator": ["FOUNDER", "TECHNICAL_FOUNDER", "STRATEGY_OPERATIONS"],
};

const THEMES: Array<{ kind: "TRANSFERABLE" | "ADJACENT" | "EXPERIENCE_BASED"; requirement: RegExp; evidence: RegExp; reason: string }> = [
  { kind: "ADJACENT", requirement: /performance marketing/i, evidence: /advertising|affiliate marketing|acquisition/i, reason: "Verified advertising, affiliate, or acquisition work is adjacent to performance marketing." },
  { kind: "ADJACENT", requirement: /demand generation/i, evidence: /acquisition|affiliate|growth systems/i, reason: "Verified acquisition work is adjacent to demand generation." },
  { kind: "ADJACENT", requirement: /product marketing/i, evidence: /go-to-market|product development/i, reason: "Verified go-to-market and product-development work is adjacent to product marketing." },
  { kind: "ADJACENT", requirement: /product engineering/i, evidence: /product development|saas|typescript|next\.js/i, reason: "Verified software and product-development work is adjacent to product engineering." },
  { kind: "ADJACENT", requirement: /technical product management/i, evidence: /product development/i, reason: "Verified product development is adjacent to technical product management. No product-manager title is added." },
  { kind: "TRANSFERABLE", requirement: /go-to-market|\bgtm\b/i, evidence: /go-to-market/i, reason: "Verified go-to-market work transfers to this requirement." },
  { kind: "TRANSFERABLE", requirement: /affiliate/i, evidence: /affiliate/i, reason: "Verified affiliate work transfers to this requirement." },
  { kind: "TRANSFERABLE", requirement: /acquisition/i, evidence: /acquisition|affiliate/i, reason: "Verified acquisition or affiliate work transfers to this requirement." },
  { kind: "EXPERIENCE_BASED", requirement: /product manager|product management|product ownership/i, evidence: /founder|product development/i, reason: "Verified founder and product-development work is similar product ownership. No product-manager title is added." },
  { kind: "EXPERIENCE_BASED", requirement: /project manager|managing software projects|project delivery|stakeholder/i, evidence: /product development|platform operations|founder/i, reason: "Verified product development and operations are similar delivery work. No project-manager title is added." },
  { kind: "EXPERIENCE_BASED", requirement: /software project|build products|web application/i, evidence: /web application|product development|typescript/i, reason: "Verified software and product-building work is similar to this requirement." },
];

const BLOCKED_DOMAIN = /\b(fintech|healthcare|medical license|nursing|attorney|security clearance|\bcpa\b|series 7|physician)\b/i;

export function classifyLanes(job: Pick<JobInput, "title" | "description">): CareerLane[] {
  const title = job.title.toLowerCase();
  const lanes = new Set<CareerLane>();
  if (/\b(engineer|engineering|developer|developers|full[- ]stack|backend|frontend)\b/.test(title) || (/technical/.test(title) && /product|project|growth/.test(title))) lanes.add("Engineering");
  if (/product manager|product management|product owner|product engineer|technical product/.test(title)) lanes.add("Product");
  if (/project manager|program manager|delivery manager/.test(title)) lanes.add("Project Management");
  if (/growth|performance marketing|demand gen/.test(title)) lanes.add("Growth");
  if (/\b(marketing|advertising|brand)\b/.test(title)) lanes.add("Marketing");
  if (/go-to-market|\bgtm\b|product marketing/.test(title)) lanes.add("GTM");
  if (/business development|partnership|account executive|sales/.test(title)) lanes.add("Sales/Business Development");
  if (/strategy|operations|chief of staff|operator/.test(title)) lanes.add("Strategy/Operations");
  if (/founder|co-founder/.test(title)) lanes.add("Founder/operator");
  if ((/\b(engineer|developer|technical)\b/.test(title) && /\b(growth|marketing|product|project)\b/.test(title)) || /technical growth|growth engineer/.test(title)) lanes.add("Technical/Business Hybrid");
  if (lanes.size === 0) {
    const text = `${title} ${job.description}`.toLowerCase();
    if (/typescript|react|backend|api/.test(text)) lanes.add("Engineering");
    else if (/go-to-market|acquisition|marketing/.test(text)) lanes.add("Marketing");
    else lanes.add("Strategy/Operations");
  }
  return [...lanes];
}

export function supportedOpportunityProfiles(candidate: CandidateRecord): OpportunityProfile[] {
  const text = evidenceCorpus(candidate);
  const technical = /\b(typescript|python|next\.js|react|postgresql)\b/i.test(text);
  return OPPORTUNITY_PROFILES.filter((profile) => profileSupported(profile, text, technical));
}

export function applicationQueueDecision(decision: OpportunityDecision) {
  return decision === "APPLY" ? "prepare" as const : "hold" as const;
}

export function evaluateOpportunity(input: {
  job: JobInput;
  candidate: CandidateRecord;
  requirements: ExtractedRequirement[];
}): OpportunityReport {
  const lanes = classifyLanes(input.job);
  const supported = supportedOpportunityProfiles(input.candidate);
  const corpus = evidenceCorpus(input.candidate);
  const facts = evidenceFacts(input.candidate);
  const ranked = rankProfiles(input.job.title, lanes, supported);
  const primary = ranked[0] ?? null;
  const direct: OpportunityLink[] = [];
  const transferable: OpportunityLink[] = [];
  const adjacent: OpportunityLink[] = [];
  const experienceBased: OpportunityLink[] = [];
  const stretch: OpportunityLink[] = [];
  const unknown: OpportunityLink[] = [];
  const disqualifiers: OpportunityLink[] = [];
  const hard = input.requirements.filter((item) => item.role === "HARD_REQUIREMENT");
  for (const requirement of hard) {
    const match = interpretRequirement(requirement.text, corpus, facts, Boolean(primary));
    const link = { requirement: requirement.text, evidence: match.evidence, reason: match.reason };
    if (match.kind === "DIRECT") direct.push(link);
    else if (match.kind === "TRANSFERABLE") transferable.push(link);
    else if (match.kind === "ADJACENT") adjacent.push(link);
    else if (match.kind === "EXPERIENCE_BASED") experienceBased.push(link);
    else if (match.kind === "STRETCH") stretch.push(link);
    else if (match.kind === "UNKNOWN") unknown.push(link);
    else disqualifiers.push(link);
  }
  const titleBlock = titleBlocker(input.job.title, corpus);
  if (titleBlock) disqualifiers.push({ requirement: input.job.title, evidence: null, reason: titleBlock });
  if (hard.length === 0 && primary && !titleBlock) {
    unknown.push({
      requirement: input.job.title,
      evidence: null,
      reason: "No hard requirement was extracted from the posting.",
    });
  }
  const missingPreferred = input.requirements
    .filter((item) => item.role === "PREFERRED_REQUIREMENT")
    .filter((item) => selectEvidence(item.text, facts).match !== "DIRECT")
    .map((item) => item.text);
  const gaps = unknownTechnologies(input.requirements, corpus);
  const supportive = direct.length + transferable.length + adjacent.length + experienceBased.length;
  let decision: OpportunityDecision = "NOT_A_FIT";
  if (disqualifiers.length) decision = "NOT_A_FIT";
  else if (!primary) decision = "NOT_A_FIT";
  else if (unknown.length) decision = "REVIEW";
  else if (supportive > 0) decision = "APPLY";
  else if (stretch.length) decision = "REVIEW";
  const reason = decisionReason(decision, primary, direct, transferable, adjacent, experienceBased, disqualifiers, unknown, gaps);
  return {
    decision,
    lanes,
    primaryProfile: primary,
    secondaryProfiles: ranked.slice(1, 4),
    documentProfile: chooseProfile(input.job),
    direct,
    transferable,
    adjacent,
    experienceBased,
    stretch,
    missingPreferred,
    unknown,
    disqualifiers,
    gaps,
    reason,
    queue: applicationQueueDecision(decision),
  };
}

function profileSupported(profile: OpportunityProfile, text: string, technical: boolean) {
  switch (profile) {
    case "SOFTWARE_ENGINEER":
      return technical;
    case "WEB_DEVELOPER":
      return /\b(next\.js|react|web application)\b/i.test(text);
    case "FULL_STACK_DEVELOPER":
      return /\bweb application\b/i.test(text) && /\b(postgresql|worker|redis|backend)\b/i.test(text);
    case "PRODUCT_ENGINEER":
      return technical && /\b(product development|saas)\b/i.test(text);
    case "TECHNICAL_PRODUCT_MANAGER":
      return technical && /\bproduct development\b/i.test(text);
    case "PRODUCT_MANAGER":
      return /\b(product development|monetization)\b/i.test(text);
    case "PROJECT_MANAGER":
      return /\b(project management|stakeholder management|project delivery)\b/i.test(text);
    case "TECHNICAL_PROJECT_MANAGER":
      return technical && /\b(project management|project delivery)\b/i.test(text);
    case "GROWTH_MARKETER":
      return /\b(affiliate|acquisition|growth systems|growth marketing)\b/i.test(text);
    case "PERFORMANCE_MARKETER":
      return /\b(advertising|performance marketing|paid advertising)\b/i.test(text);
    case "GROWTH_GTM":
      return /\bgo-to-market\b/i.test(text);
    case "DIGITAL_MARKETING_MANAGER":
      return /\bmarketing\b/i.test(text) && /\b(advertising|digital education|acquisition)\b/i.test(text);
    case "MARKETING_MANAGER":
      return /\bcmo\b|\bmarketing\b/i.test(text);
    case "DEMAND_GENERATION":
      return /\b(acquisition|demand generation)\b/i.test(text);
    case "PRODUCT_MARKETING":
      return /\bgo-to-market\b/i.test(text) && /\bproduct\b/i.test(text);
    case "SAAS_GROWTH":
      return /\bsaas\b/i.test(text) && /\b(growth|acquisition)\b/i.test(text);
    case "FOUNDER":
      return /\bfounder\b/i.test(text);
    case "TECHNICAL_FOUNDER":
      return /\bfounder\b/i.test(text) && technical;
    case "SOLUTIONS_IMPLEMENTATION":
      return /\b(solutions implementation|implementation work)\b/i.test(text);
    case "BUSINESS_DEVELOPMENT":
      return /\bbusiness development\b/i.test(text);
    case "PARTNERSHIPS":
      return /\bpartnerships?\b/i.test(text);
    case "ECOMMERCE":
      return /\be-?commerce\b/i.test(text);
    case "EDTECH":
      return /\b(digital education|edtech)\b/i.test(text);
    case "FINTECH":
      return /\bfintech\b/i.test(text);
    case "TECHNICAL_GROWTH":
      return technical && /\b(growth|acquisition|marketing)\b/i.test(text);
    case "STRATEGY_OPERATIONS":
      return /\b(business operations|platform operations|operations)\b/i.test(text);
    default:
      return false;
  }
}

function rankProfiles(title: string, lanes: CareerLane[], supported: OpportunityProfile[]) {
  const hints = titleHints(title);
  const laneProfiles = unique(lanes.flatMap((lane) => LANE_PROFILES[lane]));
  const hinted = hints.filter((profile) => supported.includes(profile) && laneProfiles.includes(profile));
  const rest = laneProfiles.filter((profile) => supported.includes(profile) && !hinted.includes(profile));
  return [...hinted, ...rest];
}

function titleHints(title: string): OpportunityProfile[] {
  const text = title.toLowerCase();
  if (/technical product manager/.test(text)) return ["TECHNICAL_PRODUCT_MANAGER", "PRODUCT_ENGINEER", "PRODUCT_MANAGER", "TECHNICAL_GROWTH", "FOUNDER"];
  if (/product manager|product management/.test(text)) return ["PRODUCT_MANAGER", "PRODUCT_ENGINEER", "FOUNDER", "TECHNICAL_PRODUCT_MANAGER"];
  if (/product engineer/.test(text)) return ["PRODUCT_ENGINEER", "SOFTWARE_ENGINEER", "TECHNICAL_GROWTH"];
  if (/technical project manager/.test(text)) return ["TECHNICAL_PROJECT_MANAGER", "PROJECT_MANAGER", "SOFTWARE_ENGINEER", "PRODUCT_ENGINEER"];
  if (/project manager|program manager/.test(text)) return ["PROJECT_MANAGER", "FOUNDER", "PRODUCT_ENGINEER", "SOFTWARE_ENGINEER"];
  if (/web developer|frontend|front-end/.test(text)) return ["WEB_DEVELOPER", "SOFTWARE_ENGINEER", "FULL_STACK_DEVELOPER"];
  if (/full[- ]stack/.test(text)) return ["FULL_STACK_DEVELOPER", "SOFTWARE_ENGINEER", "WEB_DEVELOPER"];
  if (/growth engineer|technical growth/.test(text)) return ["TECHNICAL_GROWTH", "SOFTWARE_ENGINEER", "GROWTH_MARKETER"];
  if (/performance/.test(text)) return ["PERFORMANCE_MARKETER", "GROWTH_MARKETER", "DEMAND_GENERATION"];
  if (/go-to-market|\bgtm\b|product marketing/.test(text)) return ["GROWTH_GTM", "PRODUCT_MARKETING", "GROWTH_MARKETER"];
  if (/growth|demand/.test(text)) return ["GROWTH_MARKETER", "GROWTH_GTM", "DEMAND_GENERATION", "SAAS_GROWTH"];
  if (/business development/.test(text)) return ["BUSINESS_DEVELOPMENT", "PARTNERSHIPS", "GROWTH_GTM", "FOUNDER"];
  if (/partnership/.test(text)) return ["PARTNERSHIPS", "GROWTH_GTM", "FOUNDER"];
  if (/marketing/.test(text)) return ["MARKETING_MANAGER", "DIGITAL_MARKETING_MANAGER", "GROWTH_MARKETER"];
  if (/founder/.test(text)) return ["FOUNDER", "TECHNICAL_FOUNDER", "STRATEGY_OPERATIONS"];
  if (/strategy|operations/.test(text)) return ["STRATEGY_OPERATIONS", "FOUNDER"];
  if (/engineer|developer|software/.test(text)) return ["SOFTWARE_ENGINEER", "FULL_STACK_DEVELOPER", "PRODUCT_ENGINEER", "WEB_DEVELOPER"];
  return [];
}

const TITLE_SPECIALTIES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bandroid\b/i, label: "Android" },
  { pattern: /\bios\b/i, label: "iOS" },
  { pattern: /\bc\+\+/i, label: "C++" },
  { pattern: /machine learning/i, label: "machine learning" },
  { pattern: /\brecruit/i, label: "recruiting" },
  { pattern: /customer success/i, label: "customer success" },
  { pattern: /detection and response|security engineer/i, label: "security detection" },
];

function titleBlocker(title: string, corpus: string) {
  const named = technologiesMentioned(title).filter((name) => !new RegExp(`\\b${name.replace(/[.]/g, "\\.")}\\b`, "i").test(corpus));
  if (named.length) return `${named.join(", ")} is named in the job title and is not verified. A different technology is not treated as the same skill.`;
  const specialty = TITLE_SPECIALTIES.find((item) => item.pattern.test(title) && !item.pattern.test(corpus));
  if (specialty) return `${specialty.label} is named in the job title and verified evidence does not include it.`;
  return null;
}

function interpretRequirement(text: string, corpus: string, facts: ReturnType<typeof evidenceFacts>, laneMatched: boolean): { kind: OpportunityMatch; evidence: string | null; reason: string } {
  if (/\d+\+?\s*(?:years|yrs)/i.test(text)) {
    const selection = selectEvidence(text, facts);
    if (selection.match === "DIRECT") return { kind: "DIRECT", evidence: selection.evidence, reason: selection.reason };
    return { kind: "UNKNOWN", evidence: selection.evidence, reason: selection.reason };
  }
  if (/sponsor|work authorization|authorized to work|eligible to work|\bvisa\b|must be (located|based|resident)|must reside/i.test(text)) {
    return { kind: "UNKNOWN", evidence: null, reason: "Location, sponsorship, or work authorization is not a verified match, so this stays for review." };
  }
  const selection = selectEvidence(text, facts);
  if (selection.match === "DIRECT" && selection.evidence) return { kind: "DIRECT", evidence: selection.evidence, reason: selection.reason };
  if (selection.match === "UNCERTAIN") return { kind: "UNKNOWN", evidence: selection.evidence, reason: selection.reason };
  const named = technologiesMentioned(text);
  if (named.length && selection.match === "MISSING") {
    if (/abilit(?:y|ies) to learn|willing to learn|or equivalent/i.test(text)) {
      return { kind: "UNKNOWN", evidence: null, reason: `${named.join(", ")} is not verified. The posting allows learning or equivalent experience, so this stays for review.` };
    }
    return { kind: "DISQUALIFIED", evidence: null, reason: `${named.join(", ")} is explicitly required and there is no verified evidence for it. A different technology is not treated as the same skill.` };
  }
  const domain = text.match(BLOCKED_DOMAIN);
  if (domain && !new RegExp(domain[0], "i").test(corpus)) {
    return { kind: "DISQUALIFIED", evidence: null, reason: `${domain[0]} is a mandatory domain or credential, and verified evidence does not include it.` };
  }
  if (/\b(must hold|required).{0,40}(degree|bachelor|master|phd|license|certification)\b/i.test(text) && !/\b(degree|bachelor|certification|license)\b/i.test(corpus)) {
    return { kind: "DISQUALIFIED", evidence: null, reason: "A mandatory credential is required and no verified credential evidence is on file." };
  }
  for (const theme of THEMES) {
    if (theme.requirement.test(text) && theme.evidence.test(corpus)) {
      return { kind: theme.kind, evidence: evidenceExcerpt(corpus, theme.evidence), reason: theme.reason };
    }
  }
  if (laneMatched) {
    return { kind: "STRETCH", evidence: null, reason: "The career lane matches verified evidence, but this line does not have its own direct evidence." };
  }
  return { kind: "DISQUALIFIED", evidence: null, reason: "This mandatory requirement is outside the verified evidence and the supported career lanes." };
}

function evidenceCorpus(candidate: CandidateRecord) {
  return [
    ...candidate.facts.filter((fact) => factIsAutomaticEvidence(fact)).map((fact) => fact.fact),
    ...candidate.experiences.filter((item) => item.verified).map((item) => `${item.title} ${item.summary}`),
    ...candidate.projects.filter((project) => project.verified && !/not verified/i.test(project.description)).flatMap((project) => [project.name, project.description, project.role, ...project.technologies]),
  ].join("\n");
}

function evidenceFacts(candidate: CandidateRecord) {
  return [
    ...candidate.facts.filter((fact) => factIsAutomaticEvidence(fact)).map((fact) => ({
      fact: fact.fact,
      source: fact.sourceType ?? "CANDIDATE_ENTERED",
      technologies: fact.technologies,
      skills: fact.skills,
      category: fact.category,
    })),
    ...candidate.projects.filter((project) => project.verified && project.technologies.length).map((project) => ({
      fact: `${project.name} uses ${project.technologies.join(", ")}`,
      source: project.source ?? "project",
      technologies: project.technologies,
      skills: project.technologies,
      category: "PROJECT",
    })),
  ];
}

function evidenceExcerpt(corpus: string, profileOrPattern: OpportunityProfile | RegExp) {
  const pattern = profileOrPattern instanceof RegExp ? profileOrPattern : signalPattern(profileOrPattern);
  const line = corpus.split("\n").find((item) => pattern.test(item));
  return line?.slice(0, 240) ?? null;
}

function signalPattern(profile: OpportunityProfile) {
  if (profile === "SOFTWARE_ENGINEER" || profile === "WEB_DEVELOPER" || profile === "FULL_STACK_DEVELOPER") return /typescript|next\.js|web application|postgresql/i;
  if (profile === "FOUNDER" || profile === "TECHNICAL_FOUNDER") return /founder/i;
  if (profile === "GROWTH_MARKETER" || profile === "GROWTH_GTM" || profile === "DEMAND_GENERATION") return /acquisition|go-to-market|affiliate/i;
  if (profile === "PRODUCT_MANAGER" || profile === "PRODUCT_ENGINEER" || profile === "TECHNICAL_PRODUCT_MANAGER") return /product development|saas/i;
  return /./;
}

function unknownTechnologies(requirements: ExtractedRequirement[], corpus: string) {
  const notes: string[] = [];
  for (const requirement of requirements) {
    if (requirement.role !== "PREFERRED_REQUIREMENT" && requirement.role !== "HARD_REQUIREMENT") continue;
    for (const name of technologiesMentioned(requirement.text)) {
      if (!new RegExp(`\\b${name.replace(/[.]/g, "\\.")}\\b`, "i").test(corpus) && !notes.includes(`${name} experience is unknown`)) {
        notes.push(`${name} experience is unknown`);
      }
    }
  }
  return notes;
}

function decisionReason(
  decision: OpportunityDecision,
  primary: OpportunityProfile | null,
  direct: OpportunityLink[],
  transferable: OpportunityLink[],
  adjacent: OpportunityLink[],
  experienceBased: OpportunityLink[],
  disqualifiers: OpportunityLink[],
  unknown: OpportunityLink[],
  gaps: string[],
) {
  if (decision === "NOT_A_FIT") {
    return disqualifiers[0]?.reason ?? "No supported candidate profile matches this career lane.";
  }
  const lead = primary ? `Primary profile: ${primary.replaceAll("_", " ")}.` : "No primary profile.";
  const strong = direct.slice(0, 3).map((item) => item.evidence ?? item.requirement).join("; ");
  const related = [...transferable, ...adjacent, ...experienceBased].slice(0, 2).map((item) => item.reason).join(" ");
  const pending = unknown[0]?.reason ?? "";
  const gap = gaps.length ? `Gaps: ${gaps.slice(0, 4).join("; ")}.` : "";
  if (decision === "REVIEW") return `${lead} ${pending || "A material uncertainty remains."} ${gap}`.replace(/\s+/g, " ").trim();
  return `${lead} ${strong ? `Strong evidence: ${strong}.` : ""} ${related} ${gap}`.replace(/\s+/g, " ").trim();
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
