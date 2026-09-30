import { duplicateDecision, type IdentityInput } from "@/lib/applications/dedupe";
import { sourceValidity } from "@/lib/applications/source-validity";
import type { EvidenceSelection } from "@/lib/applications/evidence-selection";
import { matchesQuery, normalizeVacancy, type NormalizedVacancy, type RawDiscoveredVacancy } from "@/lib/applications/job-normalize";
import { scoreJobFit, type FitResult } from "@/lib/applications/fit";
import { extractRequirements } from "@/lib/applications/requirements";
import { evaluateOpportunity, type OpportunityReport } from "@/lib/applications/opportunity";
import type { CandidateRecord, ExtractedRequirement, JobInput, RequirementRole } from "@/lib/applications/types";

export type FitState = "APPLY" | "REVIEW" | "NOT_A_FIT";

export type QualificationExplanation = {
  state: FitState;
  direct: Array<{ requirement: string; evidence: string; reason: string; source: string | null; verification: "VERIFIED" }>;
  transferable: Array<{ requirement: string; evidence: string; reason: string; source: string | null; verification: "VERIFIED" }>;
  missingHard: Array<{ requirement: string; reason: string }>;
  uncertainHard: Array<{ requirement: string; reason: string }>;
  preferred: Array<{ requirement: string; match: string; evidence: string | null; reason: string }>;
  responsibilities: string[];
  opportunity?: OpportunityReport;
};

export type DiscoverySummary = {
  discovered: number;
  normalized: number;
  duplicatesRemoved: number;
  duplicateReasons: string[];
  stored: number;
  analyzed: number;
  requirements: number;
  qualified: number;
  review: number;
  notReady: number;
  notAFit: number;
  failed: number;
  failures: Array<{ source: string; reason: string }>;
  sources: Record<string, number>;
  invalidSources: number;
  discoveryMs: number;
  analysisMs: number;
};

export function prepareDiscoveredVacancies(jobs: RawDiscoveredVacancy[], query: string) {
  const normalized: NormalizedVacancy[] = [];
  let failed = 0;
  for (const job of jobs) {
    const next = normalizeVacancy(job);
    if (!next) {
      failed += 1;
      continue;
    }
    if (matchesQuery(next, query)) normalized.push(next);
  }
  const eligible: NormalizedVacancy[] = [];
  const invalidSources: string[] = [];
  for (const job of normalized) {
    if (sourceValidity({ title: job.title, url: job.applicationUrl, source: job.source }) === "INVALID_SOURCE") {
      invalidSources.push(job.title);
      continue;
    }
    eligible.push(job);
  }
  const kept: NormalizedVacancy[] = [];
  const duplicateReasons: string[] = [];
  for (const job of eligible) {
    const match = kept.find((existing) => duplicateDecision(identity(existing), identity(job)).merge);
    if (!match) {
      kept.push(job);
      continue;
    }
    duplicateReasons.push(duplicateDecision(identity(match), identity(job)).reason ?? "duplicate");
  }
  return { normalized, kept, duplicateReasons, failed, invalidSources };
}

export function assessVacancy(job: JobInput, candidate: CandidateRecord) {
  const requirements = extractRequirements(job.description);
  const fit = scoreJobFit(job, candidate, requirements);
  const opportunity = evaluateOpportunity({ job, candidate, requirements });
  const explanation = explainQualification(requirements, fit.selections);
  explanation.state = opportunity.decision;
  explanation.opportunity = opportunity;
  return { requirements, fit, explanation, state: opportunity.decision, opportunity };
}

