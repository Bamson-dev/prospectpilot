import { PrismaClient } from "@prisma/client";
import { processJobDiscoveryScheduler, processJobDiscovery, processApplicationPreparation } from "../worker/processors/job-applications";

process.env.JOB_DISCOVERY_ENABLED = "true";
process.env.CV_GENERATION_ENABLED = "true";
process.env.COVER_LETTER_GENERATION_ENABLED = "true";
process.env.APPLICATION_AUTOMATION_ENABLED = "false"; // No live submission

const prisma = new PrismaClient();

async function main() {
  console.log("=== MILESTONE G: PRODUCTION VERIFICATION ===");
  await prisma.$connect();

  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({ data: { name: "Test Org", slug: "test-org-prod" } });
  }

  let candidate = await prisma.candidate.findFirst({ where: { organizationId: org.id } });
  if (!candidate) {
    candidate = await prisma.candidate.create({
      data: {
        organizationId: org.id,
        fullName: "Test Candidate",
        firstName: "Test",
        lastName: "Candidate",
        email: "test@example.com",
        headline: "Software Engineer",
      }
    });
  }
  
  await prisma.candidatePreference.upsert({
    where: { candidateId: candidate.id },
    update: { discoverJobs: true, dailyTarget: 10 },
    create: { candidateId: candidate.id, discoverJobs: true, dailyTarget: 10, mode: "AUTO_PREPARE" }
  });

  const profiles = await prisma.candidateCareerProfile.findMany({ where: { candidateId: candidate.id } });
  if (profiles.length === 0) {
    await prisma.candidateCareerProfile.create({
      data: { candidateId: candidate.id, kind: "SOFTWARE", title: "Software Engineer", summary: "Test profile" }
    });
  }

  console.log("\n--- 1. PRODUCTION SCHEDULER ---");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  await prisma.jobDiscoveryRun.deleteMany({
    where: { organizationId: org.id, startedAt: { gte: today } }
  });
  await processJobDiscoveryScheduler();
  const runs = await prisma.jobDiscoveryRun.findMany({
    where: { organizationId: org.id, startedAt: { gte: today } },
    orderBy: { startedAt: 'desc' }
  });
  console.log(`Runs created for candidate ${candidate.id}: ${runs.length}`);
  if (runs.length !== 1) {
    console.error("FAILED: Should create exactly one run per eligible candidate.");
  } else {
    console.log(`Run ID: ${runs[0].id}`);
    console.log(`Status: ${runs[0].status}`);
  }

  console.log("\n--- 2. PRODUCTION DISCOVERY ---");
  const run = runs[0];
  const beforeCount = await prisma.jobVacancy.count({ where: { organizationId: org.id } });
  await processJobDiscovery(org.id, run.id);
  const updatedRun = await prisma.jobDiscoveryRun.findUnique({ where: { id: run.id } });
  console.log(`Run completed! ID: ${updatedRun?.id}`);
  console.log(`Raw results: ${updatedRun?.rawResults}`);
  console.log(`Valid vacancies: ${updatedRun?.validVacancies}`);
  console.log(`New vacancies: ${updatedRun?.newVacancies}`);
  console.log(`Duplicates: ${updatedRun?.duplicates}`);
  const afterCount = await prisma.jobVacancy.count({ where: { organizationId: org.id } });
  console.log(`DB Count increased by: ${afterCount - beforeCount}`);
  
  // Verify lastCheckedAt
  const newlyAdded = await prisma.jobVacancy.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: 'desc' } });
  console.log(`Newest vacancy lastCheckedAt: ${newlyAdded?.lastCheckedAt}`);
  
  console.log("\n--- 5. REAL QUALIFICATION CHAIN ---");
  if (newlyAdded) {
    console.log(`Running analyzeVacancy for ${newlyAdded.id}...`);
    const { analyzeVacancy } = require("../lib/applications/service");
    await analyzeVacancy(org.id, newlyAdded.id);
  }
  
  const fitSnapshot = await prisma.jobFitSnapshot.findFirst({
    where: { vacancyId: newlyAdded?.id }
  });
  console.log(`Vacancy ID: ${newlyAdded?.id}`);
  console.log(`Normalization: ${newlyAdded?.normalizedTitle} at ${newlyAdded?.normalizedCompany} in ${newlyAdded?.normalizedLocation}`);
  console.log(`Qualification Decision: ${fitSnapshot?.recommendation}`);
  console.log(`Evidence/Explanation: ${JSON.stringify(fitSnapshot?.analysis)?.slice(0, 100)}...`);

  console.log("\n--- 6. APPLICATION IDEMPOTENCY ---");
  if (newlyAdded) {
    console.log("Triggering preparation 1...");
    // Force APPLY status so it can be prepared if we want, wait, processApplicationPreparation doesn't check status, it just prepares.
    await processApplicationPreparation(org.id, newlyAdded.id);
    const app1 = await prisma.jobApplication.findUnique({
      where: { organizationId_vacancyId_candidateId: { organizationId: org.id, vacancyId: newlyAdded.id, candidateId: candidate.id } }
    });
    console.log(`App 1 CV ID: ${app1?.cvId}`);
    
    console.log("Triggering preparation 2...");
    await processApplicationPreparation(org.id, newlyAdded.id);
    const app2 = await prisma.jobApplication.findUnique({
      where: { organizationId_vacancyId_candidateId: { organizationId: org.id, vacancyId: newlyAdded.id, candidateId: candidate.id } }
    });
    console.log(`App 2 CV ID: ${app2?.cvId}`);
    if (app1?.cvId === app2?.cvId) {
      console.log("Idempotency VERIFIED: CV was reused.");
    } else {
      console.log("Idempotency FAILED: CV was regenerated.");
    }
  }

  console.log("\n--- 7. PREPARATION ---");
  const app = await prisma.jobApplication.findFirst({
    where: { organizationId: org.id, vacancyId: newlyAdded?.id, candidateId: candidate.id },
    include: { package: true }
  });
  console.log(`Status: ${app?.status}`);
  console.log(`Profile selected: ${app?.profile}`);
  console.log(`CV generated: ${!!app?.cvId}`);
  console.log(`Cover Letter generated: ${!!app?.coverLetterId}`);
  
  console.log("\n--- 8. BLOCKER HANDLING ---");
  console.log("Blocked Reason:", app?.blockedReason || "None");
  
  console.log("\nDONE.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
