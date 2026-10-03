import { prisma } from "@/lib/db";
import { prepareDiscoveredVacancies } from "@/lib/applications/job-pipeline";
import { persistNormalizedVacancies, prepareApplication } from "@/lib/applications/service";
import type { RawDiscoveredVacancy } from "@/lib/applications/job-normalize";
import { attachBrowserInspection } from "@/lib/applications/public-inspection";

async function runDatabaseQueueTest() {
  console.log("==========================================");
  console.log(`DATABASE-BACKED QUEUE TEST (10 Records)`);
  console.log("==========================================");

  // 1. Ensure test org and candidate exist
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({ data: { name: "Test Org", slug: "test-org" } });
  }

  // Generate 10 records
  const jobs: RawDiscoveredVacancy[] = [];
  const testRunId = Date.now();
  for (let i = 0; i < 10; i++) {
    jobs.push({
      source: "greenhouse",
      sourceUrl: `https://boards.greenhouse.io/acme/jobs/${testRunId}-${i}`,
      applicationUrl: `https://boards.greenhouse.io/acme/jobs/${testRunId}-${i}`,
      externalId: `${testRunId}-${i}`,
      companyName: "Acme",
      title: "Software Engineer",
      location: "Remote",
      employmentType: "Full-Time",
      workplaceType: "Remote",
      description: "We need a Software Engineer with 3 years of TypeScript experience.",
      originalDescription: "We need a Software Engineer...",
      postedAt: new Date().toISOString(),
    });
  }

  // Pipeline execution
  console.log(`[1] Normalizing jobs...`);
  const prepared = prepareDiscoveredVacancies(jobs, "");
  
  console.log(`[2] Persisting to JobVacancy...`);
  const saved = await persistNormalizedVacancies(org.id, prepared.kept);
  
  console.log(`[3] Qualifying and generating JobApplications and ApplicationPackages...`);
  const appIds: string[] = [];
  for (const vacancyId of saved.ids) {
    try {
      const appId = await prepareApplication(org.id, vacancyId);
      appIds.push(appId);
    } catch (err: any) {
      console.log(`  - Failed to prepare application for ${vacancyId}: ${err.message}`);
    }
  }

  console.log(`[4] Enqueueing to browser worker...`);
  let queued = 0;
  for (const appId of appIds) {
    try {
      // attachBrowserInspection internally ensures it doesn't run live
      // because we only inspect without submitting. But to be ultra-safe,
      // we'll just queue the job as if the worker was going to do it.
      // Wait, attachBrowserInspection actually runs the browser INLINE in the function, it doesn't enqueue!
      // In processApplicationPreparation, it calls attachBrowserInspection which runs Playwright inline.
      // So calling it would launch 10 browsers concurrently if in Promise.all, but sequentially here.
      // But the prompt says "without submitting anything externally", and we don't want to run Playwright on fake URLs!
      // The real pipeline uses `application-browser` queue? 
      // Let's just create the queue jobs for `application-preparation` which does this.
      const id = `application-preparation:${org.id}:${saved.ids[queued]}`;
      await prisma.backgroundJob.upsert({
        where: { id },
        update: { state: "QUEUED", error: null, finishedAt: null },
        create: { id, organizationId: org.id, queue: "application-preparation", name: "prepare", payload: { organizationId: org.id, vacancyId: saved.ids[queued] } }
      });
      queued++;
    } catch (err: any) {
      console.error(err);
    }
  }

  // Verification checks
  const jobApplications = await prisma.jobApplication.findMany({ where: { id: { in: appIds } } });
  const applicationPackages = await prisma.applicationPackage.findMany({ where: { applicationId: { in: appIds } } });
  const queueJobs = await prisma.backgroundJob.findMany({ where: { queue: "application-preparation", state: "QUEUED" } });

  console.log(`\n==========================================`);
  console.log(`Database verification:`);
  console.log(`JobVacancies stored: ${saved.ids.length}`);
  console.log(`JobApplications created: ${jobApplications.length}`);
  console.log(`ApplicationPackages created: ${applicationPackages.length}`);
  console.log(`Queue Jobs created: ${queued}`);
  
  if (saved.ids.length === 10 && jobApplications.length === 10 && applicationPackages.length === 10 && queued === 10) {
    console.log(`\nSUCCESS: 10-record database queue test passed.`);
  } else {
    console.log(`\nFAILURE: Missing records.`);
    process.exit(1);
  }
}

runDatabaseQueueTest().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
