"use server";

import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { AppError, errorMessage } from "@/lib/errors";
import { queueJob } from "@/lib/jobs";
import { jobDiscoveryEnabled } from "@/lib/applications/config";
import { ensureCandidate } from "@/lib/applications/service";
import { optionalCandidateFacts } from "@/lib/applications/candidate-fields";
import { validateCandidateProfile } from "@/lib/applications/profile-validation";
import { canTransition } from "@/lib/applications/state";
import { evaluateSubmissionGate } from "@/lib/applications/submission-gate";
import { preparationDecision, safeAuditDetail } from "@/lib/applications/package-version";
import { checksum } from "@/lib/applications/documents";
import type { ApplicationStatus } from "@/lib/applications/types";

export async function saveCandidateProfile(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const candidate = await ensureCandidate(organization.id);
  const fullName = String(formData.get("fullName") ?? "").trim();
  if (!fullName) redirect("/jobs/candidate?error=Enter+a+real+name+and+email.");
  const parsed = validateCandidateProfile(formData);
  if (parsed.error || !parsed.draft) redirect(`/jobs/candidate?error=${encodeURIComponent(parsed.error ?? "Check the profile fields.")}`);
  const draft = parsed.draft;
  const optional = optionalCandidateFacts(formData);
  if (optional.error) redirect(`/jobs/candidate?error=${encodeURIComponent(optional.error)}`);
  const [firstName, ...rest] = fullName.split(/\s+/);
  await prisma.candidate.update({
    where: { id: candidate.id },
    data: {
      fullName,
      firstName,
      lastName: rest.join(" ") || firstName,
      email: draft.email,
      location: draft.location,
      phone: draft.phone,
      headline: draft.headline,
      linkedinUrl: draft.linkedinUrl,
      portfolioUrl: draft.portfolioUrl,
      githubUrl: draft.githubUrl,
      yearsExperience: draft.yearsExperience,
      currentRole: draft.currentRole,
      targetRoles: draft.targetRoles,
      workAuthorization: draft.workAuthorization,
      sponsorship: draft.sponsorship,
      availability: draft.availability,
      noticePeriod: draft.noticePeriod,
      employmentPreference: draft.employmentPreference,
      remotePreference: draft.remotePreference,
      relocationPreference: draft.relocationPreference,
    },
  });
  await prisma.candidatePreference.upsert({
    where: { candidateId: candidate.id },
    update: { salaryMin: draft.salaryMin, salaryTarget: draft.salaryTarget, salaryCurrency: draft.salaryCurrency, salaryPeriod: draft.salaryPeriod },
    create: { candidateId: candidate.id, salaryMin: draft.salaryMin, salaryTarget: draft.salaryTarget, salaryCurrency: draft.salaryCurrency, salaryPeriod: draft.salaryPeriod },
  });
  for (const fact of optional.facts) {
    await prisma.candidateFact.deleteMany({
      where: { candidateId: candidate.id, source: "candidate-settings", subcategory: fact.subcategory },
    });
    if (!fact.fact) continue;
    await prisma.candidateFact.create({
      data: {
        candidateId: candidate.id,
        category: fact.category,
        subcategory: fact.subcategory,
        fact: fact.fact,
        source: "candidate-settings",
        sourceType: "CANDIDATE_ENTERED",
        verified: true,
        verification: "VERIFIED",
        confidence: 100,
      },
    });
  }
  await replaceEnteredFact(candidate.id, "IDENTITY", "salary-expectation", draft.salaryCurrency ? `Salary expectation: ${[draft.salaryMin, draft.salaryTarget].filter((item) => item != null).join("-")} ${draft.salaryCurrency} per ${draft.salaryPeriod}` : "");
  await replaceEnteredFact(candidate.id, "IDENTITY", "availability", draft.availability ? `Availability: ${draft.availability}` : "");
  await replaceEnteredFact(candidate.id, "IDENTITY", "sponsorship", draft.sponsorship ? `Sponsorship: ${draft.sponsorship}` : "");
  await replaceEnteredFact(candidate.id, "LINK", "github", draft.githubUrl ? `GitHub: ${draft.githubUrl}` : "");
  await replaceEnteredFact(candidate.id, "LINK", "portfolio", draft.portfolioUrl ? `Portfolio: ${draft.portfolioUrl}` : "");
  const website = String(formData.get("website") ?? "").trim();
  if (website && !/^https:\/\/[^\s]+$/i.test(website)) redirect("/jobs/candidate?error=Website+must+be+an+https+URL,+or+stay+blank.");
  await replaceEnteredFact(candidate.id, "LINK", "website", website ? `Website: ${website}` : "");
  await replaceEnteredFact(candidate.id, "IDENTITY", "preferred-name", textFact(formData, "preferredName", "Preferred name"));
  await replaceEnteredFact(candidate.id, "IDENTITY", "summary", textFact(formData, "summary", "Summary"));
  await replaceEnteredFact(candidate.id, "IDENTITY", "negotiability", textFact(formData, "negotiability", "Salary negotiability"));
  await replaceEnteredFact(candidate.id, "SKILL", "proficiency", textFact(formData, "skillProficiency", "Skill proficiency"));
  await replaceEnteredFact(candidate.id, "IDENTITY", "employment-status", textFact(formData, "employmentStatus", "Employment status"));
  await replaceEnteredFact(candidate.id, "IDENTITY", "start-date", textFact(formData, "startDate", "Start date"));
  if (draft.yearsExperience != null) await replaceEnteredFact(candidate.id, "EXPERIENCE", "years", `Years of experience: ${draft.yearsExperience}`);
  else await replaceEnteredFact(candidate.id, "EXPERIENCE", "years", "");
  await prisma.candidateEducation.deleteMany({ where: { candidateId: candidate.id, source: "candidate-settings" } });
  if (draft.institution) {
    await prisma.candidateEducation.create({
      data: {
        candidateId: candidate.id,
        institution: draft.institution,
        degree: draft.degree,
        field: draft.field,
        startDate: draft.educationStart ? new Date(draft.educationStart) : null,
        endDate: draft.educationEnd ? new Date(draft.educationEnd) : null,
        source: "candidate-settings",
      },
    });
    const education = ["Education", draft.institution, draft.degree, draft.field].filter(Boolean).join(", ");
    await replaceEnteredFact(candidate.id, "EDUCATION", "education", education);
  }
  await prisma.candidateCertification.deleteMany({ where: { candidateId: candidate.id, source: "candidate-settings" } });
  if (draft.certification) {
    await prisma.candidateCertification.create({
      data: {
        candidateId: candidate.id,
        name: draft.certification,
        issuer: draft.issuer,
        issuedAt: draft.certificationDate ? new Date(draft.certificationDate) : null,
        credentialUrl: draft.credentialUrl,
        source: "candidate-settings",
      },
    });
    await replaceEnteredFact(candidate.id, "CERTIFICATION", "certifications", ["Certifications", draft.certification, draft.issuer].filter(Boolean).join(": "));
  }
  redirect("/jobs/candidate?notice=Candidate+profile+saved.");
}

