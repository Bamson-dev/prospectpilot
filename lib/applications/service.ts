import { createHash } from "node:crypto";
import type { CareerProfileKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logInfo } from "@/lib/logger";
import { completeJson } from "@/lib/ai/client";
import { applicationIdentity } from "@/lib/applications/dedupe";
import { scoreJobFit } from "@/lib/applications/fit";
import { buildCoverLetter } from "@/lib/applications/cover-letter";
import { buildCvDraft, validateCvText } from "@/lib/applications/cv";
import { checksum, docxContains, pdfLooksReadable, renderDocx, renderPdf } from "@/lib/applications/documents";
import { documentFileName } from "@/lib/applications/filenames";
import { answerQuestion } from "@/lib/applications/questions";
import { extractRequirements } from "@/lib/applications/requirements";
import { CAREER_PROFILES, contactIsReady, seedCandidateRecord, seedWritingProfile } from "@/lib/applications/seed-data";
import type { CandidateRecord, JobInput } from "@/lib/applications/types";
import { DateValidator, FormattingValidator } from "@/lib/applications/validators";
import { CV_SYSTEM_PROMPT, evidencePrompt } from "@/lib/applications/prompts";
import { dedupeDiscovered, type DiscoveredJob } from "@/lib/applications/providers";
import { cvGenerationEnabled, coverLetterGenerationEnabled } from "@/lib/applications/config";

export async function ensureCandidate(organizationId: string) {
  const seed = seedCandidateRecord();
  const candidate = await prisma.candidate.upsert({
    where: { organizationId_email: { organizationId, email: seed.email } },
    update: {},
    create: {
      organizationId,
      fullName: seed.fullName,
      firstName: seed.firstName,
      lastName: seed.lastName,
      email: seed.email,
      headline: "Software, web, and growth",
      profiles: { create: CAREER_PROFILES.map((profile) => ({ kind: profile.kind, title: profile.title, summary: profile.summary })) },
      writing: { create: seedWritingProfile() },
      preference: { create: { discoverJobs: false, dailyTarget: 500, mode: "AUTO_PREPARE" } },
    },
  });
  for (const profile of CAREER_PROFILES) {
    await prisma.candidateCareerProfile.upsert({
      where: { candidateId_kind: { candidateId: candidate.id, kind: profile.kind } },
      update: { title: profile.title, summary: profile.summary },
      create: { candidateId: candidate.id, kind: profile.kind, title: profile.title, summary: profile.summary },
    });
  }
  const writing = seedWritingProfile();
  await prisma.candidateWritingProfile.upsert({
    where: { candidateId: candidate.id },
    update: writing,
    create: { candidateId: candidate.id, ...writing },
  });
  for (const fact of seed.facts) {
    await prisma.candidateFact.upsert({
      where: { candidateId_category_fact: { candidateId: candidate.id, category: fact.category, fact: fact.fact } },
      update: { verified: true, profiles: fact.profiles, skills: fact.skills ?? [], technologies: fact.technologies ?? [], keywords: fact.keywords ?? [] },
      create: {
        candidateId: candidate.id,
        category: fact.category,
        fact: fact.fact,
        source: fact.fact.startsWith("ProspectPilot") ? "prospectpilot-repository" : "operator-supplied candidate brief",
        verified: true,
        confidence: 80,
        profiles: fact.profiles,
        skills: fact.skills ?? [],
        technologies: fact.technologies ?? [],
        keywords: fact.keywords ?? [],
      },
    });
  }
  for (const project of seed.projects) {
    await prisma.candidateProject.upsert({
      where: { candidateId_name: { candidateId: candidate.id, name: project.name } },
      update: {
        technologies: project.technologies,
        profiles: project.profiles,
        description: project.description,
        url: project.url,
        githubUrl: project.githubUrl,
        verified: true,
      },
      create: {
        candidateId: candidate.id,
        name: project.name,
        description: project.description,
        role: project.role,
        technologies: project.technologies,
        features: project.features,
        outcomes: project.outcomes,
        url: project.url,
        githubUrl: project.githubUrl,
        verified: true,
        source: project.source ?? (project.name === "ProspectPilot" ? "prospectpilot-repository" : "operator-supplied candidate brief"),
        profiles: project.profiles,
      },
    });
  }
  const existingExperience = await prisma.candidateExperience.findFirst({
    where: { candidateId: candidate.id, organizationName: "PromptEarn" },
  });
  if (!existingExperience) {
    await prisma.candidateExperience.create({
      data: {
        candidateId: candidate.id,
        title: "Founder",
        organizationName: "PromptEarn",
        summary: seed.experiences[0].summary,
        verified: true,
        current: false,
        source: "operator-supplied candidate brief",
        profiles: ["MARKETING", "GROWTH", "FOUNDER", "SAAS", "HYBRID"],
      },
    });
  } else {
    await prisma.candidateExperience.update({
      where: { id: existingExperience.id },
      data: { profiles: ["MARKETING", "GROWTH", "FOUNDER", "SAAS", "HYBRID"], summary: seed.experiences[0].summary },
    });
  }
  return candidate;
}

