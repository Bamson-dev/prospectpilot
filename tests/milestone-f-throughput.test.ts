import { describe, expect, it } from "vitest";
import { prepareDiscoveredVacancies, assessVacancy } from "@/lib/applications/job-pipeline";
import type { RawDiscoveredVacancy } from "@/lib/applications/job-normalize";
import { seedCandidateRecord } from "@/lib/applications/seed-data";
import type { CandidateRecord } from "@/lib/applications/types";

describe("Milestone F: High-Volume Throughput", () => {
  function generateMockJobs(count: number): RawDiscoveredVacancy[] {
    const jobs: RawDiscoveredVacancy[] = [];
    const roles = ["Software Engineer", "Backend Engineer", "Frontend Developer", "Product Manager"];
    for (let i = 0; i < count; i++) {
      const role = roles[i % roles.length];
      const duplicateSeed = i % 10 === 0 ? Math.floor(i / 10) : i; // Add 10% duplicates
      jobs.push({
        source: "greenhouse",
        sourceUrl: `https://boards.greenhouse.io/acme/jobs/${duplicateSeed}`,
        applicationUrl: `https://boards.greenhouse.io/acme/jobs/${duplicateSeed}`,
        externalId: `${duplicateSeed}`,
        companyName: `Company ${duplicateSeed}`,
        title: `${role} - ${i}`,
        location: "Remote",
        employmentType: "Full-Time",
        workplaceType: "Remote",
        description: `We are looking for a ${role} with 3 years of experience. You should know Node.js, React, and TypeScript. Remote friendly.`,
        originalDescription: `We are looking for a ${role}...`,
        postedAt: new Date().toISOString(),
      });
    }
    return jobs;
  }

  function candidate(): CandidateRecord {
    return { ...seedCandidateRecord(), email: "test@example.com" };
  }

  it("can normalize and deduplicate 500 records in under 2 seconds", () => {
    const jobs = generateMockJobs(500);
    const start = Date.now();
    const prepared = prepareDiscoveredVacancies(jobs, "software engineer developer manager");
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(2000);
    expect(prepared.normalized.length).toBe(500);
    expect(prepared.kept.length).toBeLessThan(500); // Because of intentional duplicates
    expect(prepared.duplicateReasons.length).toBeGreaterThan(0);
  });

  it("can qualify 100 jobs efficiently", () => {
    const jobs = generateMockJobs(100);
    const prepared = prepareDiscoveredVacancies(jobs, "engineer");
    const person = candidate();

    const start = Date.now();
    let applyCount = 0;
    
    for (const job of prepared.kept) {
      const assessed = assessVacancy({
        title: job.title,
        companyName: job.companyName,
        description: job.description,
        location: job.location,
        remoteType: job.remoteType,
        applicationUrl: job.applicationUrl
      }, person);
      
      if (assessed.state === "APPLY") applyCount++;
    }
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(3000); // Should be very fast since it's local
    expect(applyCount).toBeGreaterThanOrEqual(0);
  });
});
