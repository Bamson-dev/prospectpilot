import { PrismaClient } from "@prisma/client";
import { resolveAtsUrl } from "../lib/applications/job-sources";
import { prepareDiscoveredVacancies } from "../lib/applications/job-pipeline";
import { persistNormalizedVacancies } from "../lib/applications/service";
import { enqueue } from "../lib/queues";
import { prepareApplication } from "../lib/applications/service";

const prisma = new PrismaClient();

async function main() {
  console.log("=== MILESTONE F: DATABASE VERIFICATION ===");
  await prisma.$connect();

  console.log("\n1. Cleaning up test data...");
  await prisma.jobApplication.deleteMany({ where: { vacancy: { companyName: { in: ["TestCompanyDB", "GitLab", "Spotify"] } } } });
  await prisma.jobVacancy.deleteMany({ where: { companyName: { in: ["TestCompanyDB", "GitLab", "Spotify"] } } });

  console.log("\n2. MIGRATION VERIFICATION");
  const tableInfo = await prisma.$queryRaw`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'JobVacancy' 
    AND column_name IN ('lastCheckedAt', 'normalizedTitle', 'normalizedCompany', 'normalizedLocation')
  `;
  console.log("Found migration columns:", tableInfo);

  console.log("\n3. REAL DATABASE DEDUPLICATION TEST");
  const testJobs = [
    {
      source: "greenhouse" as const,
      sourceUrl: "https://boards.greenhouse.io/gitlab/1",
      applicationUrl: "https://boards.greenhouse.io/gitlab/1",
      companyName: "GitLab",
      title: "Backend Engineer",
      location: "Remote US",
      description: "Test 1 description with more than 40 chars length so it passes the length check. ".repeat(2),
    },
    {
      source: "greenhouse" as const,
      sourceUrl: "https://boards.greenhouse.io/gitlab/1",
      applicationUrl: "https://boards.greenhouse.io/gitlab/1",
      companyName: "GitLab",
      title: "Backend Engineer",
      location: "Remote US",
      description: "Test 2 duplicate canonical URL with more than 40 chars length. ".repeat(2),
    },
    {
      source: "greenhouse" as const,
      sourceUrl: "https://boards.greenhouse.io/gitlab/2",
      applicationUrl: "https://boards.greenhouse.io/gitlab/2",
      externalId: "REQ-123",
      companyName: "GitLab",
      title: "Backend Engineer",
      location: "Remote US",
      description: "Test 3 description with more than 40 chars length. ".repeat(2),
    },
    {
      source: "greenhouse" as const,
      sourceUrl: "https://boards.greenhouse.io/gitlab/3",
      applicationUrl: "https://boards.greenhouse.io/gitlab/3",
      externalId: "REQ-123",
      companyName: "GitLab",
      title: "Backend Engineer",
      location: "Remote US",
      description: "Test 4 duplicate req id description with more than 40 chars length. ".repeat(2),
    },
    {
      source: "greenhouse" as const,
      sourceUrl: "https://boards.greenhouse.io/gitlab/4",
      applicationUrl: "https://boards.greenhouse.io/gitlab/4",
      companyName: "GitLab",
      title: "Backend Engineer",
      location: "Remote Canada", // different location!
      description: "Test 5 description with more than 40 chars length. ".repeat(2),
    },
    {
      source: "greenhouse" as const,
      sourceUrl: "https://boards.greenhouse.io/spotify/1",
      applicationUrl: "https://boards.greenhouse.io/spotify/1",
      companyName: "Spotify",
      title: "Backend Engineer",
      location: "Remote US",
      description: "Test 6 description with more than 40 chars length. ".repeat(2),
    }
  ];

  // We need a dummy candidate
  let candidate = await prisma.candidate.findFirst();
  if (!candidate) {
    console.log("No candidate found in the DB. Creating dummy candidate.");
    const org = await prisma.organization.upsert({ where: { slug: "test-org-db" }, update: {}, create: { name: "Test Org DB", slug: "test-org-db" } });
    candidate = await prisma.candidate.create({
      data: {
        organizationId: org.id,
        firstName: "Test",
        lastName: "Candidate",
        fullName: "Test Candidate",
        email: "test@example.com",
        location: "Remote",
      }
    });
  }

  const prepared = prepareDiscoveredVacancies(testJobs, "test");
  await persistNormalizedVacancies(candidate.organizationId, prepared.kept);
  const dbJobs = await prisma.jobVacancy.findMany({ where: { companyName: { in: ["GitLab", "Spotify"] } } });
  console.log(`Persisted ${dbJobs.length} jobs (expected 4 distinct).`);
  for (const j of dbJobs) {
    console.log(` - [${j.companyName}] ${j.title} (${j.location}) | Canonical: ${j.applicationUrl} | Req: ${j.externalId}`);
  }

  console.log("\n4. JOBAPPLICATION IDEMPOTENCY");
  const testVacancy = dbJobs[0];
  if (!candidate) {
    console.log("No candidate found, skipping Application idempotency.");
  } else {
    // prepare application twice
    await prepareApplication(candidate.organizationId, testVacancy.id);
    await prepareApplication(candidate.organizationId, testVacancy.id);

    const apps = await prisma.jobApplication.findMany({ where: { vacancyId: testVacancy.id } });
    console.log(`Created ${apps.length} JobApplications for vacancy ${testVacancy.id} (expected 1).`);
  }

  console.log("\n5. QUEUE TEST (Idempotency)");
  const id = `application-preparation:${candidate.organizationId}:${testVacancy.id}`;
  const payload = { jobId: id, organizationId: candidate.organizationId, vacancyId: testVacancy.id };

  await prisma.backgroundJob.upsert({
    where: { id },
    update: { state: "QUEUED", error: null, finishedAt: null },
    create: { 
      id, 
      organizationId: candidate.organizationId, 
      queue: "application-preparation", 
      name: "prepare", 
      payload 
    }
  });

  const q1 = await enqueue("application-preparation", id, payload);
  const q2 = await enqueue("application-preparation", id, payload);
  console.log(`Enqueued Q1: ${q1 !== null}`);
  console.log(`Enqueued Q2 (duplicate): ${q2 !== null}`);

  console.log("\nDone!");
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
