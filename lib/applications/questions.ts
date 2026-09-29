import type { ApplicationQuestionKind, CandidateRecord, JobInput } from "@/lib/applications/types";
import type { FitResult } from "@/lib/applications/fit";
import { explicitTechnologyDuration, namedTechnology } from "@/lib/applications/field-taxonomy";

export type AnswerSource = "CANDIDATE_ENTERED" | "VERIFIED_EVIDENCE" | "SAFE_TRANSFORMATION" | "HUMAN_REVIEW";

export type QuestionDraft = {
  question: string;
  kind: ApplicationQuestionKind;
  classification: string;
  answer: string | null;
  status: "ANSWERED" | "NEEDS_USER_INPUT" | "REVIEW_REQUIRED";
  source: AnswerSource;
  confidence: number;
  required: boolean;
  reviewState: "ANSWERED" | "REVIEW_REQUIRED";
  reason: string | null;
  fieldType: string | null;
  options: string[];
  section: string | null;
};

export function allowedAnswerSource(source: string) {
  return source === "CANDIDATE_ENTERED" || source === "VERIFIED_EVIDENCE" || source === "SAFE_TRANSFORMATION" || source === "HUMAN_REVIEW";
}

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

function known(value: string | null | undefined) {
  const text = (value ?? "").trim();
  return text ? text : null;
}

function storedFact(candidate: CandidateRecord, pattern: RegExp) {
  return candidate.facts.find((fact) => fact.verified && pattern.test(fact.fact))?.fact ?? null;
}

function resolved(input: {
  question: string;
  kind: ApplicationQuestionKind;
  answer: string | null;
  source: AnswerSource;
  confidence: number;
  reason: string | null;
  required?: boolean;
  fieldType?: string | null;
  options?: string[];
  section?: string | null;
}): QuestionDraft {
  const answered = Boolean(input.answer) && input.source !== "HUMAN_REVIEW";
  return {
    question: input.question,
    kind: input.kind,
    classification: input.kind,
    answer: answered ? input.answer : null,
    status: answered ? "ANSWERED" : "REVIEW_REQUIRED",
    source: answered ? input.source : "HUMAN_REVIEW",
    confidence: answered ? input.confidence : 0,
    required: input.required ?? false,
    reviewState: answered ? "ANSWERED" : "REVIEW_REQUIRED",
    reason: answered ? null : input.reason,
    fieldType: input.fieldType ?? null,
    options: input.options ?? [],
    section: input.section ?? null,
  };
}

export function customQuestionRecord(input: {
  question: string;
  fieldType?: string | null;
  options?: string[];
  required?: boolean;
  section?: string | null;
  classification?: string;
  confidence?: number;
  answer?: string | null;
  source?: AnswerSource;
}) {
  const draft = resolved({
    question: input.question,
    kind: "OTHER",
    answer: input.answer ?? null,
    source: input.answer ? (input.source ?? "VERIFIED_EVIDENCE") : "HUMAN_REVIEW",
    confidence: input.confidence ?? (input.answer ? 0.8 : 0),
    reason: input.answer ? null : "No verified candidate fact answers this question.",
    required: input.required,
    fieldType: input.fieldType,
    options: input.options,
    section: input.section,
  });
  return { ...draft, classification: input.classification ?? "CUSTOM_QUESTION" };
}

