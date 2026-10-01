import type { CandidateRecord, CareerProfile, JobInput } from "@/lib/applications/types";
import type { FitResult } from "@/lib/applications/fit";
import { unsupportedClaims, validateCvFacts } from "@/lib/applications/claims";
import { careerStrategy, classifyCandidateEmail } from "@/lib/applications/seed-data";
import { bannedPhrases } from "@/lib/applications/writing";
import { DateValidator, FormattingValidator } from "@/lib/applications/validators";

export type CvDraft = {
  headline: string;
  summary: string;
  skills: string[];
  experience: Array<{ title: string; organization: string; bullets: string[] }>;
  projects: Array<{ name: string; bullets: string[] }>;
  text: string;
};

const HEADLINES: Record<CareerProfile, string> = {
  SOFTWARE: "Software Engineer",
  WEB: "Web Developer",
  MARKETING: "Growth Marketer",
  SAAS: "Product Engineer",
  GROWTH: "Growth and GTM",
  FOUNDER: "Founder",
  HYBRID: "Technical and Growth",
};

export function buildCvDraft(job: JobInput, candidate: CandidateRecord, fit: FitResult): CvDraft {
  const strategy = careerStrategy(fit.profile);
  const headline = strategy?.headline ?? HEADLINES[fit.profile];
  const excluded = strategy?.excluded ?? [];
  const jobText = `${job.title} ${job.description}`.toLowerCase();
  const generic = new Set(["software", "product", "web", "marketing", "work", "digital", "business"]);
  const mentioned = (values: string[]) => unique(values).filter((skill) => jobText.includes(skill.toLowerCase()) && !generic.has(skill.toLowerCase()));
  const skills = mentioned([
    ...fit.recommendedSkills,
    ...fit.selectedFacts.flatMap((fact) => fact.skills ?? []),
    ...fit.selectedProjects.flatMap((project) => project.technologies),
  ]).slice(0, 8);
  const visibleSkills = skills.length ? skills : mentioned(fit.selectedFacts.flatMap((fact) => fact.keywords ?? [])).slice(0, 4);
  const experience = candidate.experiences
    .filter((item) => item.verified && (item.profiles.length === 0 || item.profiles.includes(fit.profile)))
    .map((item) => ({
      title: item.title,
      organization: item.organizationName,
      bullets: [item.summary, ...fit.selectedFacts.filter((fact) => fact.fact.toLowerCase().includes(item.organizationName.toLowerCase())).map((fact) => fact.fact)].filter((bullet) => allowedLine(bullet, excluded)).slice(0, 4),
    }));
  const listedSkills = visibleSkills;
  const projects = fit.selectedProjects.map((project) => ({
    name: project.name,
    bullets: [project.description, project.role, ...project.outcomes, ...project.metrics].filter((bullet) => bullet && allowedLine(bullet, excluded)).slice(0, 4),
  }));
  const summary = summaryFor(job, candidate, fit, visibleSkills);
  const text = renderText({ headline, summary, skills: listedSkills, experience, projects, candidate, job });
  const check = unsupportedClaims(text, candidate, [job.companyName]);
  const banned = bannedPhrases(text);
  if (!check.ok || banned.length) {
    throw new Error(`Unsupported CV claim: ${[...check.unsupported, ...banned].join(", ")}`);
  }
  return { headline, summary, skills: listedSkills, experience, projects, text };
}

export function rewritePreservesVacancy(text: string, companyName: string, title: string) {
  return text.includes(companyName) && text.includes(title);
}

export function cvStorageFailure(email: string | null | undefined, warnings: string[]) {
  const status = classifyCandidateEmail(email);
  if (status === "PLACEHOLDER_EMAIL") return { error_code: "PLACEHOLDER_EMAIL", message: "A placeholder email blocks document generation.", field: "email", document_type: "CV", details: status };
  if (status === "MISSING_EMAIL") return { error_code: "MISSING_EMAIL", message: "A candidate email is required before document generation.", field: "email", document_type: "CV", details: status };
  if (status === "INVALID_EMAIL") return { error_code: "INVALID_EMAIL", message: "The candidate email is not valid.", field: "email", document_type: "CV", details: status };
  if (warnings.some((warning) => warning === "missing standard headings")) {
    return { error_code: "CV_HEADINGS_MISSING", message: "CV validation failed: required standard headings are missing.", field: "cv", document_type: "CV", details: "missing standard headings" };
  }
  const warning = warnings.find((item) => item.trim());
  return { error_code: "CV_NOT_STORED", message: warning ? `CV validation failed: ${warning}` : "No CV stored.", field: "cv", document_type: "CV", details: warning ?? null };
}

export function acceptCvRewrite(input: { draft: string; rewritten: string; candidate: CandidateRecord; companyName: string; title: string }) {
  if (input.rewritten === input.draft) return false;
  if (!rewritePreservesVacancy(input.rewritten, input.companyName, input.title)) return false;
  if (!validateCvText(input.rewritten, input.candidate, [], [input.companyName, input.title]).ok) return false;
  if (!DateValidator(input.rewritten, input.candidate).ok) return false;
  return FormattingValidator(input.rewritten).ok;
}

export function validateCvText(text: string, candidate: CandidateRecord, keywords: string[], allowedNames: string[] = []) {
  const problems: string[] = [];
  if (!text.includes(candidate.fullName)) problems.push("missing candidate name");
  if (!text.includes(candidate.email)) problems.push("missing contact details");
  if (text.trim().length < 80) problems.push("empty sections");
  const claims = validateCvFacts(text, candidate, allowedNames);
  if (claims.status === "REVIEW_REQUIRED") problems.push(...claims.issues.map((issue) => `unsupported ${issue.kind}: ${issue.value}`));
  const present = keywords.filter((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
  return { ok: problems.length === 0, problems, keywordHits: present };
}

function summaryFor(job: JobInput, candidate: CandidateRecord, fit: FitResult, skills: string[]) {
  const lead = fit.strongEvidence[0] ?? candidate.experiences.find((item) => item.profiles.includes(fit.profile))?.summary ?? "";
  const project = fit.selectedProjects[0]?.name;
  const skillLine = skills.length ? ` Skills on file for this version: ${skills.slice(0, 4).join(", ")}.` : "";
  const projectLine = project ? ` ${project} is the project placed first.` : "";
  return `${lead} Prepared for the ${job.title} role at ${job.companyName}.${projectLine}${skillLine}`.replace(/\s+/g, " ").trim();
}

function renderText(input: { headline: string; summary: string; skills: string[]; experience: CvDraft["experience"]; projects: CvDraft["projects"]; candidate: CandidateRecord; job: JobInput }) {
  const lines = [
    input.candidate.fullName,
    input.candidate.email,
    input.candidate.location ?? "",
    input.headline,
    "Summary",
    input.summary,
    "Skills",
    input.skills.join(", "),
    "Experience",
    ...input.experience.flatMap((item) => [item.title, item.organization, ...item.bullets]),
    "Projects",
    ...input.projects.flatMap((item) => [item.name, ...item.bullets]),
  ];
  return lines.filter(Boolean).join("\n");
}

function allowedLine(value: string, excluded: string[]) {
  const lower = value.toLowerCase();
  return !excluded.some((phrase) => lower.includes(phrase.toLowerCase()));
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
