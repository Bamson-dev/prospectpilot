import type { FitResult } from "@/lib/applications/fit";
import type { JobInput } from "@/lib/applications/types";

export type RecruiterBrief = {
  lookingFor: string;
  evidence: string[];
  projects: string[];
  metrics: string[];
  keywords: string[];
  aboveTheFold: string;
  remove: string[];
  summary: string;
};

export function recruiterBrief(job: JobInput, fit: FitResult): RecruiterBrief {
  return {
    lookingFor: job.title,
    evidence: fit.strongEvidence,
    projects: fit.selectedProjects.map((project) => project.name),
    metrics: fit.selectedFacts.filter((fact) => fact.category === "METRIC").map((fact) => fact.fact),
    keywords: fit.selectedProjects.flatMap((project) => project.technologies).slice(0, 8),
    aboveTheFold: fit.strongEvidence[0] ?? job.title,
    remove: fit.gaps,
    summary: `Show ${fit.profile.toLowerCase()} evidence for ${job.title} at ${job.companyName}.`,
  };
}
