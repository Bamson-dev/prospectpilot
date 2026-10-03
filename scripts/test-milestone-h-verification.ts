import { prisma } from "../lib/db";
import { decideApplication, recordSubmissionConfirmation, withdrawApplication, requestRegeneration } from "../actions/job-applications";

async function run() {
  console.log("Setting up mock record...");
  const org = await prisma.organization.findFirst();
  if (!org) throw new Error("No org");
  
  const vacancy = await prisma.jobVacancy.create({
    data: {
      organizationId: org.id,
      title: "Test Vacancy H",
      companyName: "Test Co",
      applicationUrl: "https://example.com/apply",
      source: "TEST",
      sourceUrl: "https://example.com/apply",
      description: "Test description",
      normalizedTitle: "test vacancy h",
      normalizedLocation: "remote",
      status: "DISCOVERED",
    }
  });

  const candidate = await prisma.candidate.create({
    data: {
      organizationId: org.id,
      fullName: "Test Candidate",
      firstName: "Test",
      lastName: "Candidate",
      email: "test@example.com",
    }
  });

  const app = await prisma.jobApplication.create({
    data: {
      organizationId: org.id,
      vacancyId: vacancy.id,
      candidateId: candidate.id,
      status: "READY_FOR_REVIEW",
      profile: "SOFTWARE",
      source: "TEST",
      applicationUrl: "https://example.com/apply",
    }
  });

  const packageObj = await prisma.applicationPackage.create({
    data: {
      applicationId: app.id,
      version: 1,
      profile: "SOFTWARE",
      fitSummary: "Test summary",
      strategy: "Test strategy",
    }
  });

  console.log("Running manual review actions directly on the DB...");
  
  // 1. Approve
  await prisma.jobApplication.update({ where: { id: app.id }, data: { status: "APPROVED" } });
  
  // 2. Mark as submitted
  const fd = new FormData();
  fd.append("id", app.id);
  fd.append("phrase", "CONFIRM SUBMISSION");
  
  // Since server actions redirect, we mock the transition directly or catch the redirect
  let redirected = false;
  try {
    await recordSubmissionConfirmation(fd as any);
  } catch (e: any) {
    if (e.message === "NEXT_REDIRECT") redirected = true;
  }
  
  const updatedApp = await prisma.jobApplication.findUnique({ where: { id: app.id } });
  if (updatedApp?.status !== "SUBMITTED") {
    throw new Error("Failed to mark as submitted.");
  }
  console.log("Successfully marked as SUBMITTED.");

  // Cleanup
  console.log("Cleaning up...");
  await prisma.jobVacancy.delete({ where: { id: vacancy.id } });
  await prisma.candidate.delete({ where: { id: candidate.id } });

  console.log("Verification complete.");
}

// We just do DB updates to simulate it since calling Server Actions outside Next context without `requireOrganization` mock is tricky.
run().catch(e => {
  console.error(e);
  process.exit(1);
});
