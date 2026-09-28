import type { ApplicationQuestionKind, CandidateRecord, JobInput } from "@/lib/applications/types";
import type { FitResult } from "@/lib/applications/fit";

export type QuestionDraft = {
  question: string;
  kind: ApplicationQuestionKind;
  answer: string | null;
  status: "ANSWERED" | "NEEDS_USER_INPUT";
};

export function classifyQuestion(question: string): ApplicationQuestionKind {
  const text = question.toLowerCase();
  if (/salary|compensation|pay|rate/.test(text)) return "SALARY";
  if (/authori[sz]ed|visa|citizen|sponsor|right to work/.test(text)) return "WORK_AUTHORIZATION";
  if (/available|notice period|start date/.test(text)) return "AVAILABILITY";
  if (/where|location|relocat|remote/.test(text)) return "LOCATION";
  if (/degree|university|education/.test(text)) return "EDUCATION";
  if (/portfolio|github|website/.test(text)) return "PORTFOLIO";
  if (/why .*company|why do you want/.test(text)) return "COMPANY_SPECIFIC";
  if (/tell me about a time|conflict|leadership/.test(text)) return "BEHAVIORAL";
  if (/why|motivat|interested/.test(text)) return "MOTIVATION";
  if (/built|experience|years|project|technical|stack/.test(text)) return "TECHNICAL";
  if (/experience/.test(text)) return "EXPERIENCE";
  return "OTHER";
}

export function answerQuestion(question: string, job: JobInput, candidate: CandidateRecord, fit: FitResult): QuestionDraft {
  const kind = classifyQuestion(question);
  if (kind === "SALARY" || kind === "WORK_AUTHORIZATION" || kind === "AVAILABILITY") {
    return { question, kind, answer: null, status: "NEEDS_USER_INPUT" };
  }
  if (kind === "EDUCATION" && !candidate.facts.some((fact) => fact.category === "EDUCATION" && fact.verified)) {
    return { question, kind, answer: null, status: "NEEDS_USER_INPUT" };
  }
  if (kind === "LOCATION") {
    return {
      question,
      kind,
      answer: candidate.location ? `Based in ${candidate.location}.` : null,
      status: candidate.location ? "ANSWERED" : "NEEDS_USER_INPUT",
    };
  }
  const evidence = fit.strongEvidence[0];
  if (!evidence) return { question, kind, answer: null, status: "NEEDS_USER_INPUT" };
  if (kind === "PORTFOLIO") {
    const project = fit.selectedProjects.find((item) => item.name);
    return {
      question,
      kind,
      answer: project ? `${project.name}: ${project.description}` : null,
      status: project ? "ANSWERED" : "NEEDS_USER_INPUT",
    };
  }
  return {
    question,
    kind,
    answer: `For the ${job.title} role at ${job.companyName}, the relevant verified evidence is: ${evidence}`,
    status: "ANSWERED",
  };
}
