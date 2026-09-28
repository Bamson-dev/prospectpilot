import type { CandidateRecord, JobInput } from "@/lib/applications/types";
import type { FitResult } from "@/lib/applications/fit";
import { unsupportedClaims } from "@/lib/applications/claims";

export function buildCoverLetter(job: JobInput, candidate: CandidateRecord, fit: FitResult) {
  const evidence = fit.strongEvidence.slice(0, 2);
  const project = fit.selectedProjects[0];
  const paragraphs = [
    `I am applying for the ${job.title} role at ${job.companyName}.`,
    evidence.length
      ? `The work I can speak to directly is ${evidence.join(" ")}`
      : "",
    project ? `${project.name} is the project I would point to first: ${project.description}` : "",
    fit.missingRequirements.length
      ? `I have not claimed experience I cannot verify. Open points are: ${fit.missingRequirements.slice(0, 3).join("; ")}.`
      : "I kept this letter to evidence that is already on record.",
  ].filter(Boolean);
  const text = paragraphs.join("\n\n");
  const check = unsupportedClaims(text, candidate, [job.companyName]);
  if (!check.ok) throw new Error(`Unsupported cover letter claim: ${check.unsupported.join(", ")}`);
  return text;
}