function textFact(formData: FormData, field: string, label: string) {
  const value = String(formData.get(field) ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  return value ? `${label}: ${value}` : "";
}

async function replaceEnteredFact(candidateId: string, category: "LINK" | "EXPERIENCE" | "EDUCATION" | "CERTIFICATION" | "IDENTITY" | "SKILL", subcategory: string, fact: string) {
  await prisma.candidateFact.deleteMany({ where: { candidateId, source: "candidate-settings", subcategory } });
  if (!fact) return;
  await prisma.candidateFact.create({
    data: { candidateId, category, subcategory, fact, source: "candidate-settings", sourceType: "CANDIDATE_ENTERED", verified: true, verification: "VERIFIED", confidence: 100 },
  });
}

export async function addCandidateFact(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const candidate = await ensureCandidate(organization.id);
  const fact = String(formData.get("fact") ?? "").trim();
  const source = String(formData.get("source") ?? "").trim();
  const category = String(formData.get("category") ?? "EXPERIENCE");
  if (fact.length < 8 || source.length < 3) redirect("/jobs/candidate?error=A+fact+needs+text+and+a+source.");
  const allowed = ["IDENTITY", "EXPERIENCE", "ACHIEVEMENT", "SKILL", "TECHNOLOGY", "CERTIFICATION", "EDUCATION", "METRIC", "PROJECT", "LINK"];
  if (!allowed.includes(category)) redirect("/jobs/candidate?error=Unknown+fact+category.");
  try {
    await prisma.candidateFact.create({
      data: {
        candidateId: candidate.id,
        category: category as "EXPERIENCE",
        fact,
        source,
        verified: formData.get("verified") === "on",
        verification: formData.get("verified") === "on" ? "VERIFIED" : "UNVERIFIED",
        confidence: formData.get("verified") === "on" ? 70 : 20,
      },
    });
  } catch {
    redirect("/jobs/candidate?error=That+fact+already+exists.");
  }
  redirect("/jobs/candidate?notice=Fact+saved.");
}

export async function saveApplicationSettings(formData: FormData) {
  const { organization } = await requireOrganization("ADMIN");
  const candidate = await ensureCandidate(organization.id);
  const mode = String(formData.get("mode") ?? "AUTO_PREPARE");
  const dailyTarget = Math.min(500, Math.max(1, Number(formData.get("dailyTarget") ?? 500) || 500));
  if (mode !== "MANUAL" && mode !== "AUTO_PREPARE" && mode !== "AUTO_SUBMIT") {
    redirect("/jobs/settings?error=Unknown+application+mode.");
  }
  await prisma.candidatePreference.upsert({
    where: { candidateId: candidate.id },
    update: { mode, dailyTarget, discoverJobs: formData.get("discoverJobs") === "on" },
    create: { candidateId: candidate.id, mode, dailyTarget, discoverJobs: formData.get("discoverJobs") === "on" },
  });
  redirect("/jobs/settings?notice=Application+settings+saved.");
}

export async function enqueueJobSearch(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  if (!jobDiscoveryEnabled()) redirect("/jobs/discover?error=Job+discovery+is+disabled.");
  const query = String(formData.get("query") ?? "").trim().slice(0, 180);
  if (query.length < 3) redirect("/jobs/discover?error=Enter+a+search.");
  const active = await prisma.backgroundJob.findMany({
    where: { organizationId: organization.id, queue: "job-discovery", state: { in: ["QUEUED", "ACTIVE"] } },
    select: { payload: true },
    take: 20,
  });
  if (active.some((job) => discoveryQuery(job.payload) === query.toLowerCase())) {
    redirect("/jobs/discover?notice=That+search+is+already+running.");
  }
  try {
    await queueJob({
      organizationId: organization.id,
      queue: "job-discovery",
      name: "search",
      payload: { organizationId: organization.id, query },
    });
  } catch (error) {
    redirect(`/jobs/discover?error=${encodeURIComponent(errorMessage(error))}`);
  }
  redirect("/jobs/discover?notice=Job+search+queued.");
}

function discoveryQuery(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const query = (payload as { query?: unknown }).query;
  return typeof query === "string" ? query.trim().toLowerCase() : "";
}

export async function enqueueApplicationPreparation(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const vacancyId = String(formData.get("vacancyId") ?? "");
  const vacancy = await prisma.jobVacancy.findFirst({ where: { id: vacancyId, organizationId: organization.id }, select: { id: true } });
  if (!vacancy) redirect("/jobs?error=Vacancy+not+found.");
  const candidate = await ensureCandidate(organization.id);
  const existing = await prisma.jobApplication.findFirst({ where: { organizationId: organization.id, vacancyId, candidateId: candidate.id }, select: { id: true } });
  if (preparationDecision(Boolean(existing), formData.get("reprepare") === "on") === "REUSE" && existing) {
    redirect(`/jobs/applications/${existing.id}?notice=An+application+already+exists.+Regenerate+creates+the+next+version.`);
  }
  try {
    await queueJob({
      organizationId: organization.id,
      queue: "application-preparation",
      name: "prepare",
      payload: { organizationId: organization.id, vacancyId },
    });
  } catch (error) {
    redirect(`/jobs?error=${encodeURIComponent(errorMessage(error))}`);
  }
  redirect("/jobs/applications?notice=Application+preparation+queued.");
}

export async function decideApplication(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (decision !== "APPROVED" && decision !== "REJECTED") redirect("/jobs/applications?error=Unknown+decision.");
  const application = await prisma.jobApplication.findFirst({ where: { id, organizationId: organization.id } });
  if (!application) redirect("/jobs/applications?error=Application+not+found.");
  if (!canTransition(application.status as ApplicationStatus, decision)) {
    redirect(`/jobs/applications/${id}?error=That+status+change+is+not+allowed.`);
  }
  await prisma.jobApplication.update({ where: { id: application.id }, data: { status: decision } });
  await prisma.applicationEvent.create({
    data: { applicationId: application.id, type: decision === "APPROVED" ? "APPROVED" : "REJECTED", detail: safeAuditDetail(decision === "APPROVED" ? "Approved for review. Not submitted." : "Rejected before submission.") },
  });
  redirect(`/jobs/applications/${id}?notice=Status+saved.+Nothing+was+submitted.`);
}

export async function recordSubmissionConfirmation(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const id = String(formData.get("id") ?? "");
  const phrase = String(formData.get("phrase") ?? "");
  const application = await prisma.jobApplication.findFirst({
    where: { id, organizationId: organization.id },
    include: { vacancy: true, answers: true, candidate: true },
  });
  if (!application) redirect("/jobs/applications?error=Application+not+found.");
  const reviewRequired = application.answers.filter((answer) => answer.status !== "ANSWERED").map((answer) => answer.question);
  const cv = application.cvId
    ? await prisma.generatedDocument.findFirst({ where: { id: application.cvId, organizationId: organization.id }, select: { fileName: true } })
    : null;
  const letter = application.coverLetterId
    ? await prisma.generatedDocument.findFirst({ where: { id: application.coverLetterId, organizationId: organization.id }, select: { fileName: true } })
    : null;
  const gate = evaluateSubmissionGate({
    phrase,
    company: application.vacancy.companyName,
    role: application.vacancy.title,
    applicationUrl: application.applicationUrl,
    cvFileName: cv?.fileName ?? "",
    coverLetterFileName: letter?.fileName ?? "",
    answers: application.answers.map((answer) => ({ question: answer.question, answer: answer.answer, status: answer.status })),
    workAuthorization: application.candidate.workAuthorization,
    sponsorship: application.candidate.sponsorship,
    salary: null,
    reviewRequired,
    security: null,
  }, {
    company: application.vacancy.companyName,
    role: application.vacancy.title,
    applicationUrl: application.applicationUrl,
    cvFileName: cv?.fileName ?? "",
  });
  if (phrase !== "CONFIRM SUBMISSION" || gate.status === "REQUIRES_MANUAL_ACTION") {
    redirect(`/jobs/applications/${id}?error=${encodeURIComponent(gate.reason)}`);
  }
  if (application.status !== "APPROVED" && application.status !== "READY_FOR_SUBMISSION") {
    redirect(`/jobs/applications/${id}?error=Approve+the+package+before+confirming+submission.`);
  }
  if (application.status === "APPROVED" && canTransition(application.status, "READY_FOR_SUBMISSION")) {
    await prisma.jobApplication.update({ where: { id: application.id }, data: { status: "READY_FOR_SUBMISSION", blockedReason: gate.reason } });
  }
  await prisma.applicationEvent.create({
    data: { applicationId: application.id, type: "MANUAL_ACTION_REQUIRED", detail: "Confirmation recorded. Nothing was submitted." },
  });
  redirect(`/jobs/applications/${id}?notice=Confirmation+recorded.+Nothing+was+submitted.`);
}

export async function saveCandidateDocument(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const candidate = await ensureCandidate(organization.id);
  const kind = String(formData.get("kind") ?? "");
  if (kind !== "BASE_CV" && kind !== "PORTFOLIO" && kind !== "CERTIFICATE" && kind !== "OTHER") {
    redirect("/jobs/candidate?error=Choose+a+document+type.");
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect("/jobs/candidate?error=Choose+a+file.");
  if (file.size > 2_000_000) redirect("/jobs/candidate?error=Documents+are+limited+to+2+MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const fileName = file.name.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80) || "document";
  await prisma.candidateDocument.create({
    data: {
      organizationId: organization.id,
      candidateId: candidate.id,
      kind,
      fileName,
      fileType: file.type || "application/octet-stream",
      checksum: checksum(bytes),
      content: new Uint8Array(bytes),
    },
  });
  redirect("/jobs/candidate?notice=Document+saved.+It+is+visible+only+inside+this+organization.");
}

export async function archiveGeneratedDocument(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const id = String(formData.get("id") ?? "");
  const updated = await prisma.generatedDocument.updateMany({
    where: { id, organizationId: organization.id },
    data: { archived: true },
  });
  if (updated.count !== 1) throw new AppError("Document not found.");
  redirect("/jobs/cv-library?notice=Document+archived.");
}
