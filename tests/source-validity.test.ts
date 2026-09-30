import { describe, expect, it } from "vitest";
import { prepareDiscoveredVacancies } from "@/lib/applications/job-pipeline";
import { sourceValidity } from "@/lib/applications/source-validity";

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
