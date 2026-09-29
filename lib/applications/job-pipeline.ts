import { duplicateDecision, type IdentityInput } from "@/lib/applications/dedupe";
import { matchesQuery, normalizeVacancy, type NormalizedVacancy, type RawDiscoveredVacancy } from "@/lib/applications/job-normalize";
import { scoreJobFit, type FitResult } from "@/lib/applications/fit";
import { extractRequirements } from "@/lib/applications/requirements";
import type { CandidateRecord, ExtractedRequirement, JobInput } from "@/lib/applications/types";

export type FitState = "QUALIFIED" | "REVIEW" | "NOT_READY";

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
  failed: number;
  failures: Array<{ source: string; reason: string }>;
  sources: Record<string, number>;
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
  const kept: NormalizedVacancy[] = [];
  const duplicateReasons: string[] = [];
  for (const job of normalized) {
    const match = kept.find((existing) => duplicateDecision(identity(existing), identity(job)).merge);
    if (!match) {
      kept.push(job);
      continue;
    }
    duplicateReasons.push(duplicateDecision(identity(match), identity(job)).reason ?? "duplicate");
  }
  return { normalized, kept, duplicateReasons, failed };
}

export function assessVacancy(job: JobInput, candidate: CandidateRecord) {
  const requirements = extractRequirements(job.description);
  const fit = scoreJobFit(job, candidate, requirements);
  return { requirements, fit, state: fitState(fit) };
}

export function fitState(fit: Pick<FitResult, "recommendation">): FitState {
  if (fit.recommendation === "PREPARE") return "QUALIFIED";
  if (fit.recommendation === "DO_NOT_PREPARE" || fit.recommendation === "SKIP") return "NOT_READY";
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
    failed: 0,
    failures: [],
    sources: {},
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