export async function loadCandidateRecord(candidateId: string): Promise<CandidateRecord> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: { facts: true, projects: true, experiences: true },
  });
  if (!candidate) throw new AppError("Candidate not found.");
  return {
    fullName: candidate.fullName,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    email: candidate.email,
    phone: candidate.phone,
    location: candidate.location,
    facts: candidate.facts.map((fact) => ({
      id: fact.id,
      category: fact.category,
      fact: fact.fact,
      verified: fact.verified,
      profiles: fact.profiles,
      skills: fact.skills,
      technologies: fact.technologies,
      keywords: fact.keywords,
    })),
    projects: candidate.projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      role: project.role,
      technologies: project.technologies,
      features: project.features,
      outcomes: project.outcomes,
      metrics: project.metrics,
      verified: project.verified,
      profiles: project.profiles,
    })),
    experiences: candidate.experiences.map((item) => ({
      id: item.id,
      title: item.title,
      organizationName: item.organizationName,
      summary: item.summary,
      verified: item.verified,
      profiles: item.profiles,
    })),
  };
}

export async function storeDiscoveredJobs(organizationId: string, jobs: DiscoveredJob[]) {
  const stored: string[] = [];
  for (const job of dedupeDiscovered(jobs)) {
    const identity = applicationIdentity(job);
    const duplicate = await prisma.jobVacancy.findFirst({
      where: { organizationId, OR: [{ applicationUrl: job.applicationUrl }, { externalId: identity }] },
      select: { id: true },
    });
    if (duplicate) continue;
    const created = await prisma.jobVacancy.create({
      data: {
        organizationId,
        source: job.source,
        sourceUrl: job.sourceUrl,
        applicationUrl: job.applicationUrl,
        externalId: job.externalId ?? identity,
        companyName: job.companyName,
        companyDomain: job.companyDomain,
        title: job.title,
        location: job.location,
        description: job.description,
        status: "DISCOVERED",
      },
    });
    stored.push(created.id);
  }
  return stored;
}

