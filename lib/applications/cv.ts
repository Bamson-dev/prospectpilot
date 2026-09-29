import type { CandidateRecord, CareerProfile, JobInput } from "@/lib/applications/types";
import type { FitResult } from "@/lib/applications/fit";
import { unsupportedClaims } from "@/lib/applications/claims";
import { careerStrategy } from "@/lib/applications/seed-data";
import { bannedPhrases } from "@/lib/applications/writing";

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
    input.skills.length ? "Skills" : "",
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
