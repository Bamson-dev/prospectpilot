import { unsupportedClaims, validateCvFacts } from "@/lib/applications/claims";
import { buildCoverLetter } from "@/lib/applications/cover-letter";
import { validateCoverLetterForVacancy } from "@/lib/applications/document-check";
import { buildCvDraft } from "@/lib/applications/cv";
import { scoreJobFit } from "@/lib/applications/fit";
import { answerQuestion } from "@/lib/applications/questions";
import { extractRequirements } from "@/lib/applications/requirements";
import { contactIsReady } from "@/lib/applications/seed-data";
import { pipelineState } from "@/lib/applications/state";
import { assessWriting } from "@/lib/applications/writing-quality";
import type { CandidateRecord, JobInput } from "@/lib/applications/types";

export function assemblePackage(job: JobInput, candidate: CandidateRecord) {
  const requirements = extractRequirements(job.description);
  const fit = scoreJobFit(job, candidate, requirements);
  const questions = job.description.split("\n").map((line) => line.trim()).filter((line) => line.endsWith("?"));
  const stopped = fit.recommendation === "SKIP" || fit.recommendation === "DO_NOT_PREPARE";
  const cv = contactIsReady(candidate.email) && !stopped ? buildCvDraft(job, candidate, fit) : null;
  const coverLetter = stopped ? null : buildCoverLetter(job, candidate, fit);
  const answers = questions.map((question) => answerQuestion(question, job, candidate, fit));
  const cvValidation = cv ? validateCvFacts(cv.text, candidate, [job.companyName, job.title]) : { status: "NOT_GENERATED" as const, issues: [] };
  const coverClaims = coverLetter ? unsupportedClaims(coverLetter, candidate, [job.companyName]) : { ok: true, unsupported: [] as string[] };
  const coverWriting = coverLetter ? assessWriting({ text: coverLetter, jobDescription: job.description, unsupportedClaims: coverClaims.unsupported }) : null;
  const coverSpecificity = coverLetter ? validateCoverLetterForVacancy({ text: coverLetter, companyName: job.companyName, title: job.title }) : null;
  const reviewAnswers = answers.filter((answer) => answer.reviewState === "REVIEW_REQUIRED");
  const hardBlocked = false;
  const decision = cvValidation.status === "REVIEW_REQUIRED" || coverWriting?.status === "REVIEW_REQUIRED" || !coverClaims.ok || reviewAnswers.length > 0 || !contactIsReady(candidate.email)
    ? "REVIEW_REQUIRED" as const
    : "READY" as const;
  return {
    vacancy: job,
    requirements,
    fit,
    selections: fit.selections,
    cv,
    cvValidation,
    coverLetter,
    coverValidation: {
      status: !coverLetter ? "NOT_GENERATED" as const : !coverClaims.ok || coverWriting?.status === "REVIEW_REQUIRED" || coverSpecificity?.ok === false ? "REVIEW_REQUIRED" as const : "PASS" as const,
      unsupported: coverClaims.unsupported,
      specificity: coverSpecificity?.problems ?? [],
      writing: coverWriting?.status ?? "NOT_GENERATED",
    },
    answers,
    readiness: hardBlocked ? "HARD_BLOCKED" as const : decision,
    pipeline: pipelineState(decision === "READY" ? "READY_FOR_REVIEW" : "REQUIRES_REVIEW"),
    version: 1,
  };
}