export function answerQuestion(question: string, job: JobInput, candidate: CandidateRecord, fit: FitResult): QuestionDraft {
  const kind = classifyQuestion(question);
  if (/sponsor/i.test(question)) {
    const answer = known(candidate.sponsorship) ?? storedFact(candidate, /^sponsorship:/i);
    return resolved({ question, kind: "WORK_AUTHORIZATION", answer, source: "CANDIDATE_ENTERED", confidence: 1, reason: "Sponsorship was not entered by the candidate." });
  }
  if (kind === "SALARY" || kind === "WORK_AUTHORIZATION" || kind === "AVAILABILITY") {
    const pattern = kind === "SALARY" ? /^salary expectation:/i : kind === "WORK_AUTHORIZATION" ? /^work authorization:/i : /^(notice period|availability):/i;
    const direct = kind === "SALARY" ? known(candidate.salaryExpectation) : kind === "WORK_AUTHORIZATION" ? known(candidate.workAuthorization) : known(candidate.noticePeriod) ?? known(candidate.availability);
    const answer = direct ?? storedFact(candidate, pattern);
    const reason = kind === "SALARY" ? "Salary was not entered by the candidate." : kind === "WORK_AUTHORIZATION" ? "Work authorization was not entered by the candidate." : "Start date or notice period was not entered by the candidate.";
    return resolved({ question, kind, answer, source: "CANDIDATE_ENTERED", confidence: 1, reason });
  }
  if (kind === "BEHAVIORAL" || kind === "COMPANY_SPECIFIC" || kind === "MOTIVATION") {
    return resolved({ question, kind, answer: null, source: "HUMAN_REVIEW", confidence: 0, reason: "This question needs a human answer. Verified evidence is not turned into a motive." });
  }
  if (/rate your|from 1\s*[-–to]+\s*10|out of 10|skill level/i.test(question)) {
    return resolved({ question, kind, answer: null, source: "HUMAN_REVIEW", confidence: 0, reason: "Skill ratings are not inferred." });
  }
  if (/gender|race|ethnicity|veteran|disability|pronoun|date of birth|\bage\b/i.test(question)) {
    return resolved({ question, kind: "OTHER", answer: null, source: "HUMAN_REVIEW", confidence: 0, reason: "Sensitive question." });
  }
  if (/have you used|have you worked with|do you have experience with/i.test(question)) {
    const verified = candidate.projects.flatMap((project) => project.technologies).some((item) => question.toLowerCase().includes(item.toLowerCase()))
      || candidate.facts.some((fact) => fact.verified && fact.sourceType !== "SYSTEM_GENERATED" && question.toLowerCase().includes(fact.fact.toLowerCase()));
    return resolved({ question, kind: "TECHNICAL", answer: verified ? "Yes" : null, source: "SAFE_TRANSFORMATION", confidence: 0.9, reason: "That technology is not on verified evidence." });
  }
  if (/years/.test(question.toLowerCase()) && namedTechnology(question)) {
    const record = candidate.facts
      .filter((fact) => fact.verified && fact.sourceType !== "SYSTEM_GENERATED")
      .map((fact) => fact.fact)
      .join("\n");
    const duration = explicitTechnologyDuration(record, namedTechnology(question));
    return resolved({ question, kind: "EXPERIENCE", answer: duration ? `${duration} years` : null, source: "VERIFIED_EVIDENCE", confidence: 1, reason: "No explicit verified duration is on file for that technology." });
  }
  if (kind === "EXPERIENCE" && /years/.test(question.toLowerCase())) {
    if (candidate.yearsExperience == null) return resolved({ question, kind, answer: null, source: "HUMAN_REVIEW", confidence: 0, reason: "Years of experience were not entered." });
    return resolved({ question, kind, answer: `${candidate.yearsExperience} years are recorded on the candidate profile.`, source: "CANDIDATE_ENTERED", confidence: 1, reason: null });
  }
  if (/linkedin/i.test(question)) {
    const answer = storedFact(candidate, /linkedin/i) ?? known(candidate.linkedinUrl);
    return resolved({ question, kind, answer, source: "CANDIDATE_ENTERED", confidence: 1, reason: "LinkedIn was not entered." });
  }
  if (kind === "EDUCATION" || /certification|certificate/i.test(question)) {
    const category = /certification|certificate/i.test(question) ? "CERTIFICATION" : "EDUCATION";
    const answer = candidate.facts.find((fact) => fact.verified && fact.sourceType !== "SYSTEM_GENERATED" && fact.category === category)?.fact ?? null;
    return resolved({ question, kind, answer, source: "VERIFIED_EVIDENCE", confidence: 1, reason: "No verified education or certification answers this question." });
  }
  if (kind === "LOCATION") {
    return resolved({
      question,
      kind,
      answer: candidate.location ? `Based in ${candidate.location}.` : null,
      source: "SAFE_TRANSFORMATION",
      confidence: 1,
      reason: "Location was not entered.",
    });
  }
  if (kind === "OTHER") {
    return customQuestionRecord({ question, required: false });
  }
  const evidence = fit.strongEvidence[0];
  if (!evidence || kind === "PORTFOLIO" && !fit.selectedProjects[0]) {
    return resolved({ question, kind, answer: null, source: "HUMAN_REVIEW", confidence: 0, reason: "No verified evidence answers this question." });
  }
  if (kind === "PORTFOLIO") {
    const project = fit.selectedProjects.find((item) => item.name);
    return resolved({
      question,
      kind,
      answer: project ? `${project.name}: ${project.description}` : null,
      source: "VERIFIED_EVIDENCE",
      confidence: 0.9,
      reason: "No verified project answers this question.",
    });
  }
  return resolved({
    question,
    kind,
    answer: evidence,
    source: "VERIFIED_EVIDENCE",
    confidence: 0.8,
    reason: "No verified evidence answers this question.",
    section: job.companyName,
  });
}