export function explainQualification(requirements: ExtractedRequirement[], selections: EvidenceSelection[]): QualificationExplanation {
  const byText = new Map(selections.map((item) => [item.requirement, item]));
  const direct: QualificationExplanation["direct"] = [];
  const transferable: QualificationExplanation["transferable"] = [];
  const missingHard: QualificationExplanation["missingHard"] = [];
  const uncertainHard: QualificationExplanation["uncertainHard"] = [];
  const preferred: QualificationExplanation["preferred"] = [];
  for (const requirement of requirements) {
    const role = roleOf(requirement);
    const selection = byText.get(requirement.text);
    if (role === "PREFERRED_REQUIREMENT") {
      preferred.push({
        requirement: requirement.text,
        match: selection?.match ?? "UNCERTAIN",
        evidence: selection?.evidence ?? null,
        reason: selection?.reason ?? "Preferred requirement.",
      });
      if (selection?.match === "TRANSFERABLE" && selection.evidence) {
        transferable.push({ requirement: requirement.text, evidence: selection.evidence, reason: selection.reason, source: selection.source, verification: "VERIFIED" });
      }
      continue;
    }
    if (role !== "HARD_REQUIREMENT" || !selection) continue;
    if (selection.match === "DIRECT" && selection.evidence) direct.push({ requirement: requirement.text, evidence: selection.evidence, reason: selection.reason, source: selection.source, verification: "VERIFIED" });
    else if (selection.match === "TRANSFERABLE" && selection.evidence) transferable.push({ requirement: requirement.text, evidence: selection.evidence, reason: selection.reason, source: selection.source, verification: "VERIFIED" });
    else if (selection.match === "MISSING") missingHard.push({ requirement: requirement.text, reason: selection.reason });
    else uncertainHard.push({ requirement: requirement.text, reason: selection.reason });
  }
  return {
    state: "REVIEW",
    direct,
    transferable,
    missingHard,
    uncertainHard,
    preferred,
    responsibilities: requirements.filter((requirement) => roleOf(requirement) === "RESPONSIBILITY").map((requirement) => requirement.text),
  };
}

function roleOf(requirement: ExtractedRequirement): RequirementRole {
  if (requirement.role) return requirement.role;
  if (requirement.certainty === "responsibility" || requirement.kind === "RESPONSIBILITY") return "RESPONSIBILITY";
  if (requirement.certainty === "preferred" || requirement.kind === "NICE_TO_HAVE") return "PREFERRED_REQUIREMENT";
  if (requirement.certainty === "uncertain") return "UNKNOWN";
  if (requirement.required || requirement.certainty === "required" || requirement.kind === "MUST_HAVE" || requirement.kind === "EDUCATION" || requirement.kind === "EXPERIENCE_YEARS" || requirement.kind === "TECHNOLOGY") return "HARD_REQUIREMENT";
  return "UNKNOWN";
}

export function fitState(fit: { qualification?: string; recommendation?: string }): FitState {
  if (fit.qualification === "APPLY" || fit.qualification === "QUALIFIED") return "APPLY";
  if (fit.qualification === "REVIEW" || fit.qualification === "NOT_A_FIT") return fit.qualification;
  if (fit.recommendation === "PREPARE") return "APPLY";
  if (fit.recommendation === "DO_NOT_PREPARE" || fit.recommendation === "SKIP") return "NOT_A_FIT";
  return "REVIEW";
}

export function selectionCounts(fit: FitResult) {
  return {
    direct: fit.selections.filter((item) => item.match === "DIRECT").length,
    transferable: fit.selections.filter((item) => item.match === "TRANSFERABLE").length,
    uncertain: fit.selections.filter((item) => item.match === "UNCERTAIN").length,
    missing: fit.selections.filter((item) => item.match === "MISSING").length,
  };
}

export function vacancyInput(job: NormalizedVacancy): JobInput {
  return {
    title: job.title,
    companyName: job.companyName,
    description: job.description,
    location: job.location,
    remoteType: job.remoteType,
    applicationUrl: job.applicationUrl,
  };
}

export function analysisJobDecision(state: string | null) {
  if (state === "QUEUED" || state === "ACTIVE" || state === "COMPLETED") return "skip" as const;
  if (state === "FAILED") return "retry" as const;
  return "create" as const;
}

export function discoveryRunDecision(activeQueries: string[], query: string) {
  return activeQueries.includes(query.trim().toLowerCase()) ? "skip" as const : "create" as const;
}

export function emptySummary(): DiscoverySummary {
  return {
    discovered: 0,
    normalized: 0,
    duplicatesRemoved: 0,
    duplicateReasons: [],
    stored: 0,
    analyzed: 0,
    requirements: 0,
    qualified: 0,
    review: 0,
    notReady: 0,
    notAFit: 0,
    failed: 0,
    failures: [],
    sources: {},
    invalidSources: 0,
    discoveryMs: 0,
    analysisMs: 0,
  };
}

export type StoredRequirement = Pick<ExtractedRequirement, "kind" | "text" | "years" | "required">;

function identity(job: NormalizedVacancy): IdentityInput {
  return {
    companyName: job.companyName,
    title: job.title,
    applicationUrl: job.applicationUrl,
    sourceUrl: job.sourceUrl,
    externalId: job.externalId,
    location: job.location,
  };
}
