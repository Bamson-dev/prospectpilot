import { describe, expect, it } from "vitest";
import { isPermanentJobError, jobDeliveryDecision } from "@/lib/job-state";
import { crawlHasEvidence, crawlOutcome, parseCrawlResult } from "@/lib/research/crawl";
import {
  crawlRateLimited,
  httpFallbackDecision,
  jobRetryDelayMs,
  rateLimitedResearchMessage,
  researchRetryPlan,
  researchStatusAfterAttempt,
  retryAfterSeconds,
} from "@/lib/research/failure";

describe("research failure handling", () => {
  it("treats HTTP 429 as a retry instead of success or a browser bypass", () => {
    expect(httpFallbackDecision(429)).toBe("retry");
    expect(httpFallbackDecision(401)).toBe("browser");
    expect(httpFallbackDecision(403)).toBe("browser");
    expect(httpFallbackDecision(500)).toBe("fail");
    expect(httpFallbackDecision(200)).toBe("read");
    const message = rateLimitedResearchMessage(null);
    expect(message).toBe("The website returned status 429.");
    expect(isPermanentJobError(message)).toBe(false);
  });

  it("uses Retry-After when the site provides one and caps the wait", () => {
    expect(retryAfterSeconds("12")).toBe(12);
    expect(retryAfterSeconds("500")).toBe(120);
    expect(retryAfterSeconds("0")).toBeNull();
    expect(retryAfterSeconds("soon")).toBeNull();
    const now = Date.parse("2026-09-28T09:41:00.000Z");
    expect(retryAfterSeconds(new Date(now + 25_000).toUTCString(), now)).toBe(25);
    expect(jobRetryDelayMs(1, new Error(rateLimitedResearchMessage("12")))).toBe(12_000);
    expect(jobRetryDelayMs(2, new Error(rateLimitedResearchMessage("500")))).toBe(120_000);
  });

  it("keeps bounded exponential backoff and a terminal state after retries are exhausted", () => {
    expect(jobRetryDelayMs(1, new Error("The website returned status 429."))).toBe(15_000);
    expect(jobRetryDelayMs(2, new Error("The website returned status 429."))).toBe(30_000);
    expect(jobRetryDelayMs(3, new Error("The website returned status 429."))).toBe(60_000);
    expect(jobRetryDelayMs(4, new Error("The website returned status 429."))).toBe(120_000);
    expect(jobDeliveryDecision({
      state: "FAILED",
      attempts: 2,
      maxAttempts: 3,
      startedAtMs: 1,
      nowMs: 2,
    })).toBe("run");
    expect(jobDeliveryDecision({
      state: "FAILED",
      attempts: 3,
      maxAttempts: 3,
      startedAtMs: 1,
      nowMs: 2,
    })).toBe("skip");
    expect(jobDeliveryDecision({
      state: "ACTIVE",
      attempts: 3,
      maxAttempts: 3,
      startedAtMs: 0,
      nowMs: 45_000,
    })).toBe("exhausted");
  });

  it("propagates a crawler crash instead of treating it as an empty success", () => {
    expect(crawlOutcome({ code: 1, stderr: "", parsed: false })).toBe("failed");
    expect(crawlOutcome({ code: 0, stderr: "Traceback (most recent call last):\nImportError: scrapy", parsed: false })).toBe("failed");
    expect(crawlOutcome({ code: 0, stderr: "", parsed: false })).toBe("failed");
    expect(crawlOutcome({ code: 0, stderr: "", parsed: true })).toBe("result");
  });

  it("does not treat failed or rate-limited crawls as successful research", () => {
    const limited = parseCrawlResult({
      domain: "myproperty.co.za",
      pages: [],
      note: "http-429",
      retryAfter: "12",
      metrics: { urlsRequested: 4, responsesReceived: 4, pagesExtracted: 0, pagesFailed: 4, http403: 0, http429: 4, emailsFound: 0, phonesFound: 0, socialLinksFound: 0 },
    });
    expect(limited?.retryAfter).toBe("12");
    expect(limited && crawlHasEvidence(limited)).toBe(false);
    expect(limited && crawlRateLimited(limited)).toBe(true);
    const failedPages = parseCrawlResult({
      domain: "example.com",
      pages: [{ url: "https://example.com", text: "short" }],
      note: "finished",
      metrics: { urlsRequested: 2, responsesReceived: 2, pagesExtracted: 0, pagesFailed: 2, http403: 0, http429: 0, emailsFound: 0, phonesFound: 0, socialLinksFound: 0 },
    });
    expect(failedPages && crawlHasEvidence(failedPages)).toBe(false);
    expect(failedPages && crawlRateLimited(failedPages)).toBe(false);
    const evidenced = parseCrawlResult({
      domain: "example.com",
      pages: [{ url: "https://example.com", text: "A".repeat(280) }],
      note: "http-429",
      metrics: { http429: 1, pagesFailed: 1, pagesExtracted: 1, urlsRequested: 2, responsesReceived: 2, http403: 0, emailsFound: 0, phonesFound: 0, socialLinksFound: 0 },
    });
    expect(evidenced && crawlRateLimited(evidenced)).toBe(false);
  });

  it("clears IN_PROGRESS when the processor throws and leaves a finished attempt alone", () => {
    expect(researchStatusAfterAttempt({ kept: false, current: "IN_PROGRESS" })).toBe("FAILED");
    expect(researchStatusAfterAttempt({ kept: true, current: "COMPLETED" })).toBe("COMPLETED");
    expect(researchStatusAfterAttempt({ kept: true, current: "FAILED" })).toBe("FAILED");
    expect(researchStatusAfterAttempt({ kept: false, current: "PENDING" })).toBe("PENDING");
  });

  it("reuses an existing research result instead of creating another record or qualification", () => {
    expect(researchRetryPlan({ latestFetchMethod: null, contentLength: 0 })).toBe("research");
    expect(researchRetryPlan({ latestFetchMethod: "pending", contentLength: 0 })).toBe("research");
    expect(researchRetryPlan({ latestFetchMethod: "scrapy", contentLength: 4000 })).toBe("reuse");
    expect(researchRetryPlan({ latestFetchMethod: "playwright", contentLength: 300 })).toBe("reuse");
    expect(researchRetryPlan({ latestFetchMethod: "http", contentLength: 0 })).toBe("keep");
    expect(researchRetryPlan({ latestFetchMethod: "blocked", contentLength: 0 })).toBe("blocked");
  });
});
