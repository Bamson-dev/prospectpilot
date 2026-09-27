import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlCompanySite, crawlHasEvidence } from "@/lib/research/crawl";
import { extractPage } from "@/lib/research/extract";

const python = process.env.CRAWLER_PYTHON || "/tmp/pp-crawl-venv/bin/python";
const scrapyReady = existsSync(python);
const body = `${"Vered Properties is a Johannesburg estate agency with a public office. ".repeat(8)} Email sales@vered.co.za or call +27 11 555 0199. <a href="https://www.linkedin.com/company/vered">LinkedIn</a>`;

describe("scrapy crawl job", () => {
  let allowed: Server;
  let blocked: Server;
  let allowedPort = 0;
  let blockedPort = 0;

  beforeAll(async () => {
    process.env.CRAWLER_PYTHON = python;
    allowed = createServer((request, response) => {
      if (request.url === "/robots.txt") {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("User-agent: *\nAllow: /\n");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<html><head><title>Vered Properties</title></head><body><p>${body}</p></body></html>`);
    });
    blocked = createServer((request, response) => {
      if (request.url === "/robots.txt") {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("User-agent: *\nAllow: /\n");
        return;
      }
      response.writeHead(403, { "Content-Type": "text/html" });
      response.end("<html><body>Forbidden</body></html>");
    });
    await new Promise<void>((resolve) => allowed.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => blocked.listen(0, "127.0.0.1", resolve));
    allowedPort = (allowed.address() as { port: number }).port;
    blockedPort = (blocked.address() as { port: number }).port;
  });

  afterAll(async () => {
    await Promise.all([close(allowed), close(blocked)]);
  });

  it.skipIf(!scrapyReady)("extracts a public page and records crawl counts", async () => {
    const result = await crawlCompanySite({
      website: `http://127.0.0.1:${allowedPort}/`,
      domain: "127.0.0.1",
      maxPages: 2,
      maxDepth: 1,
    });
    expect(result?.pages.length).toBeGreaterThan(0);
    expect(crawlHasEvidence(result!)).toBe(true);
    expect(result?.metrics?.urlsRequested).toBeGreaterThan(0);
    expect(result?.metrics?.responsesReceived).toBeGreaterThan(0);
    expect(result?.metrics?.pagesExtracted).toBe(result?.pages.length);
    expect(result?.emails.some((item) => item.value === "sales@vered.co.za")).toBe(true);
    expect((result?.metrics?.emailsFound ?? 0)).toBeGreaterThan(0);
    expect((result?.metrics?.phonesFound ?? 0)).toBeGreaterThan(0);
    expect((result?.metrics?.socialLinksFound ?? 0)).toBeGreaterThan(0);
    expect(result?.note).not.toBe("");
  }, 30000);

  it.skipIf(!scrapyReady)("records HTTP 403 without saving the page", async () => {
    const result = await crawlCompanySite({
      website: `http://127.0.0.1:${blockedPort}/`,
      domain: "127.0.0.1",
      maxPages: 2,
      maxDepth: 1,
    });
    expect(result?.pages).toEqual([]);
    expect(result?.metrics?.http403).toBeGreaterThan(0);
    expect(result?.metrics?.pagesFailed).toBeGreaterThan(0);
    expect(result?.metrics?.urlsRequested).toBeGreaterThan(0);
    expect(result?.note).toBe("http-403");
  }, 30000);
});

describe("playwright rendered page", () => {
  it("ingests text that exists only after JavaScript runs", async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      if (request.url === "/raw") {
        response.end("<html><body><div id='app'></div><script>document.getElementById('app').textContent = '" + "Johannesburg estate agency public office. ".repeat(20) + "';</script></body></html>");
        return;
      }
      response.end("<html><body>empty</body></html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const browser = await launchChromium();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/raw`, { waitUntil: "domcontentloaded" });
      const html = await page.content();
      const ingested = extractPage(html, `http://127.0.0.1:${port}/raw`);
      expect(ingested.excerpt).toContain("Johannesburg estate agency");
      expect(ingested.excerpt.length).toBeGreaterThan(280);
      const raw = extractPage("<html><body><div id='app'></div></body></html>", `http://127.0.0.1:${port}/raw`);
      expect(raw.excerpt).not.toContain("Johannesburg estate agency");
    } finally {
      await browser.close();
      await close(server);
    }
  }, 30000);
});

async function launchChromium() {
  const { chromium } = await import("playwright");
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const hinted = message.match(/Executable doesn't exist at (\S+)/);
    const arm = hinted?.[1]?.replace("mac-x64", "mac-arm64");
    if (arm && arm !== hinted?.[1] && existsSync(arm)) return chromium.launch({ executablePath: arm, headless: true });
    throw error;
  }
}

function close(server: Server | undefined) {
  return new Promise<void>((resolve) => {
    if (!server) resolve();
    else server.close(() => resolve());
  });
}
