process.env.JOB_DISCOVERY_ENABLED = "true";
import { PrismaClient } from "@prisma/client";
import { processJobDiscoveryScheduler, processJobDiscovery } from "../worker/processors/job-applications";

const prisma = new PrismaClient();

async function main() {
  console.log("=== MILESTONE G: LOOP VERIFICATION ===");
  await prisma.$connect();

  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({ data: { name: "Test Org", slug: "test-org" } });
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
    // Add a profile if missing
    const profiles = await prisma.candidateCareerProfile.findMany({ where: { candidateId: candidate.id } });
    if (profiles.length === 0) {
      await prisma.candidateCareerProfile.create({
        data: { candidateId: candidate.id, kind: "SOFTWARE", title: "Software Engineer", summary: "Test profile" }
      });
    }

  console.log("\n1. Testing Scheduler...");
  await processJobDiscoveryScheduler();
  console.log("Scheduler executed. Checking for created JobDiscoveryRun...");
  
  const run = await prisma.jobDiscoveryRun.findFirst({
    where: { organizationId: org.id },
    orderBy: { startedAt: 'desc' }
  });
  
  if (!run) {
    console.error("No JobDiscoveryRun was created!");
    process.exit(1);
  }
  
  console.log(`Run found! ID: ${run.id}, Status: ${run.status}`);

  console.log("\n2. Executing Discovery Worker for the Run...");
  await processJobDiscovery(org.id, run.id);
  
  const updatedRun = await prisma.jobDiscoveryRun.findUnique({ where: { id: run.id } });
  console.log(`Run completed! ID: ${updatedRun?.id}`);
  console.log(`Status: ${updatedRun?.status}`);
  console.log(`Queries executed: ${updatedRun?.queries}`);
  console.log(`Raw results: ${updatedRun?.rawResults}`);
  console.log(`Valid vacancies: ${updatedRun?.validVacancies}`);
  console.log(`New vacancies: ${updatedRun?.newVacancies}`);
  console.log(`Duplicates: ${updatedRun?.duplicates}`);
  console.log(`Rate limits hit: ${updatedRun?.rateLimits}`);
  console.log(`Qualification jobs queued: ${updatedRun?.qualificationJobsQueued}`);
  console.log(`Completed At: ${updatedRun?.completedAt}`);

  console.log("\nMILESTONE G TESTS PASSED.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
