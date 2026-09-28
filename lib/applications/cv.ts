import type { CandidateRecord, CareerProfile, JobInput } from "@/lib/applications/types";
import type { FitResult } from "@/lib/applications/fit";
import { unsupportedClaims } from "@/lib/applications/claims";

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
};

export function buildCvDraft(job: JobInput, candidate: CandidateRecord, fit: FitResult): CvDraft {
  const headline = HEADLINES[fit.profile];
  const skills = unique([
    ...fit.selectedFacts.flatMap((fact) => fact.skills ?? []),
    ...fit.selectedProjects.flatMap((project) => project.technologies),
  ]).slice(0, 12);
  const experience = candidate.experiences
    .filter((item) => item.verified && (item.profiles.length === 0 || item.profiles.includes(fit.profile)))
    .map((item) => ({
      title: item.title,
      organization: item.organizationName,
      bullets: [item.summary, ...fit.selectedFacts.filter((fact) => fact.fact.toLowerCase().includes(item.organizationName.toLowerCase())).map((fact) => fact.fact)].slice(0, 4),
    }));
  const projects = fit.selectedProjects.map((project) => ({
    name: project.name,
    bullets: [project.description, project.role, ...project.outcomes, ...project.metrics].filter(Boolean).slice(0, 4),
  }));
  const summary = summaryFor(job, candidate, fit, skills);
  const text = renderText({ headline, summary, skills, experience, projects, candidate, job });
  const check = unsupportedClaims(text, candidate, [job.companyName]);
  if (!check.ok) {
    throw new Error(`Unsupported CV claim: ${check.unsupported.join(", ")}`);
  }
  return { headline, summary, skills, experience, projects, text };
}

export function validateCvText(text: string, candidate: CandidateRecord, keywords: string[], allowedNames: string[] = []) {
  const problems: string[] = [];
  if (!text.includes(candidate.fullName)) problems.push("missing candidate name");
  if (!text.includes(candidate.email)) problems.push("missing contact details");
  if (text.trim().length < 80) problems.push("empty sections");
  const claims = unsupportedClaims(text, candidate, allowedNames);
  if (!claims.ok) problems.push(`unsupported facts: ${claims.unsupported.join(", ")}`);
  const present = keywords.filter((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
  return { ok: problems.length === 0, problems, keywordHits: present };
}

function summaryFor(job: JobInput, candidate: CandidateRecord, fit: FitResult, skills: string[]) {
  const lead = fit.strongEvidence[0] ?? `${candidate.fullName} builds and operates digital products.`;
  const skillLine = skills.length ? ` Relevant evidence includes ${skills.slice(0, 4).join(", ")}.` : "";
  return `${lead} This CV is arranged for the ${job.title} role at ${job.companyName}.${skillLine}`;
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

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
