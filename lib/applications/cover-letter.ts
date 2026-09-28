import type { CandidateRecord, JobInput } from "@/lib/applications/types";
import type { FitResult } from "@/lib/applications/fit";
import { unsupportedClaims } from "@/lib/applications/claims";
import { bannedPhrases } from "@/lib/applications/writing";

export function buildCoverLetter(job: JobInput, candidate: CandidateRecord, fit: FitResult) {
  const evidence = fit.strongEvidence.slice(0, 2);
  const project = fit.selectedProjects[0];
  const companyNote = job.description.trim().length > 80
    ? `The posting describes ${job.title} work at ${job.companyName}. I do not have a separate research note on the company, so this letter stays with the role.`
    : `This letter stays with the ${job.title} role at ${job.companyName}.`;
  const paragraphs = [
    `I am applying for the ${job.title} role at ${job.companyName}.`,
    companyNote,
    evidence.length ? `The record I can use is ${evidence.join(" ")}` : "",
    project ? `The project I would put first is ${project.name}: ${project.description}` : "",
    fit.missingRequirements.length
      ? `Open points, which I am not filling in: ${fit.missingRequirements.slice(0, 3).join("; ")}.`
      : "The points above are already on the candidate record.",
  ].filter(Boolean);
  const text = paragraphs.join("\n\n");
  const check = unsupportedClaims(text, candidate, [job.companyName]);
  const banned = bannedPhrases(text);
  if (!check.ok || banned.length) throw new Error(`Unsupported cover letter claim: ${[...check.unsupported, ...banned].join(", ")}`);
  return text;
}
