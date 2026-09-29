import { describe, expect, it } from "vitest";
import { duplicateDecision, sameVacancy } from "@/lib/applications/dedupe";
import { canonicalApplicationUrl } from "@/lib/applications/normalize";
import { matchesQuery, normalizeVacancy } from "@/lib/applications/job-normalize";
import { greenhouseJob, leverJob } from "@/lib/applications/job-sources";
import { analysisJobDecision, assessVacancy, discoveryRunDecision, fitState, prepareDiscoveredVacancies } from "@/lib/applications/job-pipeline";
import { discoveryBlock } from "@/lib/applications/providers";
import { seedCandidateRecord } from "@/lib/applications/seed-data";
import { jobDeliveryDecision } from "@/lib/job-state";

const greenhouse = {
  id: 10,
  title: "Software Engineer",
  company_name: "GitLab",
  absolute_url: "https://job-boards.greenhouse.io/gitlab/jobs/10/",
  location: { name: "Remote, Canada" },
  content: "<p>Build services with TypeScript. Salary range USD 100,000 to USD 120,000.</p>",
  first_published: "2026-05-22T09:16:29-04:00",
};

describe("job discovery", () => {
  it("normalizes a public vacancy without inventing missing fields", () => {
    const job = normalizeVacancy({
      source: "greenhouse",
      sourceUrl: greenhouse.absolute_url,
      applicationUrl: greenhouse.absolute_url,
      externalId: "10",
      companyName: "  GitLab  ",
      title: "Software   Engineer",
      location: "Remote, Canada",
      description: greenhouse.content,
      originalDescription: greenhouse.content,
      postedAt: greenhouse.first_published,
    });
    expect(job?.companyName).toBe("GitLab");
    expect(job?.title).toBe("Software Engineer");
    expect(job?.remoteType).toBe("remote");
    expect(job?.location).toBe("Remote, Canada");
    expect(job?.employmentType).toBeNull();
    expect(job?.salaryMin).toBe(100000);
    expect(job?.salaryMax).toBe(120000);
    expect(job?.salaryCurrency).toBe("USD");
    expect(job?.technologies).toContain("typescript");
    expect(job?.description).toContain("Build services with TypeScript");
    expect(job?.originalDescription).toContain("<p>");
    expect(job?.originalSourceUrl).toBe(greenhouse.absolute_url);
    expect(canonicalApplicationUrl(greenhouse.absolute_url)).toBe("https://job-boards.greenhouse.io/gitlab/jobs/10");
    expect(normalizeVacancy({ ...job!, description: "short", companyName: "GitLab", title: "Engineer", source: "greenhouse", sourceUrl: "https://example.com/a", applicationUrl: "https://example.com/a" })).toBeNull();
  });

  it("merges the same job and keeps different URLs apart", () => {
    const left = { companyName: "GitLab", title: "Software Engineer", applicationUrl: "https://job-boards.greenhouse.io/gitlab/jobs/10/", location: "Remote", externalId: "10" };
    const right = { companyName: "gitlab", title: "Software Engineer", applicationUrl: "https://job-boards.greenhouse.io/gitlab/jobs/10", location: "Remote, Canada", externalId: "10" };
    expect(duplicateDecision(left, right)).toMatchObject({ merge: true, reason: "canonical application URL" });
    expect(sameVacancy(
      { companyName: "GitLab", title: "Software Engineer", applicationUrl: "https://jobs.example/a", location: "Remote" },
      { companyName: "GitLab", title: "Software Engineer", applicationUrl: "https://jobs.example/b", location: "Remote" },
    )).toBe(false);
    const prepared = prepareDiscoveredVacancies([
      { source: "greenhouse", sourceUrl: left.applicationUrl, applicationUrl: left.applicationUrl, externalId: "10", companyName: "GitLab", title: "Software Engineer", location: "Remote", description: greenhouse.content },
      { source: "greenhouse", sourceUrl: right.applicationUrl, applicationUrl: right.applicationUrl, externalId: "10", companyName: "GitLab", title: "Software Engineer", location: "Remote", description: greenhouse.content },
    ], "engineer");
    expect(prepared.kept).toHaveLength(1);
    expect(prepared.duplicateReasons).toEqual(["canonical application URL"]);
  });

  it("keeps source fields and parses public board payloads", () => {
    const parsed = greenhouseJob(greenhouse);
    expect(parsed?.source).toBe("greenhouse");
    expect(parsed?.companyName).toBe("GitLab");
    expect(parsed?.externalId).toBe("10");
    const lever = leverJob("spotify", {
      id: "abc",
      text: "Android Engineer",
      hostedUrl: "https://jobs.lever.co/spotify/abc",
      applyUrl: "https://jobs.lever.co/spotify/abc/apply",
      descriptionPlain: "Build Android applications for Spotify listeners across phones.",
      categories: { commitment: "Permanent", location: "London" },
      workplaceType: "hybrid",
      createdAt: Date.parse("2026-01-02T00:00:00Z"),
    });
    expect(lever?.companyName).toBe("spotify");
    expect(lever?.employmentType).toBe("Permanent");
    expect(lever?.workplaceType).toBe("hybrid");
    expect(lever?.applicationUrl).toContain("/apply");
    expect(matchesQuery({ title: "Android Engineer", description: "" }, "software engineer")).toBe(true);
  });

  it("extracts stated requirements and does not treat JavaScript as Vue", () => {
    const candidate = seedCandidateRecord();
    const assessed = assessVacancy({
      title: "Frontend Engineer",
      companyName: "Example",
      description: "JavaScript or Vue.js experience is helpful. TypeScript is required.",
      applicationUrl: "https://jobs.example/frontend",
    }, candidate);
    expect(assessed.requirements.some((item) => /typescript/i.test(item.text) || /vue/i.test(item.text) || /javascript/i.test(item.text))).toBe(true);
    const vue = assessed.fit.selections.find((item) => /vue/i.test(item.requirement));
    expect(vue?.match === "DIRECT" && /vue/i.test(vue.evidence ?? "")).not.toBe(true);
    expect(fitState({ recommendation: "REVIEW" })).toBe("REVIEW");
    expect(fitState({ recommendation: "PREPARE" })).toBe("QUALIFIED");
    expect(fitState({ recommendation: "DO_NOT_PREPARE" })).toBe("NOT_READY");
  });

  it("does not queue a second analysis or discovery run, and reclaims a crashed job", () => {
    expect(analysisJobDecision("COMPLETED")).toBe("skip");
    expect(analysisJobDecision("ACTIVE")).toBe("skip");
    expect(analysisJobDecision("FAILED")).toBe("retry");
    expect(analysisJobDecision(null)).toBe("create");
    expect(discoveryRunDecision(["software engineer"], " Software Engineer ")).toBe("skip");
    expect(discoveryRunDecision([], "software engineer")).toBe("create");
    expect(jobDeliveryDecision({ state: "ACTIVE", attempts: 1, maxAttempts: 3, startedAtMs: Date.now() - 60_000, nowMs: Date.now() })).toBe("reclaim");
    expect(discoveryBlock(429, "ok")).toBe("blocked");
    expect(discoveryBlock(200, "Just a moment")).toBe("blocked");
  });
});
