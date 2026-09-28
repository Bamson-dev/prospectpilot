import { crawlHasEvidence, type CrawlResult } from "@/lib/research/crawl";

const RETRY_AFTER_SECONDS = /retry after (\d+) seconds/i;
const MAX_RETRY_AFTER_SECONDS = 120;
const MAX_BACKOFF_MS = 120_000;
const BASE_BACKOFF_MS = 15_000;

export function retryAfterSeconds(header: string | null | undefined, nowMs = Date.now()) {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
  }
  const until = Date.parse(trimmed);
  if (Number.isNaN(until)) return null;
  const seconds = Math.ceil((until - nowMs) / 1000);
  if (seconds <= 0) return 1;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}

export function rateLimitedResearchMessage(retryAfterHeader?: string | null, nowMs = Date.now()) {
  const seconds = retryAfterSeconds(retryAfterHeader, nowMs);
  return seconds
    ? `The website returned status 429. Retry after ${seconds} seconds.`
    : "The website returned status 429.";
}

export function jobRetryDelayMs(attemptsMade: number, error?: { message?: string }, baseDelayMs = BASE_BACKOFF_MS) {
  const match = error?.message?.match(RETRY_AFTER_SECONDS);
  if (match) {
    const requested = Number(match[1]) * 1000;
    if (Number.isFinite(requested) && requested > 0) return Math.min(requested, MAX_BACKOFF_MS);
  }
  const attempt = Math.max(1, attemptsMade);
  return Math.min(Math.round(baseDelayMs * 2 ** (attempt - 1)), MAX_BACKOFF_MS);
}

export function httpFallbackDecision(status: number) {
  if (status === 429) return "retry" as const;
  if (status === 401 || status === 403) return "browser" as const;
  if (status >= 400) return "fail" as const;
  return "read" as const;
}

export function crawlRateLimited(crawl: Pick<CrawlResult, "pages" | "note" | "metrics">) {
  if (crawlHasEvidence(crawl as CrawlResult)) return false;
  return crawl.note === "http-429" || (crawl.metrics?.http429 ?? 0) > 0;
}

export function researchStatusAfterAttempt(input: { kept: boolean; current: string }) {
  if (input.kept) return input.current;
  if (input.current === "IN_PROGRESS") return "FAILED" as const;
  return input.current;
}

export function researchRetryPlan(input: { latestFetchMethod: string | null; contentLength: number }) {
  if (!input.latestFetchMethod || input.latestFetchMethod === "pending") return "research" as const;
  if (input.latestFetchMethod === "blocked") return "blocked" as const;
  if (input.contentLength > 0) return "reuse" as const;
  return "keep" as const;
}
