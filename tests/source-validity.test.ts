import { describe, expect, it } from "vitest";
import { prepareDiscoveredVacancies } from "@/lib/applications/job-pipeline";
import { evaluateOpportunity } from "@/lib/applications/opportunity";
import { seedCandidateRecord } from "@/lib/applications/seed-data";
import { sourceValidity } from "@/lib/applications/source-validity";
import type { JobInput } from "@/lib/applications/types";

const posting = "This is a real public vacancy description with enough text to normalize.";

describe("source validity", () => {
  it("keeps specific ATS postings and rejects listing pages", () => {
    expect(sourceValidity({
      title: "Staff Product Security Architect",
      url: "https://boards.greenhouse.io/gitlab/jobs/8815140002",
      source: "greenhouse",
    })).toBe("VALID_VACANCY");
    expect(sourceValidity({
      title: "Senior Product Manager - Subscriptions",
      url: "https://jobs.lever.co/spotify/0f5b2c1a-1111-2222-3333-444455556666",
      source: "lever",
    })).toBe("VALID_VACANCY");
    expect(sourceValidity({
      title: "1,000+ Product Management jobs in Paris - LinkedIn",
      url: "https://www.linkedin.com/jobs/search/?keywords=product",
      source: "generic",
    })).toBe("INVALID_SOURCE");
    expect(sourceValidity({
      title: "Now Hiring: 18,000 Product Manager Jobs | Indeed",
      url: "https://www.indeed.com/q-product-manager-jobs.html",
      source: "generic",
    })).toBe("INVALID_SOURCE");
    expect(sourceValidity({
      title: "APM List: Associate Product Manager Job List",
      url: "https://apmlist.com/product-manager",
      source: "generic",
    })).toBe("INVALID_SOURCE");
    expect(sourceValidity({
      title: "Product Management Roles at Workday | Workday US",
      url: "https://www.workday.com/en-us/company/careers/product.html",
      source: "generic",
    })).toBe("INVALID_SOURCE");
    expect(sourceValidity({
      title: "Remote Product Jobs | We Work Remotely",
      url: "https://weworkremotely.com/categories/remote-product-jobs",
      source: "generic",
    })).toBe("INVALID_SOURCE");
    expect(sourceValidity({
      title: "Product & Program Management Jobs | Lead Tech Projects - Meta",
      url: "https://www.metacareers.com/teams/technology/product-and-program-management",
      source: "generic",
    })).toBe("INVALID_SOURCE");
    expect(sourceValidity({
      title: "Engineering Jobs | Acme",
      url: "https://acme.example/careers/engineering",
      source: "generic",
    })).toBe("INVALID_SOURCE");
    expect(sourceValidity({
      title: "Jobs at Acme",
      url: "https://acme.example/jobs",
      source: "generic",
    })).toBe("INVALID_SOURCE");
    expect(sourceValidity({
      title: "Product search results",
      url: "https://acme.example/jobs/search?q=product",
      source: "generic",
    })).toBe("INVALID_SOURCE");
    expect(sourceValidity({
      title: "Project, Program, and Product Management—Technical",
      url: "https://amazon.jobs/content/en/job-categories/project-program-product-management-technical",
      source: "generic",
    })).toBe("INVALID_SOURCE");
    expect(sourceValidity({
      title: "Product roles in London",
      url: "https://acme.example/careers/locations/london",
      source: "generic",
    })).toBe("INVALID_SOURCE");
    expect(sourceValidity({
      title: "Senior Product Manager, Billing Engine & Platforms Monetization",
      url: "https://job-boards.greenhouse.io/gitlab/jobs/8845483002",
      source: "greenhouse",
    })).toBe("VALID_VACANCY");
    expect(sourceValidity({
      title: "Senior Product Manager - Subscriptions",
      url: "https://jobs.lever.co/spotify/a57db22d-dc0d-4f36-9a2e-34acdf1ec046/apply",
      source: "lever",
    })).toBe("VALID_VACANCY");
    expect(sourceValidity({
      title: "Senior Backend Engineer",
      url: "https://acme.example/careers/senior-backend-engineer",
      source: "generic",
    })).toBe("VALID_VACANCY");
    expect(sourceValidity({
      title: "Product Manager",
      url: "https://www.metacareers.com/jobs/123456789012345",
      source: "generic",
    })).toBe("VALID_VACANCY");
    expect(sourceValidity({
      title: "Product Manager Job Description",
      url: "https://job-boards.greenhouse.io/acme/jobs/67890",
      source: "greenhouse",
    })).toBe("VALID_VACANCY");
    expect(sourceValidity({
      title: "Senior Full-Stack Engineer",
      url: "https://boards.greenhouse.io/acme/jobs/12345",
      source: "greenhouse",
    })).toBe("VALID_VACANCY");
  });

  it("keeps an individual vacancy eligible when no hard requirement was extracted", () => {
    const title = "Senior Full-Stack Engineer";
    const url = "https://boards.greenhouse.io/acme/jobs/12345";
    expect(sourceValidity({ title, url, source: "greenhouse" })).toBe("VALID_VACANCY");
    const vacancy: JobInput = {
      title,
      companyName: "Acme",
      description: "Builds web applications, APIs, databases, frontend and backend systems.",
      applicationUrl: url,
    };
    expect(evaluateOpportunity({ job: vacancy, candidate: seedCandidateRecord(), requirements: [] }).decision).toBe("APPLY");
  });

  it("does not send an invalid source into qualification storage", () => {
    const prepared = prepareDiscoveredVacancies([
      {
        source: "generic",
        sourceUrl: "https://www.indeed.com/q-product-manager-jobs.html",
        applicationUrl: "https://www.indeed.com/q-product-manager-jobs.html",
        companyName: "indeed",
        title: "Now Hiring: 18,000 Product Manager Jobs | Indeed",
        description: posting,
      },
      {
        source: "greenhouse",
        sourceUrl: "https://boards.greenhouse.io/gitlab/jobs/8815140002",
        applicationUrl: "https://boards.greenhouse.io/gitlab/jobs/8815140002",
        companyName: "GitLab",
        title: "Staff Product Security Architect",
        description: posting,
      },
    ], "product");
    expect(prepared.invalidSources).toEqual(["Now Hiring: 18,000 Product Manager Jobs | Indeed"]);
    expect(prepared.kept.map((job) => job.title)).toEqual(["Staff Product Security Architect"]);
  });
});
