import { describe, expect, it } from "vitest";
import { browserSearchBlocked, parseBrowserResults } from "@/lib/discovery/providers";
import { canonicalDomain, companyWebsiteFromDirectory, dedupeQueries, extractEmails, extractPhones, isListingPortal, normalizeEmail, sameCompany } from "@/lib/discovery/normalize";
import { parseSearxngResults } from "@/lib/discovery/searxng";
import { discoverySourceCatalog } from "@/lib/discovery/status";
import { companyAnalysisPrompt } from "@/lib/ai/prompts";
import { companyAnalysisSchema } from "@/lib/ai/schemas";
import { needsBrowserRender, pageAccessBlocked, shouldUsePlaywright } from "@/lib/research/browser-decision";
import { analysisRetryDecision, qualificationEvidence, shouldStoreQualificationDraft } from "@/lib/research/evidence";
import { parseCrawlResult } from "@/lib/research/crawl";
import { buildDiscoveryQueries } from "@/lib/search/queries";
import { isBlockedIp } from "@/lib/network";

describe("discovery providers", () => {
  it("parses SearXNG results and ignores malformed rows", () => {
    const hits = parseSearxngResults({
      results: [
        { title: "ABC Properties", url: "https://www.abcproperties.co.za/", content: "Estate agents" },
        { title: "Missing url" },
        "nope",
        { title: "Relative", url: "/local" },
      ],
    }, "estate agents Johannesburg", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.sourceName).toBe("searxng");
    expect(parseSearxngResults(null, "q", 5)).toEqual([]);
    expect(parseSearxngResults({ results: "bad" }, "q", 5)).toEqual([]);
  });

  it("canonicalizes domains and refuses name-only merges", () => {
    expect(canonicalDomain("https://www.example.com/about")).toBe("example.com");
    expect(canonicalDomain("http://example.com")).toBe("example.com");
    expect(sameCompany({ website: "https://www.example.com/" }, { domain: "example.com" })).toBe(true);
    expect(sameCompany({ website: "https://abcproperties.co.za" }, { website: "https://other.co.za" })).toBe(false);
    expect(isListingPortal("property24.com")).toBe(true);
    expect(isListingPortal("www.privateproperty.co.za")).toBe(true);
    expect(isListingPortal("agency.co.za")).toBe(false);
    expect(isListingPortal("www.goodfirms.co")).toBe(true);
    expect(isListingPortal("vered.co.za")).toBe(false);
  });

  it("resolves a company website from a directory listing and keeps the directory when none is present", () => {
    const resolved = companyWebsiteFromDirectory({
      listingUrl: "https://www.goodfirms.co/real-estate-companies/johannesburg",
      title: "Real estate companies",
      snippet: "Vered Properties https://www.vered.co.za/ serves Johannesburg.",
    });
    expect(resolved?.domain).toBe("vered.co.za");
    expect(companyWebsiteFromDirectory({
      listingUrl: "https://www.goodfirms.co/real-estate-companies/johannesburg",
      title: "Real estate companies",
      snippet: "A ranked list with no company website.",
    })).toBe(null);
  });

  it("dedupes queries and keeps a Johannesburg real-estate set small", () => {
    const queries = buildDiscoveryQueries({
      industry: "Real estate",
      city: "Johannesburg",
      country: "South Africa",
      searchTerms: "estate agencies\nestate agencies",
      excludedKeywords: "property developers",
      maxQueries: 6,
    });
    expect(dedupeQueries(queries)).toEqual(queries);
    expect(queries.some((query) => query.includes("Johannesburg"))).toBe(true);
    expect(queries.some((query) => /property developers/i.test(query))).toBe(false);
    expect(queries.length).toBeLessThanOrEqual(6);
  });

  it("keeps observed emails and drops garbage", () => {
    expect(normalizeEmail("info@example.com")).toBe(null);
    expect(extractEmails("Write to hello@agency.co.za or logo@agency.co.za.png")).toEqual(["hello@agency.co.za"]);
    expect(extractPhones("Call +27 11 555 0101 today")).toEqual(["+27115550101"]);
  });

  it("asks for a browser only when the HTML page is thin or blocked", () => {
    expect(needsBrowserRender("short", "<html><script></script></html>")).toBe(true);
    expect(needsBrowserRender("x".repeat(600), "<html><p>content</p></html>")).toBe(false);
    expect(shouldUsePlaywright({ httpStatus: 403, excerpt: "", html: "", scrapySufficient: false })).toBe(true);
    expect(shouldUsePlaywright({ httpStatus: 403, excerpt: "", html: "", scrapySufficient: true })).toBe(false);
    expect(shouldUsePlaywright({ httpStatus: 200, excerpt: "x".repeat(600), html: "<html><p>content</p></html>", scrapySufficient: false })).toBe(false);
    expect(pageAccessBlocked({ status: 403, html: "<html>ok</html>" })).toBe(true);
    expect(pageAccessBlocked({ html: "<html>verify you are human</html>" })).toBe(true);
    expect(pageAccessBlocked({ status: 200, html: "<html><p>office</p></html>" })).toBe(false);
  });

  it("keeps personalization angles inside 400 characters and retries once", () => {
    const valid = analysis({ personalizationAngle: "A".repeat(400) });
    expect(companyAnalysisSchema.parse(valid).personalizationAngle).toHaveLength(400);
    expect(() => companyAnalysisSchema.parse(analysis({ personalizationAngle: "A".repeat(401) }))).toThrow(/400/);
    expect(companyAnalysisPrompt("evidence")[1]?.content).toContain("maximum 400 characters");
    expect(analysisRetryDecision(0, "String must contain at most 400 character(s)")).toBe("retry");
    expect(analysisRetryDecision(1, "String must contain at most 400 character(s)")).toBe("fail");
    expect(shouldStoreQualificationDraft("DRAFT")).toBe(false);
    expect(shouldStoreQualificationDraft("PENDING_APPROVAL")).toBe(false);
    expect(shouldStoreQualificationDraft(null)).toBe(true);
  });

  it("labels page research separately from a blocked or snippet-only result", () => {
    const page = qualificationEvidence({
      companyName: "Vered",
      domain: "vered.co.za",
      website: "https://www.vered.co.za/",
      fetchMethod: "http",
      excerpt: "Estate agency in Johannesburg",
      signals: {},
      sources: [{ sourceType: "SEARCH", sourceUrl: "https://www.vered.co.za/", query: "real estate agencies Johannesburg" }],
    });
    expect(page).toContain("page text fetched by http");
    expect(page).toContain("real estate agencies Johannesburg");
    expect(page).not.toContain("search snippet");
    const blocked = qualificationEvidence({
      companyName: "GoodFirms",
      domain: "goodfirms.co",
      fetchMethod: "blocked",
      excerpt: "",
      signals: { status: 403 },
      sources: [{ sourceType: "DIRECTORY", sourceUrl: "https://www.goodfirms.co/real-estate-companies/johannesburg", query: "agencies" }],
    });
    expect(blocked).toContain("not website research");
    expect(blocked).toContain("DIRECTORY");
  });

  it("accepts a crawler contract and rejects a broken one", () => {
    const parsed = parseCrawlResult({
      domain: "example.com",
      pages: [{ url: "https://example.com", text: "A".repeat(300) }],
      emails: [{ value: "hello@example.com", sourceUrl: "https://example.com/contact" }],
      phones: [],
      socialProfiles: [],
      companyName: "Example",
      description: "Agents",
      services: [],
      technologySignals: [],
      advertisingSignals: ["google-tag"],
      contactPages: ["https://example.com/contact"],
      teamPages: [],
    });
    expect(parsed?.emails[0]?.value).toBe("hello@example.com");
    expect(parsed?.metrics?.pagesExtracted).toBe(0);
    expect(parseCrawlResult({
      domain: "example.com",
      pages: [],
      metrics: { urlsRequested: 2, responsesReceived: 1, pagesExtracted: 0, pagesFailed: 1, http403: 1, emailsFound: 0, phonesFound: 0, socialLinksFound: 0 },
    })?.metrics).toMatchObject({ urlsRequested: 2, responsesReceived: 1, http403: 1, pagesFailed: 1 });
    expect(parseCrawlResult({ pages: [] })).toBe(null);
  });

  it("stops browser search when a page asks for a captcha", () => {
    expect(browserSearchBlocked("<html>verify you are human</html>")).toBe(true);
    expect(parseBrowserResults('<a href="https://agency.co.za">Agency</a>', "query", 5)[0]?.url).toBe("https://agency.co.za");
  });

  it("shows Google as disabled and Brave as not configured", () => {
    const saved = process.env.GOOGLE_CSE_ENABLED;
    process.env.GOOGLE_CSE_ENABLED = "false";
    const catalog = discoverySourceCatalog();
    expect(catalog.find((item) => item.name === "Google CSE")?.state).toBe("Disabled");
    expect(catalog.find((item) => item.name === "Brave")?.state).toBe("Not configured");
    if (saved == null) delete process.env.GOOGLE_CSE_ENABLED;
    else process.env.GOOGLE_CSE_ENABLED = saved;
  });

  it("still blocks private research targets", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
  });
});

function analysis(override: { personalizationAngle: string }) {
  const assessment = { score: 10, interpretation: "Observed from the page.", confidence: 40, evidence: ["The page describes estate agency services."] };
  return {
    summary: "A Johannesburg estate agency.",
    painPoints: ["No online booking was observed."],
    opportunityScore: 20,
    opportunityReason: "The public page describes property services.",
    recommendedService: "Website enquiry form",
    suggestedOpening: "I read the public services page.",
    software: assessment,
    advertising: assessment,
    automation: assessment,
    ...override,
  };
}
