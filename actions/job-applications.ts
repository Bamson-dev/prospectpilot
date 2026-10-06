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
import { blockerFromTimings, manualReviewRecord, packageApproval } from "@/lib/applications/manual-review";
import { evaluateSubmissionGate } from "@/lib/applications/submission-gate";
import { MANUAL_QUEUE_REASON, discoveryLimit, queueAdmission, selectBulkPrepare, storedFitDecision } from "@/lib/applications/application-queue";
import { sourceValidity } from "@/lib/applications/source-validity";
import { preparationDecision } from "@/lib/applications/package-version";
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
  await replaceEnteredFact(candidate.id, "IDENTITY", "salary-expectation", textFact(formData, "salaryExpectation", "Salary expectation"));
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
  const candidate = await ensureCandidate(organization.id);
  const active = await prisma.backgroundJob.findMany({
    where: { organizationId: organization.id, queue: "job-discovery", state: { in: ["QUEUED", "ACTIVE"] } },
    select: { payload: true },
    take: 20,
  });
  if (active.some((job) => discoveryQuery(job.payload) === query.toLowerCase())) {
    redirect("/jobs/discover?notice=That+search+is+already+running.");
  }
  const limit = discoveryLimit(String(formData.get("limit") ?? "15"));
  try {
    const run = await prisma.jobDiscoveryRun.create({
      data: {
        organizationId: organization.id,
        candidateId: candidate.id,
        status: "STARTED",
      },
    });
    await queueJob({
      organizationId: organization.id,
      queue: "job-discovery",
      name: "search",
      payload: { organizationId: organization.id, runId: run.id, query, limit: String(limit) },
    });
  } catch (error) {
    redirect(`/jobs/discover?error=${encodeURIComponent(errorMessage(error))}`);
  }
  redirect("/jobs/discover?notice=Job+search+queued.");
}

function payloadVacancy(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const vacancyId = (payload as { vacancyId?: unknown }).vacancyId;
  return typeof vacancyId === "string" ? vacancyId : "";
}

function discoveryQuery(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const query = (payload as { query?: unknown }).query;
  return typeof query === "string" ? query.trim().toLowerCase() : "";
}

export async function enqueueApplicationPreparation(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const vacancyId = String(formData.get("vacancyId") ?? "");
  const vacancy = await prisma.jobVacancy.findFirst({
    where: { id: vacancyId, organizationId: organization.id },
    select: { id: true, title: true, applicationUrl: true, source: true, status: true },
  });
  if (!vacancy) redirect("/jobs?error=Vacancy+not+found.");
  if (vacancy.status === "ARCHIVED" || sourceValidity({ title: vacancy.title, url: vacancy.applicationUrl, source: vacancy.source }) === "INVALID_SOURCE") {
    redirect("/jobs?error=That+page+is+not+a+vacancy.");
  }
  const candidate = await ensureCandidate(organization.id);
  const existing = await prisma.jobApplication.findFirst({ where: { organizationId: organization.id, vacancyId, candidateId: candidate.id }, select: { id: true } });
  if (preparationDecision(Boolean(existing), formData.get("reprepare") === "on") === "REUSE" && existing) {
    redirect(`/jobs/applications/${existing.id}?notice=An+application+already+exists.+Regenerate+creates+the+next+version.`);
  }
  try {
    await queueJob({
      id: `application-preparation:${organization.id}:${vacancyId}:${Date.now()}`,
      organizationId: organization.id,
      queue: "application-preparation",
      name: "prepare",
      payload: { organizationId: organization.id, vacancyId, forceRegenerate: String(formData.get("reprepare") === "on") },
    });
  } catch (error) {
    redirect(`/jobs?error=${encodeURIComponent(errorMessage(error))}`);
  }
  redirect("/jobs/applications?notice=Application+preparation+queued.");
}

