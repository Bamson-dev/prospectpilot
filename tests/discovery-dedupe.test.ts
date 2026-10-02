import { describe, expect, it } from "vitest";
import { duplicateDecision } from "@/lib/applications/dedupe";

describe("High Volume Deduplication Rules", () => {
  const baseJob = {
    companyName: "Acme",
    title: "Software Engineer",
    applicationUrl: "https://boards.greenhouse.io/acme/jobs/123",
    sourceUrl: "https://boards.greenhouse.io/acme/jobs/123",
    externalId: "123",
    location: "Remote",
  };

  it("Same URL twice -> MERGE", () => {
    const decision = duplicateDecision(baseJob, { ...baseJob, externalId: "456", title: "Different Title" });
    expect(decision.merge).toBe(true);
    expect(decision.reason).toContain("canonical application URL");
  });

  it("Same requisition/source ID twice -> MERGE", () => {
    const decision = duplicateDecision(
      { ...baseJob, applicationUrl: "https://example.com/a" },
      { ...baseJob, applicationUrl: "https://example.com/b" }
    );
    expect(decision.merge).toBe(true);
    expect(decision.reason).toContain("canonical job URL"); // baseJob.sourceUrl is the same
  });

  it("Same vacancy discovered from Greenhouse and SearXNG -> MERGE", () => {
    const decision = duplicateDecision(
      { ...baseJob, applicationUrl: "https://boards.greenhouse.io/acme/jobs/123" },
      { ...baseJob, applicationUrl: "https://boards.greenhouse.io/acme/jobs/123?gh_src=searxng", externalId: null, sourceUrl: "https://example.com/searxng-link" }
    );
    expect(decision.merge).toBe(true);
    expect(decision.reason).toContain("canonical application URL");
  });

  it("Same title at different locations -> DO NOT MERGE", () => {
    const decision = duplicateDecision(
      { ...baseJob, applicationUrl: "https://a.com/1", location: "New York", sourceUrl: null, externalId: null },
      { ...baseJob, applicationUrl: "https://a.com/2", location: "London", sourceUrl: null, externalId: null }
    );
    expect(decision.merge).toBe(false);
  });

  it("Same employer/title but different requisition IDs -> DO NOT MERGE", () => {
    const decision = duplicateDecision(
      { ...baseJob, applicationUrl: "https://a.com/1", externalId: "111", location: "Remote", sourceUrl: null },
      { ...baseJob, applicationUrl: "https://a.com/2", externalId: "222", location: "Remote", sourceUrl: null }
    );
    expect(decision.merge).toBe(false);
  });
});
