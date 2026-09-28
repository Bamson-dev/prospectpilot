import { buildCoverLetter } from "@/lib/applications/cover-letter";
import { buildCvDraft } from "@/lib/applications/cv";
import { scoreJobFit } from "@/lib/applications/fit";
import { answerQuestion } from "@/lib/applications/questions";
import { extractRequirements } from "@/lib/applications/requirements";
import { contactIsReady } from "@/lib/applications/seed-data";
import type { CandidateRecord, JobInput } from "@/lib/applications/types";

export function assemblePackage(job: JobInput, candidate: CandidateRecord) {
  const requirements = extractRequirements(job.description);
  const fit = scoreJobFit(job, candidate, requirements);
  const questions = job.description.split("\n").map((line) => line.trim()).filter((line) => line.endsWith("?"));
  const cv = contactIsReady(candidate.email) && fit.recommendation !== "SKIP" ? buildCvDraft(job, candidate, fit) : null;
  const coverLetter = fit.recommendation === "SKIP" ? null : buildCoverLetter(job, candidate, fit);
  return {
    requirements,
    fit,
    cv,
    coverLetter,
    answers: questions.map((question) => answerQuestion(question, job, candidate, fit)),
  };
}
