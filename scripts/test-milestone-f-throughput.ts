import { prisma } from "@/lib/db";
import { prepareDiscoveredVacancies, assessVacancy } from "@/lib/applications/job-pipeline";
import { persistNormalizedVacancies } from "@/lib/applications/service";
import type { RawDiscoveredVacancy } from "@/lib/applications/job-normalize";
import { loadCandidateRecord, ensureCandidate } from "@/lib/applications/service";

function generateDeterministicFixtures(): RawDiscoveredVacancy[] {
  const jobs: RawDiscoveredVacancy[] = [];
  let idCounter = 1;
  const board = "greenhouse";
  const company = "FixtureCorp";

  // 1. 350 Unique Vacancies
  for (let i = 0; i < 350; i++) {
    jobs.push({
      source: board,
      sourceUrl: `https://${board}.com/${company}/jobs/${idCounter}`,
      applicationUrl: `https://${board}.com/${company}/jobs/${idCounter}/apply`,
      externalId: `${idCounter}`,
      companyName: company,
      title: `Unique Role ${i}`,
      location: "Remote",
      employmentType: "Full-Time",
      workplaceType: "Remote",
      description: `Looking for Unique Role ${i}. Some general requirements apply.`,
      originalDescription: `Looking for Unique Role ${i}...`,
      postedAt: new Date().toISOString(),
    });
    idCounter++;
  }

  // 2. 50 Duplicate Canonical URLs (same URL as an earlier job)
  for (let i = 0; i < 50; i++) {
    const targetId = i + 1; // Duplicating the first 50 jobs
    jobs.push({
      source: board,
      sourceUrl: `https://${board}.com/${company}/jobs/${targetId}`, // Same URL
      applicationUrl: `https://${board}.com/${company}/jobs/${targetId}/apply`,
      externalId: `${idCounter}`, // Different ID, but same URL
      companyName: company,
      title: `Unique Role ${i} (Duplicate by URL)`,
      location: "Remote",
      employmentType: "Full-Time",
      workplaceType: "Remote",
      description: `Duplicate description.`,
      originalDescription: `Duplicate description...`,
      postedAt: new Date().toISOString(),
    });
    idCounter++;
  }

  // 3. 25 Duplicate Requisition IDs (Same ID, different URL)
  for (let i = 0; i < 25; i++) {
    const targetId = i + 51; 
    jobs.push({
      source: board,
      sourceUrl: `https://${board}.com/${company}/jobs/different-url-${idCounter}`,
      applicationUrl: `https://${board}.com/${company}/jobs/different-url-${idCounter}/apply`,
      externalId: `${targetId}`, // Same external ID as an earlier job
      companyName: company,
      title: `Duplicate ID Role`,
      location: "Remote",
      employmentType: "Full-Time",
      workplaceType: "Remote",
      description: `Duplicate description.`,
      originalDescription: `Duplicate description...`,
      postedAt: new Date().toISOString(),
    });
    idCounter++;
  }

  // 4. 25 Same Title / Different Location
  for (let i = 0; i < 25; i++) {
    jobs.push({
      source: board,
      sourceUrl: `https://${board}.com/${company}/jobs/${idCounter}`,
      applicationUrl: `https://${board}.com/${company}/jobs/${idCounter}/apply`,
      externalId: `${idCounter}`,
      companyName: company,
      title: `Software Engineer`, // Same title as next one
      location: `City ${i}, State`, // Different location
      employmentType: "Full-Time",
      workplaceType: "On-site",
      description: `We need a software engineer in City ${i}.`,
      originalDescription: `We need a software engineer in City ${i}...`,
      postedAt: new Date().toISOString(),
    });
    idCounter++;
  }

  // 5. 25 APPLY Candidates (Perfect match for the seeded candidate)
  for (let i = 0; i < 25; i++) {
    jobs.push({
      source: board,
      sourceUrl: `https://${board}.com/${company}/jobs/${idCounter}`,
      applicationUrl: `https://${board}.com/${company}/jobs/${idCounter}/apply`,
      externalId: `${idCounter}`,
      companyName: company,
      title: `Perfect Match Engineer ${i}`,
      location: "Remote",
      employmentType: "Full-Time",
      workplaceType: "Remote",
      description: `We need an engineer. 3 years of TypeScript experience required. Remote allowed.`,
      originalDescription: `We need an engineer...`,
      postedAt: new Date().toISOString(),
    });
    idCounter++;
  }

  // 6. 25 REVIEW/NOT_A_FIT mixed (Missing requirements)
  for (let i = 0; i < 25; i++) {
    jobs.push({
      source: board,
      sourceUrl: `https://${board}.com/${company}/jobs/${idCounter}`,
      applicationUrl: `https://${board}.com/${company}/jobs/${idCounter}/apply`,
      externalId: `${idCounter}`,
      companyName: company,
      title: `Not A Fit Engineer ${i}`,
      location: "On-site, London",
      employmentType: "Full-Time",
      workplaceType: "On-site",
      description: `We need a Rust engineer. 10 years required in Rust and Kubernetes. Not remote.`,
      originalDescription: `We need a Rust engineer...`,
      postedAt: new Date().toISOString(),
    });
    idCounter++;
  }

  return jobs;
}