export async function addReviewToQueue(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const vacancyId = String(formData.get("vacancyId") ?? "");
  const vacancy = await prisma.jobVacancy.findFirst({
    where: { id: vacancyId, organizationId: organization.id },
    include: { fit: true },
  });
  if (!vacancy) redirect("/jobs/applications/queue?error=Vacancy+not+found.");
  const decision = storedFitDecision(vacancy.fit?.analysis);
  if (sourceValidity({ title: vacancy.title, url: vacancy.applicationUrl, source: vacancy.source }) === "INVALID_SOURCE") {
    redirect("/jobs/applications/queue?error=That+page+is+not+a+vacancy.");
  }
  if (decision === "NOT_A_FIT") redirect("/jobs/applications/queue?error=A+not-a-fit+vacancy+cannot+enter+the+queue.");
  if (decision === "APPLY") redirect("/jobs/applications/queue?notice=Apply+vacancies+are+already+in+the+queue.");
  const candidate = await ensureCandidate(organization.id);
  const existing = await prisma.jobApplication.findFirst({
    where: { organizationId: organization.id, vacancyId, candidateId: candidate.id },
    select: { id: true },
  });
  if (existing) redirect("/jobs/applications/queue?notice=That+vacancy+is+already+queued.");
  await prisma.jobApplication.create({
    data: {
      organizationId: organization.id,
      candidateId: candidate.id,
      vacancyId,
      profile: vacancy.fit?.profile ?? "SOFTWARE",
      status: "FIT_EVALUATED",
      source: vacancy.source,
      applicationUrl: vacancy.applicationUrl,
      blockedReason: MANUAL_QUEUE_REASON,
    },
  });
  redirect("/jobs/applications/queue?notice=Review+vacancy+added.+Nothing+was+submitted.");
}

export async function enqueueApplicationBatch(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const candidate = await ensureCandidate(organization.id);
  const requested = formData.getAll("vacancyId").map((value) => String(value));
  const vacancies = await prisma.jobVacancy.findMany({
    where: { organizationId: organization.id, id: { in: requested } },
    include: { fit: true, applications: { where: { candidateId: candidate.id }, select: { id: true, blockedReason: true, package: { select: { id: true } } } } },
  });
  const eligible = new Set(vacancies.flatMap((vacancy) => {
    const decision = storedFitDecision(vacancy.fit?.analysis);
    const manuallyQueued = vacancy.applications.some((application) => application.blockedReason === MANUAL_QUEUE_REASON);
    if (sourceValidity({ title: vacancy.title, url: vacancy.applicationUrl, source: vacancy.source }) === "INVALID_SOURCE") return [];
    return queueAdmission({ decision, manuallyQueued }) === "excluded" ? [] : [vacancy.id];
  }));
  const selected = selectBulkPrepare(requested, eligible);
  if (!selected.ok) redirect(`/jobs/applications/queue?error=${encodeURIComponent(selected.reason)}`);
  const running = await prisma.backgroundJob.findMany({
    where: { organizationId: organization.id, queue: "application-preparation", state: { in: ["QUEUED", "ACTIVE"] } },
    select: { payload: true },
    take: 30,
  });
  const runningVacancies = new Set(running.map((job) => payloadVacancy(job.payload)));
  let queued = 0;
  let reused = 0;
  for (const vacancyId of selected.ids) {
    const existing = vacancies.find((vacancy) => vacancy.id === vacancyId)?.applications[0];
    if (runningVacancies.has(vacancyId) || (existing?.package && preparationDecision(true, false) === "REUSE")) {
      reused += 1;
      continue;
    }
    await queueJob({
      id: `application-preparation:${organization.id}:${vacancyId}`,
      organizationId: organization.id,
      queue: "application-preparation",
      name: "prepare",
      payload: { organizationId: organization.id, vacancyId },
    });
    queued += 1;
  }
  redirect(`/jobs/applications/queue?notice=${encodeURIComponent(`${queued} queued. ${reused} already had an application. Nothing was submitted.`)}`);
}

export async function decideApplication(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (decision !== "APPROVED" && decision !== "REJECTED") redirect("/jobs/applications?error=Unknown+decision.");
  const application = await prisma.jobApplication.findFirst({
    where: { id, organizationId: organization.id },
    include: { package: true },
  });
  if (!application) redirect("/jobs/applications?error=Application+not+found.");
  if (application.submittedAt || application.status === "SUBMITTED" || application.status === "SUBMITTING") {
    redirect(`/jobs/applications/${id}?error=A+submission+cannot+be+created+from+package+review.`);
  }
  const result = packageApproval({
    status: application.status,
    decision,
    reason: String(formData.get("reason") ?? ""),
    packageVersion: application.package?.version ?? 1,
    blocker: blockerFromTimings(application.package?.timings),
  });
  if ("error" in result && result.error) redirect(`/jobs/applications/${id}?error=${encodeURIComponent(result.error)}`);
  
  const targetStatus = result.status === "APPROVED" ? "READY_FOR_SUBMISSION" : result.status;
  
  if (result.requiresTransition && !canTransition(application.status as ApplicationStatus, targetStatus as ApplicationStatus)) {
    redirect(`/jobs/applications/${id}?error=That+status+change+is+not+allowed.`);
  }
  if (targetStatus !== application.status) {
    await prisma.jobApplication.update({ where: { id: application.id }, data: { status: targetStatus as ApplicationStatus, submittedAt: null } });
  }
  await prisma.applicationEvent.create({
    data: { applicationId: application.id, type: result.event, detail: result.detail },
  });
  redirect(`/jobs/applications/${id}?notice=Package+decision+saved.+Nothing+was+submitted.`);
}

