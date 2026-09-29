import type { CandidateRecord, JobInput } from "@/lib/applications/types";
import type { FitResult } from "@/lib/applications/fit";
import { unsupportedClaims } from "@/lib/applications/claims";
import { bannedPhrases } from "@/lib/applications/writing";

export function buildCoverLetter(job: JobInput, candidate: CandidateRecord, fit: FitResult) {
  const evidence = fit.strongEvidence.slice(0, 3);
  const project = fit.selectedProjects[0];
  const paragraphs = [
    `I am applying for the ${job.title} role at ${job.companyName}.`,
    evidence.length ? evidence.map((item) => item.endsWith(".") ? item : `${item}.`).join(" ") : "",
    project ? `For this role I would point to ${project.name}. ${project.description}` : "",
    fit.missingRequirements.length || fit.uncertain.length
      ? "Some requirements are not on file, so I have not filled those in."
      : "That is the evidence I can stand behind.",
  ].filter(Boolean);
  const text = paragraphs.join("\n\n");
  const check = unsupportedClaims(text, candidate, [job.companyName]);
  const banned = bannedPhrases(text);
  if (!check.ok || banned.length) throw new Error(`Unsupported cover letter claim: ${[...check.unsupported, ...banned].join(", ")}`);
  return text;
}