async function runThroughputTest() {
  const startTime = Date.now();
  console.log("==========================================");
  console.log(`INTERNAL PIPELINE THROUGHPUT TEST`);
  console.log("==========================================");
  
  // 1. Ensure test org and candidate exist
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({ data: { name: "Test Org", slug: "test-org" } });
  }
  const candidateRow = await ensureCandidate(org.id);
  const candidate = await loadCandidateRecord(candidateRow.id);
  
  // 2. Generate Mock Discovery Input
  console.log(`\n[1/5] Generating mock deterministic fixtures...`);
  const mockJobs = generateDeterministicFixtures();
  console.log(`  - Generated: ${mockJobs.length} records`);
  
  // 3. Normalization & Deduplication
  console.log(`\n[2/5] Running prepareDiscoveredVacancies...`);
  const prepStart = Date.now();
  // using empty string so it doesn't filter out by query match
  const prepared = prepareDiscoveredVacancies(mockJobs, "");
  const prepTime = Date.now() - prepStart;
  
  console.log(`  - Normalized: ${prepared.normalized.length}`);
  console.log(`  - In-Memory Duplicates removed: ${prepared.duplicateReasons.length}`);
  console.log(`  - Invalid Sources: ${prepared.invalidSources.length}`);
  console.log(`  - Kept for DB: ${prepared.kept.length}`);
  
  // 4. Persistence
  console.log(`\n[3/5] Running persistNormalizedVacancies...`);
  const persistStart = Date.now();
  const saved = await persistNormalizedVacancies(org.id, prepared.kept);
  const persistTime = Date.now() - persistStart;
  
  console.log(`  - DB Duplicates: ${saved.duplicateReasons.length}`);
  console.log(`  - Stored: ${saved.ids.length}`);
  
  // 5. Qualification Engine
  console.log(`\n[4/5] Running Qualification Engine on stored jobs...`);
  const qualStart = Date.now();
  
  const jobsToAnalyze = await prisma.jobVacancy.findMany({
    where: { id: { in: saved.ids } }
  });
  
  let applyCount = 0;
  let reviewCount = 0;
  let notFitCount = 0;
  
  for (const vacancy of jobsToAnalyze) {
    const assessed = assessVacancy({
      title: vacancy.title,
      companyName: vacancy.companyName,
      description: vacancy.description,
      location: vacancy.location,
      remoteType: vacancy.remoteType,
      applicationUrl: vacancy.applicationUrl,
    }, candidate);
    
    if (assessed.state === "APPLY") applyCount++;
    else if (assessed.state === "NOT_A_FIT") notFitCount++;
    else reviewCount++;
  }
  const qualTime = Date.now() - qualStart;
  
  console.log(`  - Qualification Processed: ${jobsToAnalyze.length}`);
  console.log(`  - APPLY: ${applyCount}`);
  console.log(`  - REVIEW: ${reviewCount}`);
  console.log(`  - NOT_A_FIT: ${notFitCount}`);

  // Final Metrics
  const totalMs = Date.now() - startTime;
  const recordsInput = mockJobs.length;
  
  console.log(`\n==========================================`);
  console.log(`TEST COMPLETED in ${totalMs}ms`);
  console.log(`Records Input: ${recordsInput}`);
  console.log(`Records Normalized: ${prepared.normalized.length}`);
  console.log(`Records Rejected (Invalid/Dedupe): ${prepared.failed + prepared.duplicateReasons.length + saved.duplicateReasons.length}`);
  console.log(`Unique Vacancies (Stored): ${saved.ids.length}`);
  console.log(`Records/Second: ${Math.round((recordsInput / totalMs) * 1000)}`);
  console.log(`Records/Minute: ${Math.round((recordsInput / totalMs) * 1000 * 60)}`);
  console.log(`Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
  console.log(`==========================================`);
}

runThroughputTest().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
