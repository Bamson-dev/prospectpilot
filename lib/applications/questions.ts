import type { ApplicationQuestionKind, CandidateRecord, JobInput } from "@/lib/applications/types";
import type { FitResult } from "@/lib/applications/fit";

export type QuestionDraft = {
  question: string;
  kind: ApplicationQuestionKind;
  answer: string | null;
  status: "ANSWERED" | "NEEDS_USER_INPUT" | "REVIEW_REQUIRED";
};

export function classifyQuestion(question: string): ApplicationQuestionKind {
  const text = question.toLowerCase();
  if (/salary|compensation|pay expectation|expected pay/.test(text)) return "SALARY";
  if (/authori[sz]ed|visa|citizen|sponsor|right to work/.test(text)) return "WORK_AUTHORIZATION";
  if (/available|notice period|start date/.test(text)) return "AVAILABILITY";
  if (/linkedin/.test(text)) return "PORTFOLIO";
  if (/where are you based|location|relocat/.test(text)) return "LOCATION";
  if (/degree|university|education/.test(text)) return "EDUCATION";
  if (/how many years|years of experience/.test(text)) return "EXPERIENCE";
  if (/portfolio|github|website/.test(text)) return "PORTFOLIO";
  if (/why .*company|why do you want/.test(text)) return "COMPANY_SPECIFIC";
  if (/tell me about a time|conflict|leadership/.test(text)) return "BEHAVIORAL";
  if (/why|motivat|interested/.test(text)) return "MOTIVATION";
  if (/built|experience|years|project|technical|stack/.test(text)) return "TECHNICAL";
  if (/experience/.test(text)) return "EXPERIENCE";
  return "OTHER";
}

function storedFact(candidate: CandidateRecord, pattern: RegExp) {
  return candidate.facts.find((fact) => fact.verified && pattern.test(fact.fact))?.fact ?? null;
}

export function answerQuestion(question: string, job: JobInput, candidate: CandidateRecord, fit: FitResult): QuestionDraft {
  const kind = classifyQuestion(question);
  if (kind === "SALARY" || kind === "WORK_AUTHORIZATION" || kind === "AVAILABILITY") {
    const pattern = kind === "SALARY" ? /^salary expectation:/i : kind === "WORK_AUTHORIZATION" ? /^work authorization:/i : /^(notice period|availability):/i;
    const answer = storedFact(candidate, pattern);
    return { question, kind, answer, status: answer ? "ANSWERED" : "REVIEW_REQUIRED" };
  }
  if (kind === "BEHAVIORAL" || kind === "COMPANY_SPECIFIC") {
    return { question, kind, answer: null, status: "REVIEW_REQUIRED" };
  }
  if (kind === "EXPERIENCE" && /years/.test(question.toLowerCase())) {
    if (candidate.yearsExperience == null) return { question, kind, answer: null, status: "REVIEW_REQUIRED" };
    return { question, kind, answer: `${candidate.yearsExperience} years are recorded on the candidate profile.`, status: "ANSWERED" };
  }
  if (/linkedin/i.test(question)) {
    const answer = storedFact(candidate, /linkedin/i);
    return { question, kind, answer, status: answer ? "ANSWERED" : "REVIEW_REQUIRED" };
  }
  if (kind === "EDUCATION" || /certification|certificate/i.test(question)) {
    const category = /certification|certificate/i.test(question) ? "CERTIFICATION" : "EDUCATION";
    const answer = candidate.facts.find((fact) => fact.verified && fact.sourceType !== "SYSTEM_GENERATED" && fact.category === category)?.fact ?? null;
    return { question, kind, answer, status: answer ? "ANSWERED" : "REVIEW_REQUIRED" };
  }
  if (kind === "LOCATION") {
    return {
      question,
      kind,
      answer: candidate.location ? `Based in ${candidate.location}.` : null,
      status: candidate.location ? "ANSWERED" : "REVIEW_REQUIRED",
    };
  }
  const evidence = fit.strongEvidence[0];
  if (!evidence) return { question, kind, answer: null, status: "REVIEW_REQUIRED" };
  if (kind === "PORTFOLIO") {
    const project = fit.selectedProjects.find((item) => item.name);
    return {
      question,
      kind,
      answer: project ? `${project.name}: ${project.description}` : null,
      status: project ? "ANSWERED" : "REVIEW_REQUIRED",
    };
  }
  return {
    question,
    kind,
    answer: `For the ${job.title} role at ${job.companyName}, the relevant verified evidence is: ${evidence}`,
    status: "ANSWERED",
  };
}
