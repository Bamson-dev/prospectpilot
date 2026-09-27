import { describe, expect, it } from "vitest";
import { browserSearchBlocked, parseBrowserResults } from "@/lib/discovery/providers";
import { canonicalDomain, dedupeQueries, extractEmails, extractPhones, isListingPortal, normalizeEmail, sameCompany } from "@/lib/discovery/normalize";
import { parseSearxngResults } from "@/lib/discovery/searxng";
import { discoverySourceCatalog } from "@/lib/discovery/status";
import { needsBrowserRender } from "@/lib/research/browser-decision";
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

  it("asks for a browser only when the HTML page is thin", () => {
    expect(needsBrowserRender("short", "<html><script></script></html>")).toBe(true);
    expect(needsBrowserRender("x".repeat(600), "<html><p>content</p></html>")).toBe(false);
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
