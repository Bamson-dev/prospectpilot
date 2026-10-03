import { config } from "dotenv";
config();
import { PrismaClient } from "@prisma/client";
import { getQueue } from "../lib/queues";

const prisma = new PrismaClient();

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("=== PROSPECTPILOT LIVE AUTONOMOUS TEST ===");
  await prisma.$connect();

  const orgSlug = "live-test-" + Date.now();
  const org = await prisma.organization.create({ data: { name: "Live Test Org", slug: orgSlug } });

  const candidate = await prisma.candidate.create({
    data: {
      organizationId: org.id,
      fullName: "Live Test Candidate",
      firstName: "Live",
      lastName: "Candidate",
      email: "livetest@example.com",
      headline: "Senior Software Engineer",
      location: "San Francisco, CA",
    }
  });

  await prisma.candidatePreference.create({
    data: {
      candidateId: candidate.id,
      discoverJobs: true,
      dailyTarget: 500,
      mode: "AUTO_SUBMIT"
    }
  });

  await prisma.candidateCareerProfile.createMany({
    data: [
      {
        candidateId: candidate.id,
        kind: "SOFTWARE",
        title: "Software Engineer",
        summary: "I build robust web applications and data pipelines. I am open to all engineering roles, junior or senior, backend or frontend, remote or on-site."
      },
      {
        candidateId: candidate.id,
        kind: "SAAS",
        title: "Product Manager",
        summary: "I manage product lifecycle, roadmaps, and delivery for software teams."
      },
      {
        candidateId: candidate.id,
        kind: "GROWTH",
        title: "Growth Marketing Manager",
        summary: "I drive user acquisition, retention, and performance marketing campaigns."
      },
      {
        candidateId: candidate.id,
        kind: "WEB",
        title: "Sales Manager",
        summary: "I lead B2B outbound sales, pipeline management, and enterprise deals."
      }
    ]
  });

  console.log(`Created live test candidate: ${candidate.id}`);
  
  // Clear any existing jobs in these queues just to be safe
  const discoveryQueue = getQueue("job-discovery");
  const qualQueue = getQueue("qualification");
  const prepQueue = getQueue("application-preparation");
  const appQueue = getQueue("application-submit");

  console.log("Emptying queues...");
  await discoveryQueue.obliterate({ force: true }).catch(() => {});
  await qualQueue.obliterate({ force: true }).catch(() => {});
  await prepQueue.obliterate({ force: true }).catch(() => {});
  await appQueue.obliterate({ force: true }).catch(() => {});

  console.log("Queuing Job Discovery Scheduler...");
  const { processJobDiscoveryScheduler } = require("../worker/processors/job-applications");
  await processJobDiscoveryScheduler();

  const runs = await prisma.jobDiscoveryRun.findMany({
    where: { organizationId: org.id }
  });
  
  if (runs.length !== 1) {
    console.error("Failed to schedule discovery run.");
    process.exit(1);
  }
  
  const runId = runs[0].id;
  console.log(`Scheduled JobDiscoveryRun: ${runId}`);

  console.log("\nStarting worker...");
  const { spawn } = require("child_process");
  const workerProcess = spawn("npx", ["tsx", "worker/index.ts"], {
    env: {
      ...process.env,
      JOB_DISCOVERY_ENABLED: "true",
      CV_GENERATION_ENABLED: "true",
      COVER_LETTER_GENERATION_ENABLED: "true",
      APPLICATION_AUTOMATION_ENABLED: "true", // Enable autonomous submission!
    },
    stdio: "inherit"
  });

  const startTime = Date.now();
  let completed = false;
  
  console.log("Monitoring progress. Waiting for 200 processed applications...");

  while (!completed) {
    await delay(5000);
    
    const applications = await prisma.jobApplication.findMany({ 
      where: { organizationId: org.id },
      include: { 
        vacancy: true,
        package: true 
      }
    });
    
    let submitted = 0;
    let unverified = 0;
    let manual = 0;
    let failed = 0;
    
    for (const app of applications) {
      if (app.status === "SUBMITTED" || app.status === "VERIFIED") submitted++;
      else if (app.status === "SUBMISSION_UNVERIFIED") unverified++;
      else if (app.status === "REQUIRES_MANUAL_ACTION" || app.status === "CAPTCHA_REQUIRED" || app.status === "LOGIN_REQUIRED" || app.status === "CLOUDFLARE_CHALLENGE" || app.status === "UNKNOWN_REQUIRED_FIELD") manual++;
      else if (app.status === "FAILED") failed++;
    }
    
    const totalProcessed = submitted + unverified + manual + failed;
    
    const dq = await discoveryQueue.getJobCounts();
    const qq = await qualQueue.getJobCounts();
    const pq = await prepQueue.getJobCounts();
    const aq = await appQueue.getJobCounts();
    
    console.log(`Queues -> Disc: ${dq.active+dq.waiting}, Qual: ${qq.active+qq.waiting}, Prep: ${pq.active+pq.waiting}, App: ${aq.active+aq.waiting}`);
    console.log(`Processed: ${totalProcessed}/200 (Submitted: ${submitted}, Unverified: ${unverified}, Manual: ${manual}, Failed: ${failed})`);
    
    if (totalProcessed >= 200) {
      completed = true;
    }
    
    const run = await prisma.jobDiscoveryRun.findUnique({ where: { id: runId } });
    if ((run?.status === "COMPLETED" || run?.status === "FAILED") && dq.active===0 && dq.waiting===0 && qq.active===0 && qq.waiting===0 && pq.active===0 && pq.waiting===0 && aq.active===0 && aq.waiting===0) {
      console.log("Pipeline drained.");
      completed = true;
    }
    
    if (Date.now() - startTime > 45 * 60 * 1000) {
      console.log("Benchmark timed out after 15 minutes.");
      break;
    }
  }

  workerProcess.kill();
  const totalTimeMs = Date.now() - startTime;

  console.log("\n=== LIVE TEST RESULTS ===");
  const finalRun = await prisma.jobDiscoveryRun.findUnique({ where: { id: runId } });
  
  const vacancies = await prisma.jobVacancy.findMany({ where: { organizationId: org.id }, include: { fit: true } });
  
  const applications = await prisma.jobApplication.findMany({ 
    where: { organizationId: org.id }, 
    include: { package: true, events: true, vacancy: true } 
  });
  
  let applyCount = 0;
  let reviewCount = 0;
  let notFitCount = 0;
  for (const v of vacancies) {
    const rec = v.fit?.recommendation;
    if (rec === "APPLY") applyCount++;
    else if (rec === "REVIEW") reviewCount++;
    else if (rec === "NOT_A_FIT") notFitCount++;
  }
  
  let prepared = 0;
  let readyForSubmission = 0;
  let submissionAttempts = 0;
  let verifiedSubmissions = 0;
  let unverifiedSubmissions = 0;
  let captchaBlockers = 0;
  let otherManual = 0;
  let failedApps = 0;
  
  const details = [];

  for (const app of applications) {
    if (app.package) prepared++;
    if (app.status === "READY_FOR_SUBMISSION") readyForSubmission++;
    if (app.status === "SUBMITTING" || app.status === "SUBMITTED" || app.status === "VERIFIED" || app.status === "SUBMISSION_UNVERIFIED" || app.status === "REQUIRES_MANUAL_ACTION" || app.status === "CAPTCHA_REQUIRED" || app.status === "LOGIN_REQUIRED" || app.status === "CLOUDFLARE_CHALLENGE" || app.status === "UNKNOWN_REQUIRED_FIELD" || app.status === "FAILED") {
      submissionAttempts++;
    }
    
    if (app.status === "SUBMITTED" || app.status === "VERIFIED") verifiedSubmissions++;
    else if (app.status === "SUBMISSION_UNVERIFIED") unverifiedSubmissions++;
    else if (app.status === "CAPTCHA_REQUIRED" || app.blockedReason === "captcha") captchaBlockers++;
    else if (app.status === "REQUIRES_MANUAL_ACTION" || app.status === "UNKNOWN_REQUIRED_FIELD") otherManual++;
    else if (app.status === "FAILED") failedApps++;
    
    if (["SUBMITTED", "VERIFIED", "SUBMISSION_UNVERIFIED", "CAPTCHA_REQUIRED", "LOGIN_REQUIRED", "CLOUDFLARE_CHALLENGE", "UNKNOWN_REQUIRED_FIELD", "REQUIRES_MANUAL_ACTION", "FAILED"].includes(app.status)) {
      details.push({
        id: app.id,
        company: app.vacancy.companyName,
        title: app.vacancy.title,
        ats: app.vacancy.source,
        url: app.vacancy.applicationUrl,
        status: app.status,
        blocker: app.blockedReason || "none",
        duration: app.package?.timings ? (app.package.timings as any).total : "unknown"
      });
    }
  }

  console.log(`Discovered: ${finalRun?.rawResults}`);
  console.log(`Unique: ${finalRun?.validVacancies}`);
  console.log(`Qualified: ${applyCount}`);
  console.log(`Rejected: ${notFitCount}`);
  console.log(`Prepared: ${prepared}`);
  console.log(`READY_FOR_SUBMISSION: ${readyForSubmission}`);
  console.log(`Submission attempts: ${submissionAttempts}`);
  console.log(`Verified submissions: ${verifiedSubmissions}`);
  console.log(`Unverified: ${unverifiedSubmissions}`);
  
  const cfCount = details.filter(d => d.status === "CLOUDFLARE_CHALLENGE").length;
  const loginCount = details.filter(d => d.status === "LOGIN_REQUIRED").length;

  console.log(`CAPTCHA: ${captchaBlockers}`);
  console.log(`Cloudflare: ${cfCount}`);
  console.log(`Login Required: ${loginCount}`);
  console.log(`Other manual blockers: ${otherManual}`);
  console.log(`Failed: ${failedApps}`);
  
  // Calculate ATS distribution and ATS Accessibility
  const atsDist: Record<string, number> = {};
  for (const v of vacancies) {
    const ats = v.source || "UNKNOWN";
    atsDist[ats] = (atsDist[ats] || 0) + 1;
  }
  console.log("\n--- ATS Distribution (Unique Vacancies) ---");
  for (const [ats, count] of Object.entries(atsDist)) {
    console.log(`${ats}: ${count}`);
  }
  
  const atsAccess: Record<string, { attempts: number; captcha: number; cf: number; login: number; accessible: number; failed: number }> = {};
  for (const d of details) {
    const ats = d.ats || "UNKNOWN";
    if (!atsAccess[ats]) atsAccess[ats] = { attempts: 0, captcha: 0, cf: 0, login: 0, accessible: 0, failed: 0 };
    atsAccess[ats].attempts++;
    if (d.status === "CAPTCHA_REQUIRED") atsAccess[ats].captcha++;
    else if (d.status === "CLOUDFLARE_CHALLENGE") atsAccess[ats].cf++;
    else if (d.status === "LOGIN_REQUIRED") atsAccess[ats].login++;
    else if (d.status === "SUBMITTED" || d.status === "VERIFIED" || d.status === "SUBMISSION_UNVERIFIED") atsAccess[ats].accessible++;
    else atsAccess[ats].failed++;
  }
  console.log("\n--- Source Accessibility by ATS ---");
  for (const [ats, metrics] of Object.entries(atsAccess)) {
    console.log(`${ats}:
  ${metrics.attempts} URLs tested
  ${metrics.accessible} accessible
  ${metrics.captcha} CAPTCHA
  ${metrics.cf} Cloudflare
  ${metrics.login} Login
  ${metrics.failed} Failed/Other`);
  }

  console.log(`\nTotal elapsed time: ${Math.round(totalTimeMs/1000)}s`);
  console.log(`Applications/hour: ${Math.round(submissionAttempts / (totalTimeMs/3600000))}`);

  console.log("\n--- Application Details ---");
  console.table(details);
  
  console.log("\nDone.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
