import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { logInfo } from "@/lib/logger";

export type CrawlPage = {
  url: string;
  title?: string;
  text?: string;
};

export type CrawlResult = {
  domain: string;
  pages: CrawlPage[];
  emails: Array<{ value: string; sourceUrl: string }>;
  phones: Array<{ value: string; sourceUrl: string }>;
  socialProfiles: Array<{ url: string; sourceUrl: string }>;
  companyName: string;
  description: string;
  services: string[];
  technologySignals: string[];
  advertisingSignals: string[];
  contactPages: string[];
  teamPages: string[];
  note?: string;
  retryAfter?: string;
  metrics?: CrawlMetrics;
};

export type CrawlMetrics = {
  urlsRequested: number;
  responsesReceived: number;
  pagesExtracted: number;
  pagesFailed: number;
  http403: number;
  http429: number;
  emailsFound: number;
  phonesFound: number;
  socialLinksFound: number;
};

export function parseCrawlResult(value: unknown): CrawlResult | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<CrawlResult>;
  if (typeof row.domain !== "string" || !Array.isArray(row.pages)) return null;
  return {
    domain: row.domain,
    pages: row.pages.filter((page) => page && typeof page.url === "string").slice(0, 20),
    emails: arrayOf(row.emails),
    phones: arrayOf(row.phones),
    socialProfiles: arrayOf(row.socialProfiles),
    companyName: typeof row.companyName === "string" ? row.companyName.slice(0, 160) : "",
    description: typeof row.description === "string" ? row.description.slice(0, 1000) : "",
    services: strings(row.services),
    technologySignals: strings(row.technologySignals),
    advertisingSignals: strings(row.advertisingSignals),
    contactPages: strings(row.contactPages),
    teamPages: strings(row.teamPages),
    note: typeof row.note === "string" ? row.note.slice(0, 80) : "",
    retryAfter: typeof (value as { retryAfter?: unknown }).retryAfter === "string"
      ? (value as { retryAfter: string }).retryAfter.slice(0, 40)
      : "",
    metrics: metricsOf((value as { metrics?: unknown }).metrics),
  };
}

function metricsOf(value: unknown): CrawlMetrics {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const count = (key: string) => (typeof row[key] === "number" ? row[key] : 0);
  return {
    urlsRequested: count("urlsRequested"),
    responsesReceived: count("responsesReceived"),
    pagesExtracted: count("pagesExtracted"),
    pagesFailed: count("pagesFailed"),
    http403: count("http403"),
    http429: count("http429"),
    emailsFound: count("emailsFound"),
    phonesFound: count("phonesFound"),
    socialLinksFound: count("socialLinksFound"),
  };
}

export function crawlHasEvidence(result: CrawlResult) {
  return result.pages.some((page) => (page.text ?? "").trim().length >= 280);
}

export function crawlOutcome(input: { code: number; stderr: string; parsed: boolean }) {
  if (input.code !== 0 || /ImportError|Traceback \(most recent call last\)/.test(input.stderr) || !input.parsed) {
    return "failed" as const;
  }
  return "result" as const;
}

export async function crawlCompanySite(input: { website: string; domain: string; maxPages: number; maxDepth: number }) {
  const script = path.join(process.cwd(), "crawler", "run.py");
  const directory = await mkdtemp(path.join(tmpdir(), "pp-crawl-"));
  const jobPath = path.join(directory, "job.json");
  const outPath = path.join(directory, "out.json");
  await writeFile(jobPath, JSON.stringify({
    website: input.website,
    domain: input.domain,
    maxPages: Math.min(Math.max(input.maxPages, 1), 20),
    maxDepth: Math.min(Math.max(input.maxDepth, 1), 3),
  }));
  logInfo("research.crawl.started", { domain: input.domain });
  const run = await runPython(script, [jobPath, outPath]);
  try {
    let parsed: CrawlResult | null = null;
    if (run.code === 0 && !crawlerStartupFailed(run.stderr)) {
      try {
        parsed = parseCrawlResult(JSON.parse(await readFile(outPath, "utf8")));
      } catch {
        parsed = null;
      }
    }
    if (crawlOutcome({ code: run.code, stderr: run.stderr, parsed: Boolean(parsed) }) === "failed" || !parsed) {
      logInfo("research.crawl.failed", {
        domain: input.domain,
        code: run.code,
        reason: crawlerStartupFailed(run.stderr) ? "crawler-startup" : run.code !== 0 ? "exit" : "malformed",
      });
      throw new AppError("The crawler stopped before producing a result.");
    }
    logInfo("research.crawl.completed", {
      domain: input.domain,
      pages: parsed.pages.length,
      note: parsed.note || "",
      urlsRequested: parsed.metrics?.urlsRequested ?? 0,
      responsesReceived: parsed.metrics?.responsesReceived ?? 0,
      pagesExtracted: parsed.metrics?.pagesExtracted ?? parsed.pages.length,
      pagesFailed: parsed.metrics?.pagesFailed ?? 0,
      http403: parsed.metrics?.http403 ?? 0,
      http429: parsed.metrics?.http429 ?? 0,
      emailsFound: parsed.metrics?.emailsFound ?? parsed.emails.length,
      phonesFound: parsed.metrics?.phonesFound ?? parsed.phones.length,
      socialLinksFound: parsed.metrics?.socialLinksFound ?? parsed.socialProfiles.length,
    });
    return parsed;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function crawlerStartupFailed(stderr: string) {
  return /ImportError|Traceback \(most recent call last\)/.test(stderr);
}

function runPython(script: string, args: string[]) {
  return new Promise<{ code: number; stderr: string }>((resolve) => {
    const child = spawn(process.env.CRAWLER_PYTHON || "python3", [script, ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), 70000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: 1, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

function strings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 20);
}

function arrayOf<T extends { sourceUrl?: string }>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is T => Boolean(item) && typeof item === "object" && typeof (item as { sourceUrl?: string }).sourceUrl === "string").slice(0, 30);
}
