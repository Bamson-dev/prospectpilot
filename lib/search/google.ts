import { AppError } from "@/lib/errors";
import { allowedGoogleUrl, googleBlocked, googleNeedsBrowser, rejectAllConsent } from "@/lib/search/consent";
import { describeGoogleDenial, ipv4Get } from "@/lib/search/ipv4";
import { parseGoogleResults } from "@/lib/search/parse-google";
import type { SearchHit, SearchProvider } from "@/lib/search/types";

const MIN_INTERVAL_MS = 8000;
let lastRequestAt = 0;

export class GoogleSearchProvider implements SearchProvider {
  readonly name = "google";

  async search(query: string, options: { limit: number }): Promise<SearchHit[]> {
    const limit = Math.min(Math.max(options.limit, 1), 10);
    if (process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX) {
      return this.customSearch(query, limit);
    }
    return this.publicSearch(query, limit);
  }

  private async customSearch(query: string, limit: number): Promise<SearchHit[]> {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", process.env.GOOGLE_CSE_API_KEY ?? "");
    url.searchParams.set("cx", process.env.GOOGLE_CSE_CX ?? "");
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(limit));
    const response = await ipv4Get(url, 15000);
    if (response.status === 429) throw new AppError("Google search quota was reached. Discovery is paused.");
    if (response.status === 401 || response.status === 403) {
      throw new AppError(`Google denied this search (${describeGoogleDenial(response.body)}). Discovery stopped instead of retrying.`);
    }
    if (response.status < 200 || response.status >= 300) throw new AppError(`Google search failed with status ${response.status}.`);
    const payload = JSON.parse(response.body) as { items?: Array<{ title?: string; link?: string; snippet?: string }> };
    return (payload.items ?? [])
      .filter((item) => item.link && item.title)
      .map((item) => ({ title: item.title ?? "", url: item.link ?? "", snippet: item.snippet ?? "" }));
  }

  private async publicSearch(query: string, limit: number): Promise<SearchHit[]> {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    const url = new URL("https://www.google.com/search");
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(limit));
    url.searchParams.set("gbv", "1");
    url.searchParams.set("hl", "en");
    const cookies = new Map<string, string>();
    let response = await googleFetch(url.toString(), cookies);
    if (response.status >= 300 && response.status < 400) {
      response = await acceptEssentialConsent(response, cookies);
    }
    for (let hop = 0; hop < 3 && response.status >= 300 && response.status < 400; hop += 1) {
      const location = response.headers.get("location");
      if (!location || !allowedGoogleUrl(new URL(location, url).toString())) {
        throw new AppError("Google did not return search results. Discovery stopped.");
      }
      response = await googleFetch(new URL(location, url).toString(), cookies);
    }
    if (response.status === 429 || response.status === 503) {
      throw new AppError("Google asked us to slow down. Discovery stopped instead of retrying around the limit.");
    }
    if (!response.ok) throw new AppError(`Google search failed with status ${response.status}.`);
    const html = await response.text();
    if (googleBlocked(html)) throw new AppError("Google blocked automated search. Discovery stopped.");
    const hits = parseGoogleResults(html, limit);
    if (hits.length === 0 && googleNeedsBrowser(html)) {
      throw new AppError("Google did not return HTML results from this server. Add GOOGLE_CSE_API_KEY and GOOGLE_CSE_CX, or discovery stays stopped.");
    }
    if (hits.length === 0) throw new AppError("Google returned no company results for that query.");
    return hits;
  }
}

const USER_AGENT = "ProspectPilot/0.1 (+https://leadpilot.live)";

async function googleFetch(target: string, cookies: Map<string, string>, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("User-Agent", USER_AGENT);
  headers.set("Accept", "text/html");
  if (cookies.size > 0) headers.set("Cookie", [...cookies].map(([key, value]) => `${key}=${value}`).join("; "));
  const response = await fetch(target, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(20000) });
  const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const cookie of setCookies) {
    const pair = cookie.split(";", 1)[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return response;
}

async function acceptEssentialConsent(response: Response, cookies: Map<string, string>) {
  const location = response.headers.get("location");
  const consentUrl = location ? new URL(location, "https://www.google.com").toString() : "";
  if (!consentUrl.startsWith("https://consent.google.com/")) {
    throw new AppError("Google did not return search results. Discovery stopped.");
  }
  const page = await googleFetch(consentUrl, cookies);
  if (!page.ok) throw new AppError("Google did not return search results. Discovery stopped.");
  const form = rejectAllConsent(await page.text());
  if (!form) throw new AppError("Google did not return search results. Discovery stopped.");
  return googleFetch(form.action, cookies, {
    method: "POST",
    body: form.body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

export function getSearchProvider(): SearchProvider {
  return new GoogleSearchProvider();
}
