"use server";

import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { AppError, errorMessage } from "@/lib/errors";
import { queueJob } from "@/lib/jobs";
import { jobDiscoveryEnabled } from "@/lib/applications/config";
import { ensureCandidate } from "@/lib/applications/service";

export async function saveCandidateProfile(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const candidate = await ensureCandidate(organization.id);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!fullName || !email || !email.includes("@") || email.endsWith("@invalid.test")) {
    redirect("/jobs/candidate?error=Enter+a+real+name+and+email.");
  }
  const [firstName, ...rest] = fullName.split(/\s+/);
  await prisma.candidate.update({
    where: { id: candidate.id },
    data: { fullName, firstName, lastName: rest.join(" ") || firstName, email, location: location || null, phone: phone || null },
  });
  redirect("/jobs/candidate?notice=Candidate+profile+saved.");
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

export async function enqueueApplicationPreparation(formData: FormData) {
  const { organization } = await requireOrganization("MEMBER");
  const vacancyId = String(formData.get("vacancyId") ?? "");
  const vacancy = await prisma.jobVacancy.findFirst({ where: { id: vacancyId, organizationId: organization.id }, select: { id: true } });
  if (!vacancy) redirect("/jobs?error=Vacancy+not+found.");
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
