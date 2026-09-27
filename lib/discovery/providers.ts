import { AppError } from "@/lib/errors";
import type { DiscoveryHit, DiscoveryInput, DiscoveryProvider, ProviderHealth } from "@/lib/discovery/types";
import { parseSearxngResults, SearXNGProvider, searxngEnabled, searxngSearch } from "@/lib/discovery/searxng";

const DIRECTORY_HOSTS = (process.env.DIRECTORY_HOSTS ?? "")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter((item) => item.includes(".") && !item.includes(" "));

export class DirectoryDiscoveryProvider implements DiscoveryProvider {
  getName() {
    return "directory";
  }

  isEnabled() {
    return process.env.DIRECTORY_DISCOVERY_ENABLED === "true" && DIRECTORY_HOSTS.length > 0 && searxngEnabled();
  }

  async discover(input: DiscoveryInput): Promise<DiscoveryHit[]> {
    if (!this.isEnabled()) return [];
    const host = DIRECTORY_HOSTS[0];
    const payload = await searxngSearch({ ...input, query: `${input.query} site:${host}`, limit: input.limit });
    return parseSearxngResults(payload, input.query, input.limit).map((hit) => ({
      ...hit,
      sourceType: "directory",
      sourceName: host,
    }));
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (process.env.DIRECTORY_DISCOVERY_ENABLED !== "true") return { ok: false, detail: "Disabled" };
    if (DIRECTORY_HOSTS.length === 0) return { ok: false, detail: "Not configured" };
    return { ok: true, detail: "Configured" };
  }
}

export class MapDiscoveryProvider implements DiscoveryProvider {
  getName() {
    return "map";
  }

  isEnabled() {
    return false;
  }

  async discover(): Promise<DiscoveryHit[]> {
    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { ok: false, detail: process.env.MAP_DISCOVERY_ENABLED === "true" ? "Not configured" : "Disabled" };
  }
}

export class SocialDiscoveryProvider implements DiscoveryProvider {
  getName() {
    return "social";
  }

  isEnabled() {
    return process.env.SOCIAL_DISCOVERY_ENABLED === "true" && searxngEnabled();
  }

  async discover(input: DiscoveryInput): Promise<DiscoveryHit[]> {
    if (!this.isEnabled()) return [];
    const payload = await searxngSearch({
      ...input,
      query: `${input.query} site:linkedin.com/company`,
      limit: Math.min(input.limit, 5),
    });
    return parseSearxngResults(payload, input.query, input.limit)
      .filter((hit) => /linkedin\.com|facebook\.com|instagram\.com/i.test(hit.url))
      .map((hit) => ({ ...hit, sourceType: "social", sourceName: "public-social" }));
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (process.env.SOCIAL_DISCOVERY_ENABLED !== "true") return { ok: false, detail: "Disabled" };
    return { ok: searxngEnabled(), detail: searxngEnabled() ? "Configured" : "Not configured" };
  }
}

export class BrowserSearchProvider implements DiscoveryProvider {
  getName() {
    return "browser-search";
  }

  isEnabled() {
    return process.env.BROWSER_SEARCH_ENABLED === "true" && Boolean(process.env.BROWSER_SEARCH_URL?.includes("{query}"));
  }

  async discover(input: DiscoveryInput): Promise<DiscoveryHit[]> {
    if (!this.isEnabled()) return [];
    const template = process.env.BROWSER_SEARCH_URL ?? "";
    const target = template.replaceAll("{query}", encodeURIComponent(input.query));
    const html = await renderSearchPage(target);
    if (browserSearchBlocked(html)) throw new AppError("Browser search is unavailable (captcha).");
    return parseBrowserResults(html, input.query, input.limit);
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.isEnabled()) return { ok: false, detail: "Disabled" };
    return { ok: true, detail: "Configured" };
  }
}

export class GoogleCseProvider implements DiscoveryProvider {
  getName() {
    return "google-cse";
  }

  isEnabled() {
    return process.env.GOOGLE_CSE_ENABLED === "true" && Boolean(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX);
  }

  async discover(input: DiscoveryInput): Promise<DiscoveryHit[]> {
    if (!this.isEnabled()) throw new AppError("Google Custom Search is disabled.");
    const { getSearchProvider } = await import("@/lib/search/google");
    const hits = await getSearchProvider().search(input.query, { limit: input.limit });
    return hits.map((hit) => ({
      title: hit.title,
      url: hit.url,
      snippet: hit.snippet,
      sourceType: "search",
      sourceName: "google-cse",
      query: input.query,
    }));
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { ok: false, detail: this.isEnabled() ? "Enabled" : "Disabled" };
  }
}

export class BraveSearchProvider implements DiscoveryProvider {
  getName() {
    return "brave";
  }

  isEnabled() {
    return false;
  }

  async discover(): Promise<DiscoveryHit[]> {
    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { ok: false, detail: "Not configured" };
  }
}

export function browserSearchBlocked(html: string) {
  return /captcha|unusual traffic|verify you are human|are you a robot/i.test(html);
}

export function parseBrowserResults(html: string, query: string, limit: number): DiscoveryHit[] {
  const hits: DiscoveryHit[] = [];
  const pattern = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/gi;
  let match = pattern.exec(html);
  while (match && hits.length < limit) {
    const url = match[1];
    const title = match[2].replace(/<[^>]+>/g, "").trim();
    if (title && !browserSearchBlocked(url)) {
      hits.push({ title, url, snippet: "", sourceType: "browser", sourceName: "browser-search", query });
    }
    match = pattern.exec(html);
  }
  return hits;
}

async function renderSearchPage(url: string) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

export function discoveryProviders(flags: { directory: boolean; map: boolean; social: boolean }) {
  const providers: DiscoveryProvider[] = [];
  const search = new SearXNGProvider();
  if (search.isEnabled()) providers.push(search);
  const directory = new DirectoryDiscoveryProvider();
  if (flags.directory && directory.isEnabled()) providers.push(directory);
  const map = new MapDiscoveryProvider();
  if (flags.map && map.isEnabled()) providers.push(map);
  const social = new SocialDiscoveryProvider();
  if (flags.social && social.isEnabled()) providers.push(social);
  const browser = new BrowserSearchProvider();
  if (browser.isEnabled()) providers.push(browser);
  const google = new GoogleCseProvider();
  if (google.isEnabled()) providers.push(google);
  return providers;
}
