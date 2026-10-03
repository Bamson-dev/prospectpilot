import { parseArgs } from "node:util";
import { prisma } from "@/lib/db";
import { enqueue } from "@/lib/queues";

export async function runBatchCLI(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      limit: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "career-profile": { type: "string" },
      status: { type: "string", default: "QUALIFIED" },
    },
  });

  const limitValue = parseInt(values.limit || "0", 10);
  if (!limitValue || limitValue <= 0) {
    throw new Error("You must specify an explicit --limit (e.g., --limit 10)");
  }

  const status = values.status || "QUALIFIED";
  
  console.log("==========================================");
  console.log(`Application Batching CLI`);
  console.log(`Dry Run: ${values["dry-run"] ? "Yes" : "No"}`);
  console.log(`Limit: ${limitValue}`);
  console.log(`Status: ${status}`);
  if (values["career-profile"]) console.log(`Profile: ${values["career-profile"]}`);
  console.log("==========================================");

  const where: any = { status };
  // We can't strictly filter by career profile directly on JobVacancy easily without joining, 
  // but we'll fetch them first and report.

  const vacancies = await prisma.jobVacancy.findMany({
    where,
    take: limitValue,
    orderBy: { createdAt: "desc" },
  });

  const selectedVacancies = vacancies.length;
  if (selectedVacancies === 0) {
    console.log("No matching vacancies found.");
    return;
  }

  // Check existing applications
  let existingApplications = 0;
  let newApplications = 0;

  for (const vacancy of vacancies) {
    const existing = await prisma.jobApplication.findFirst({
      where: { vacancyId: vacancy.id }
    });
    if (existing) {
      existingApplications++;
    } else {
      newApplications++;
    }
  }

  const packagesToGenerate = newApplications; // each new application generates a package
  const queueJobsToCreate = selectedVacancies;

  console.log(`\nSelected vacancies: ${selectedVacancies}`);
  console.log(`Already-existing applications: ${existingApplications}`);
  console.log(`New applications to create: ${newApplications}`);
  console.log(`Packages to generate: ${packagesToGenerate}`);
  console.log(`Queue jobs to create: ${queueJobsToCreate}`);
  
  if (values["dry-run"]) {
    console.log("\nDry run completed. No jobs were enqueued.");
    return;
  }

  console.log("\nEnqueueing jobs...");
  let enqueued = 0;
  
  for (const vacancy of vacancies) {
    const candidateRow = await prisma.candidate.findFirst({
      where: { organizationId: vacancy.organizationId },
    });
    
    if (!candidateRow) continue;
    
    const id = `application-preparation:${vacancy.organizationId}:${vacancy.id}`;
    
    await prisma.backgroundJob.upsert({
      where: { id },
      update: { state: "QUEUED", error: null, finishedAt: null },
      create: { 
        id, 
        organizationId: vacancy.organizationId, 
        queue: "application-preparation", 
        name: "prepare", 
        payload: { organizationId: vacancy.organizationId, vacancyId: vacancy.id } 
      }
    });

    await enqueue("application-preparation", id, { 
      jobId: id, 
      organizationId: vacancy.organizationId, 
      vacancyId: vacancy.id 
    });
    
    enqueued++;
  }

  console.log(`\nSuccessfully enqueued ${enqueued} applications for preparation.`);
}

if (require.main === module) {
  runBatchCLI(process.argv.slice(2)).catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