export async function prepareApplication(organizationId: string, vacancyId: string) {
  const started = Date.now();
  const vacancy = await prisma.jobVacancy.findFirst({ where: { id: vacancyId, organizationId } });
  if (!vacancy) throw new AppError("Vacancy not found.");
  const candidateRow = await ensureCandidate(organizationId);
  const candidate = await loadCandidateRecord(candidateRow.id);
  const job: JobInput = {
    title: vacancy.title,
    companyName: vacancy.companyName,
    description: vacancy.description,
    location: vacancy.location,
    remoteType: vacancy.remoteType,
    applicationUrl: vacancy.applicationUrl,
  };
  const requirements = extractRequirements(vacancy.description);
  await prisma.jobRequirement.deleteMany({ where: { vacancyId } });
  if (requirements.length) {
    await prisma.jobRequirement.createMany({
      data: requirements.map((item) => ({ vacancyId, kind: item.kind, text: item.text, years: item.years, required: item.required })),
    });
  }
  const fit = scoreJobFit(job, candidate, requirements);
  await prisma.jobFitSnapshot.upsert({
    where: { vacancyId },
    update: fitData(candidateRow.id, fit),
    create: { vacancyId, ...fitData(candidateRow.id, fit) },
  });
  const warnings = [...fit.gaps.map((gap) => `Missing requirement: ${gap}`)];
  if (!contactIsReady(candidate.email)) warnings.push("Candidate email is still a placeholder.");
  const questions = vacancy.description.split("\n").map((line) => line.trim()).filter((line) => line.endsWith("?")).slice(0, 8);
  const answers = questions.map((question) => answerQuestion(question, job, candidate, fit));
  if (answers.some((answer) => answer.status === "NEEDS_USER_INPUT")) warnings.push("A question needs user input.");
  let cvId: string | null = null;
  let coverLetterId: string | null = null;
  if (cvGenerationEnabled() && contactIsReady(candidate.email) && fit.recommendation !== "SKIP") {
    const cv = buildCvDraft(job, candidate, fit);
    const rewritten = await maybeRewrite(cv.text, candidate);
    const rewrittenOk = rewritten !== cv.text && validateCvText(rewritten, candidate, [], [job.companyName]).ok && DateValidator(rewritten, candidate).ok;
    const text = rewrittenOk ? rewritten : cv.text;
    const validation = validateCvText(text, candidate, fit.selectedProjects.flatMap((project) => project.technologies).slice(0, 6), [job.companyName]);
    const dates = DateValidator(text, candidate);
    const formatting = FormattingValidator(text);
    if (!validation.ok || !dates.ok || !formatting.ok) {
      warnings.push(...validation.problems, ...dates.problems.map((year) => `unsupported year ${year}`), ...formatting.problems);
    } else {
      const pdf = await renderPdf(text);
      const docx = await renderDocx(text);
      if (!pdfLooksReadable(pdf, candidate.fullName) || !(await docxContains(docx, candidate.fullName))) {
        warnings.push("Generated document failed the readability check.");
      } else {
        cvId = await storeDocument({ organizationId, candidateId: candidateRow.id, vacancyId, profile: fit.profile, kind: "CV", text, bytes: pdf, fileType: "application/pdf", headline: cv.headline, companyName: job.companyName, fullName: candidate.fullName, extension: "pdf" });
        await storeDocument({ organizationId, candidateId: candidateRow.id, vacancyId, profile: fit.profile, kind: "CV", text, bytes: docx, fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", headline: cv.headline, companyName: job.companyName, fullName: candidate.fullName, extension: "docx" });
      }
    }
  }
  if (coverLetterGenerationEnabled() && contactIsReady(candidate.email) && fit.recommendation !== "SKIP") {
    const letter = buildCoverLetter(job, candidate, fit);
    const bytes = await renderPdf(letter);
    coverLetterId = await storeDocument({
      organizationId,
      candidateId: candidateRow.id,
      vacancyId,
      profile: fit.profile,
      kind: "COVER_LETTER",
      text: letter,
      bytes,
      fileType: "application/pdf",
      headline: "Cover-Letter",
      companyName: job.companyName,
      fullName: candidate.fullName,
      extension: "pdf",
    });
  }
  const status = fit.recommendation === "SKIP" ? "FAILED" : warnings.length ? "READY_FOR_REVIEW" : "READY_TO_SUBMIT";
  const application = await prisma.jobApplication.upsert({
    where: { organizationId_vacancyId_candidateId: { organizationId, vacancyId, candidateId: candidateRow.id } },
    update: { profile: fit.profile, status, cvId, coverLetterId, source: vacancy.source, applicationUrl: vacancy.applicationUrl },
    create: {
      organizationId,
      candidateId: candidateRow.id,
      vacancyId,
      profile: fit.profile,
      status,
      source: vacancy.source,
      applicationUrl: vacancy.applicationUrl,
      cvId,
      coverLetterId,
    },
  });
  await prisma.applicationPackage.upsert({
    where: { applicationId: application.id },
    update: { profile: fit.profile, fitSummary: `${fit.overallMatch}`, strategy: fit.recommendation, status, warnings },
    create: { applicationId: application.id, profile: fit.profile, fitSummary: `${fit.overallMatch}`, strategy: fit.recommendation, status, warnings },
  });
  await prisma.applicationAnswer.deleteMany({ where: { applicationId: application.id } });
  if (answers.length) {
    await prisma.applicationAnswer.createMany({
      data: answers.map((answer) => ({ applicationId: application.id, question: answer.question, kind: answer.kind, answer: answer.answer, status: answer.status })),
    });
  }
  await prisma.applicationEvent.create({ data: { applicationId: application.id, type: "FIT_CALCULATED", detail: fit.recommendation } });
  if (cvId) await prisma.applicationEvent.create({ data: { applicationId: application.id, type: "CV_GENERATED" } });
  const followUp = await prisma.applicationFollowUp.findFirst({ where: { applicationId: application.id } });
  if (!followUp) {
    await prisma.applicationFollowUp.create({
      data: {
        applicationId: application.id,
        runAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        channel: "email",
        status: "DRAFT",
        draft: `Draft follow-up for the ${job.title} application at ${job.companyName}. This stays a draft until someone approves it.`,
      },
    });
  }
  await prisma.jobVacancy.update({
    where: { id: vacancyId },
    data: { status: fit.recommendation === "SKIP" ? "REJECTED" : "QUALIFIED" },
  });
  logInfo("application.prepared", { organizationId, vacancyId, applicationId: application.id, durationMs: Date.now() - started, status });
  return application.id;
}

export async function applicationStats(organizationId: string) {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const [discovered, qualified, prepared, submitted, verified, failed, blocked, manual, cvs] = await Promise.all([
    prisma.jobVacancy.count({ where: { organizationId, createdAt: { gte: since } } }),
    prisma.jobVacancy.count({ where: { organizationId, status: "QUALIFIED", createdAt: { gte: since } } }),
    prisma.jobApplication.count({ where: { organizationId, createdAt: { gte: since } } }),
    prisma.jobApplication.count({ where: { organizationId, status: "SUBMITTED", submittedAt: { gte: since } } }),
    prisma.jobApplication.count({ where: { organizationId, verifiedAt: { gte: since } } }),
    prisma.jobApplication.count({ where: { organizationId, status: "FAILED", createdAt: { gte: since } } }),
    prisma.jobApplication.count({ where: { organizationId, blockedReason: { not: null }, createdAt: { gte: since } } }),
    prisma.jobApplication.count({ where: { organizationId, status: "REQUIRES_MANUAL_ACTION", createdAt: { gte: since } } }),
    prisma.generatedDocument.count({ where: { organizationId, kind: "CV", createdAt: { gte: since } } }),
  ]);
  return { discovered, qualified, prepared, submitted, verified, failed, blocked, manual, cvs };
}

function fitData(candidateId: string, fit: ReturnType<typeof scoreJobFit>): Omit<Prisma.JobFitSnapshotUncheckedCreateInput, "vacancyId"> {
  return {
    candidateId,
    profile: fit.profile,
    overallMatch: fit.overallMatch,
    profileMatch: fit.profileMatch,
    missing: fit.missingRequirements,
    evidence: fit.strongEvidence,
    gaps: fit.gaps,
    advantages: fit.advantages,
    recommendation: fit.recommendation,
    analysis: {
      profile: fit.profile,
      requiredMatches: fit.requirementMatches,
      requiredGaps: fit.missingRequirements,
      preferredMatches: fit.preferredMatches,
      preferredGaps: fit.preferredGaps,
      evidence: fit.evidence,
      blockers: fit.blockers,
      missingInformation: fit.missingInformation,
      transferable: fit.transferable,
      skills: fit.recommendedSkills,
      structure: fit.cvStructure,
    },
    selectedProjectIds: fit.selectedProjects.map((project) => project.id),
    selectedFactIds: fit.selectedFacts.map((fact) => fact.id),
  };
}

async function storeDocument(input: {
  organizationId: string;
  candidateId: string;
  vacancyId: string;
  profile: CareerProfileKind;
  kind: "CV" | "COVER_LETTER";
  text: string;
  bytes: Buffer;
  fileType: string;
  headline: string;
  companyName: string;
  fullName: string;
  extension: "pdf" | "docx";
}) {
  const fileName = documentFileName({ fullName: input.fullName, headline: input.headline, companyName: input.companyName, extension: input.extension });
  if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) throw new AppError("Unsafe document name.");
  const version = await prisma.generatedDocument.count({ where: { vacancyId: input.vacancyId, kind: input.kind, fileType: input.fileType } });
  const saved = await prisma.generatedDocument.create({
    data: {
      organizationId: input.organizationId,
      candidateId: input.candidateId,
      vacancyId: input.vacancyId,
      profile: input.profile,
      kind: input.kind,
      version: version + 1,
      fileName,
      fileType: input.fileType,
      checksum: checksum(input.bytes),
      text: input.text,
      content: new Uint8Array(input.bytes),
    },
  });
  return saved.id;
}

async function maybeRewrite(text: string, candidate: CandidateRecord) {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) return text;
  try {
    const result = await completeJson([
      { role: "system", content: CV_SYSTEM_PROMPT },
      { role: "user", content: evidencePrompt(candidate.facts.filter((fact) => fact.verified).map((fact) => fact.fact), text) },
    ]);
    const parsed = JSON.parse(result.content) as { text?: unknown };
    if (typeof parsed.text !== "string" || !parsed.text.includes(candidate.fullName)) return text;
    const hash = createHash("sha256").update(parsed.text).digest("hex").slice(0, 12);
    logInfo("application.cv_rewrite", { checksum: hash, durationMs: result.durationMs });
    return parsed.text;
  } catch {
    return text;
  }
}