export async function batchDecideApplications(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const decision = String(formData.get("decision") ?? "");
  if (decision !== "APPROVED" && decision !== "REJECTED") redirect("/jobs/applications?error=Unknown+decision.");
  const ids = formData.getAll("id").map(String).filter(Boolean);
  if (ids.length === 0) redirect("/jobs/applications?error=No+applications+selected.");
  
  const applications = await prisma.jobApplication.findMany({
    where: { id: { in: ids }, organizationId: organization.id },
    include: { package: true },
  });

  let success = 0;
  let failed = 0;

  for (const application of applications) {
    if (application.submittedAt || application.status === "SUBMITTED" || application.status === "SUBMITTING") {
      failed++;
      continue;
    }
    const result = packageApproval({
      status: application.status,
      decision,
      reason: String(formData.get("reason") ?? "Batch decision"),
      packageVersion: application.package?.version ?? 1,
      blocker: blockerFromTimings(application.package?.timings),
    });
    if ("error" in result) {
      failed++;
      continue;
    }
    const targetStatus = result.status === "APPROVED" ? "READY_FOR_SUBMISSION" : result.status;
    if (result.requiresTransition && !canTransition(application.status as ApplicationStatus, targetStatus as ApplicationStatus)) {
      failed++;
      continue;
    }
    if (targetStatus !== application.status) {
      await prisma.jobApplication.update({ where: { id: application.id }, data: { status: targetStatus as ApplicationStatus, submittedAt: null } });
    }
    await prisma.applicationEvent.create({
      data: { applicationId: application.id, type: result.event, detail: result.detail },
    });
    success++;
  }
  
  redirect(`/jobs/applications?notice=Batch+${decision.toLowerCase()}+completed.+Success:+${success},+Failed:+${failed}`);
}

export async function requestRegeneration(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const id = String(formData.get("id") ?? "");
  const application = await prisma.jobApplication.findFirst({
    where: { id, organizationId: organization.id },
  });
  if (!application) redirect("/jobs/applications?error=Application+not+found.");
  
  if (application.status === "SUBMITTED" || application.status === "VERIFIED") {
    redirect(`/jobs/applications/${id}?error=Cannot+regenerate+a+submitted+application.`);
  }

  await prisma.jobApplication.update({
    where: { id: application.id },
    data: { status: "PREPARING" },
  });

  await prisma.applicationEvent.create({
    data: { applicationId: application.id, type: "MANUAL_ACTION_REQUIRED", detail: "Human requested package regeneration." },
  });

  await queueJob({
    id: `application-preparation:${organization.id}:${application.vacancyId}:${Date.now()}`,
    organizationId: organization.id,
    queue: "application-preparation",
    name: "prepare",
    payload: { organizationId: organization.id, vacancyId: application.vacancyId, forceRegenerate: true },
  });

  redirect(`/jobs/applications/${id}?notice=Regeneration+requested.`);
}

export async function recordManualReview(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const id = String(formData.get("id") ?? "");
  const application = await prisma.jobApplication.findFirst({
    where: { id, organizationId: organization.id },
    include: { package: true },
  });
  if (!application) redirect("/jobs/applications?error=Application+not+found.");
  const result = manualReviewRecord({
    marker: String(formData.get("marker") ?? ""),
    status: application.status as ApplicationStatus,
    packageVersion: application.package?.version ?? 1,
    blocker: blockerFromTimings(application.package?.timings),
    reason: String(formData.get("reason") ?? ""),
  });
  if ("error" in result && result.error) redirect(`/jobs/applications/${id}?error=${encodeURIComponent(result.error)}`);
  if (application.submittedAt) {
    await prisma.jobApplication.update({ where: { id: application.id }, data: { submittedAt: null } });
  }
  await prisma.applicationEvent.create({
    data: { applicationId: application.id, type: result.event, detail: result.detail },
  });
  redirect(`/jobs/applications/${id}?notice=Manual+review+recorded.+Nothing+was+submitted.`);
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
  if (application.status !== "APPROVED" && application.status !== "READY_FOR_SUBMISSION" && application.status !== "READY_TO_SUBMIT") {
    redirect(`/jobs/applications/${id}?error=Approve+the+package+before+confirming+submission.`);
  }
  
  await prisma.jobApplication.update({
    where: { id: application.id },
    data: { status: "SUBMITTED", submittedAt: new Date(), blockedReason: null },
  });
  
  await prisma.applicationEvent.create({
    data: { applicationId: application.id, type: "SUBMITTED", detail: "Human marked application as externally submitted." },
  });
  redirect(`/jobs/applications/${id}?notice=Application+marked+as+submitted.`);
}

