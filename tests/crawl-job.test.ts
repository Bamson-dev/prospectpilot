import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlCompanySite } from "@/lib/research/crawl";
import { extractPage } from "@/lib/research/extract";
import { routePublicBrowserTraffic } from "@/lib/research/public-browser";

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

  it.skipIf(!scrapyReady)("does not open a socket to a loopback address", async () => {
    let connections = 0;
    allowed.on("connection", () => {
      connections += 1;
    });
    const result = await crawlCompanySite({
      website: `http://127.0.0.1:${allowedPort}/`,
      domain: "127.0.0.1",
      maxPages: 2,
      maxDepth: 1,
    });
    expect(connections).toBe(0);
    expect(result?.pages).toEqual([]);
    expect(result?.note).toBe("private-network");
    expect(result?.metrics?.urlsRequested).toBe(0);
    expect(result?.metrics?.responsesReceived).toBe(0);
  }, 30000);

  it.skipIf(!scrapyReady)("does not open a socket when the loopback target returns 403", async () => {
    let connections = 0;
    blocked.on("connection", () => {
      connections += 1;
    });
    const result = await crawlCompanySite({
      website: `http://127.0.0.1:${blockedPort}/`,
      domain: "127.0.0.1",
      maxPages: 2,
      maxDepth: 1,
    });
    expect(connections).toBe(0);
    expect(result?.pages).toEqual([]);
    expect(result?.note).toBe("private-network");
  }, 30000);
});

describe("scrapy response parsing", () => {
  it.skipIf(!scrapyReady)("extracts evidence from usable HTML and counts a forbidden response", () => {
    const script = `
import json
import run as crawler
from scrapy.http import HtmlResponse, Request
crawler.RESULT = {"domain":"vered.co.za","pages":[],"emails":[],"phones":[],"socialProfiles":[],"companyName":"","description":"","services":[],"technologySignals":[],"advertisingSignals":[],"contactPages":[],"teamPages":[],"note":"","metrics":{"pagesFailed":0,"http403":0}}
spider = crawler.CompanySpider("https://vered.co.za/", "vered.co.za", 2, 1)
html = b'<html><head><title>Vered Properties</title><meta name="description" content="Johannesburg estate agency"></head><body><p>Vered Properties provides real estate services in Johannesburg. Email sales@vered.co.za or call +27 11 555 0199.</p><a href="https://www.linkedin.com/company/vered">LinkedIn</a></body></html>'
request = Request("https://vered.co.za/")
list(spider.parse(HtmlResponse(request.url, request=request, body=html, encoding="utf-8")))
forbidden = HtmlResponse(request.url, request=request, body=b"Forbidden", status=403, encoding="utf-8")
list(spider.parse(forbidden))
limited = HtmlResponse(request.url, request=request, body=b"slow down", status=429, encoding="utf-8", headers={"Retry-After": "12"})
list(spider.parse(limited))
print(json.dumps({"pages":crawler.RESULT["pages"],"emails":crawler.RESULT["emails"],"phones":crawler.RESULT["phones"],"social":crawler.RESULT["socialProfiles"],"failed":crawler.RESULT["metrics"]["pagesFailed"],"http403":crawler.RESULT["metrics"].get("http403",0),"http429":crawler.RESULT["metrics"].get("http429",0),"retryAfter":crawler.RESULT.get("retryAfter","")}))
`;
    const output = execFileSync(python, ["-c", script], { cwd: "crawler", encoding: "utf8" });
    const parsed = JSON.parse(output) as { pages: Array<{ text: string }>; emails: Array<{ value: string }>; phones: Array<{ value: string }>; social: Array<{ url: string }>; failed: number; http403: number; http429: number; retryAfter: string };
    expect(parsed.pages).toHaveLength(1);
    expect(parsed.pages[0]?.text).toContain("Johannesburg");
    expect(parsed.emails[0]?.value).toBe("sales@vered.co.za");
    expect(parsed.phones.length).toBeGreaterThan(0);
    expect(parsed.social[0]?.url).toContain("linkedin.com/company/vered");
    expect(parsed.failed).toBe(2);
    expect(parsed.http403).toBe(1);
    expect(parsed.http429).toBe(1);
    expect(parsed.retryAfter).toBe("12");
    expect(parsed.pages).toHaveLength(1);
  });
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

  it("routes every subresource through the public fetch gate", async () => {
    const browser = await launchChromium();
    const page = await browser.newPage();
    const requested: string[] = [];
    try {
      await routePublicBrowserTraffic(page, async (url) => {
        requested.push(url);
        throw new Error("private target blocked");
      });
      await page.setContent('<img src="http://intranet.example/private.png">');
      await page.waitForFunction(() => document.querySelector("img")?.complete === true);
      expect(requested).toContain("http://intranet.example/private.png");
      expect(await page.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(0);
    } finally {
      await browser.close();
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
    const home = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
    if (existsSync(home)) return chromium.launch({ executablePath: home, headless: true });
    throw error;
  }
}

function close(server: Server | undefined) {
  return new Promise<void>((resolve) => {
    if (!server) resolve();
    else server.close(() => resolve());
  });
}
