import { describe, expect, it, vi } from "vitest";
import { resolveAtsUrl } from "@/lib/applications/job-sources";
import { duplicateDecision } from "@/lib/applications/dedupe";

const mockFetch = vi.fn().mockImplementation((url: string) => {
  const str = url.toString();
  if (str.includes("boards-api.greenhouse.io")) {
    return Promise.resolve(new Response(JSON.stringify({
      id: 123,
      title: "Software Engineer",
      absolute_url: "https://boards.greenhouse.io/acme/jobs/123",
      company_name: "Acme",
      content: "<p>Content</p>",
      first_published: "2026-01-01"
    })));
  }
  if (str.includes("api.lever.co")) {
    return Promise.resolve(new Response(JSON.stringify({
      id: "abc",
      text: "Backend Dev",
      hostedUrl: "https://jobs.lever.co/acme/abc",
      descriptionPlain: "Description",
      categories: { commitment: "Full time", location: "Remote" }
    })));
  }
  if (str.includes("api.ashbyhq.com")) {
    return Promise.resolve(new Response(JSON.stringify({
      jobs: [
        { id: "xyz", title: "Frontend Dev", jobUrl: "https://jobs.ashbyhq.com/acme/xyz", descriptionHtml: "<p>Ashby</p>" }
      ]
    })));
  }
  if (str.includes("apply.workable.com")) {
    return Promise.resolve(new Response(JSON.stringify({
      title: "Fullstack", shortcode: "w123", description: "Workable job"
    })));
  }
  return Promise.resolve(new Response("Not found", { status: 404 }));
}) as unknown as typeof fetch;

describe("ATS URL Resolution from SearXNG", () => {
  it("A. resolves Greenhouse ATS URLs correctly", async () => {
    const res = await resolveAtsUrl(mockFetch, "https://boards.greenhouse.io/acme/jobs/123");
    expect(res.job?.title).toBe("Software Engineer");
    expect(res.job?.companyName).toBe("Acme");
    expect(res.job?.source).toBe("greenhouse");
    expect(res.failure).toBeNull();
  });

  it("B. resolves Lever ATS URLs correctly", async () => {
    const res = await resolveAtsUrl(mockFetch, "https://jobs.lever.co/acme/abc");
    expect(res.job?.title).toBe("Backend Dev");
    expect(res.job?.companyName).toBe("acme");
    expect(res.job?.source).toBe("lever");
  });

  it("C. resolves Ashby ATS URLs correctly", async () => {
    const res = await resolveAtsUrl(mockFetch, "https://jobs.ashbyhq.com/acme/xyz");
    expect(res.job?.title).toBe("Frontend Dev");
    expect(res.job?.companyName).toBe("acme");
    expect(res.job?.source).toBe("ashby");
  });

  it("D. resolves Workable ATS URLs correctly", async () => {
    const res = await resolveAtsUrl(mockFetch, "https://apply.workable.com/acme/j/w123");
    expect(res.job?.title).toBe("Fullstack");
    expect(res.job?.companyName).toBe("acme");
    expect(res.job?.source).toBe("workable");
  });

  it("E. rejects generic company careers page", async () => {
    const res = await resolveAtsUrl(mockFetch, "https://example.com/careers");
    expect(res.job).toBeNull();
    expect(res.failure?.reason).toBe("UNSUPPORTED_SOURCE");
  });

  it("F. rejects directory pages", async () => {
    const res = await resolveAtsUrl(mockFetch, "https://boards.greenhouse.io/acme");
    expect(res.job).toBeNull();
    expect(res.failure?.reason).toBe("NOT_INDIVIDUAL_VACANCY");
  });

  it("G. rejects search result pages", async () => {
    const res = await resolveAtsUrl(mockFetch, "https://jobs.lever.co/acme");
    expect(res.job).toBeNull();
    expect(res.failure?.reason).toBe("NOT_INDIVIDUAL_VACANCY");
  });

  it("H. rejects unsupported domains", async () => {
    const res = await resolveAtsUrl(mockFetch, "https://unknownats.com/jobs/123");
    expect(res.job).toBeNull();
    expect(res.failure?.reason).toBe("UNSUPPORTED_SOURCE");
  });

  it("I. same ATS job found directly and through SearXNG merges into one JobVacancy", async () => {
    const directFound = {
      source: "greenhouse",
      applicationUrl: "https://boards.greenhouse.io/acme/jobs/123",
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/123",
      externalId: "123",
      companyName: "Acme",
      title: "Software Engineer",
      location: "Remote",
    };
    
    // SearXNG found the same ATS URL, but it might have query params
    const searxngFound = {
      source: "greenhouse",
      applicationUrl: "https://boards.greenhouse.io/acme/jobs/123?gh_src=searxng",
      sourceUrl: "https://boards.greenhouse.io/acme/jobs/123?gh_src=searxng",
      externalId: "123",
      companyName: "Acme",
      title: "Software Engineer",
      location: "Remote",
    };
    
    const decision = duplicateDecision(directFound, searxngFound);
    expect(decision.merge).toBe(true);
  });
});