export async function withdrawApplication(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "");
  
  const application = await prisma.jobApplication.findFirst({
    where: { id, organizationId: organization.id },
    include: { package: true },
  });
  if (!application) redirect("/jobs/applications?error=Application+not+found.");
  
  if (!canTransition(application.status as ApplicationStatus, "WITHDRAWN")) {
    redirect(`/jobs/applications/${id}?error=Cannot+withdraw+from+current+state.`);
  }

  await prisma.jobApplication.update({
    where: { id: application.id },
    data: { status: "WITHDRAWN" },
  });

  await prisma.applicationEvent.create({
    data: { applicationId: application.id, type: "MANUAL_ACTION_REQUIRED", detail: `Application withdrawn. Note: ${note}` },
  });
  
  redirect(`/jobs/applications/${id}?notice=Application+withdrawn.`);
}

export async function addApplicationNote(formData: FormData) {
  const { user, organization } = await requireOrganization("MEMBER");
  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  
  if (!body) redirect(`/jobs/applications/${id}?error=Note+cannot+be+empty.`);

  const application = await prisma.jobApplication.findFirst({
    where: { id, organizationId: organization.id },
  });
  if (!application) redirect("/jobs/applications?error=Application+not+found.");

  await prisma.applicationNote.create({
    data: {
      applicationId: application.id,
      userId: user.id,
      author: user.name,
      body,
    },
  });
  
  redirect(`/jobs/applications/${id}?notice=Note+added.`);
}

export async function scheduleApplicationFollowUp(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const id = String(formData.get("id") ?? "");
  const runAtStr = String(formData.get("runAt") ?? "");
  const channel = String(formData.get("channel") ?? "EMAIL");
  const note = String(formData.get("note") ?? "").trim();
  
  if (!note || !runAtStr) redirect(`/jobs/applications/${id}?error=Date+and+note+are+required.`);

  const application = await prisma.jobApplication.findFirst({
    where: { id, organizationId: organization.id },
  });
  if (!application) redirect("/jobs/applications?error=Application+not+found.");

  const runAt = new Date(runAtStr);
  if (isNaN(runAt.getTime())) redirect(`/jobs/applications/${id}?error=Invalid+date.`);

  await prisma.applicationFollowUp.create({
    data: {
      applicationId: application.id,
      runAt,
      channel,
      status: "DRAFT",
      draft: note,
    },
  });
  
  redirect(`/jobs/applications/${id}?notice=Follow-up+scheduled.`);
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

export async function resumeBlockedApplication(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const id = String(formData.get("id") ?? "");
  
  const application = await prisma.jobApplication.findFirst({
    where: { id, organizationId: organization.id },
    include: { manualAction: true }
  });
  
  if (!application) redirect("/jobs/applications?error=Application+not+found.");
  if (application.status !== "RECOVERABLE_MANUAL_ACTION") {
    redirect(`/jobs/applications/${id}?error=Only+recoverable+applications+can+be+resumed.`);
  }

  // Set the manual action to resolved so the worker knows to run in manualResume mode
  if (application.manualAction) {
    await prisma.applicationManualAction.update({
      where: { id: application.manualAction.id },
      data: { resolved: true }
    });
  }

  // Update status to SUBMITTING and clear the submittedAt flag
  await prisma.jobApplication.update({
    where: { id },
    data: { status: "SUBMITTING", submittedAt: null }
  });

  await prisma.applicationEvent.create({
    data: { applicationId: id, type: "MANUAL_ACTION_REQUIRED", detail: "User initiated Continue & Submit recovery." }
  });

  await queueJob({
    id: `resume-${id}-${Date.now()}`,
    organizationId: organization.id,
    queue: "application-browser",
    name: "run",
    payload: { applicationId: id }
  });

  redirect(`/jobs/applications/${id}?notice=Application+recovery+started.+Check+the+browser+window.`);
}
