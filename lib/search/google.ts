import { AppError } from "@/lib/errors";
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
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (response.status === 429) throw new AppError("Google search quota was reached. Discovery is paused.");
    if (!response.ok) throw new AppError(`Google search failed with status ${response.status}.`);
    const payload = (await response.json()) as { items?: Array<{ title?: string; link?: string; snippet?: string }> };
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
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "ProspectPilot/0.1 (+https://leadpilot.live)",
        Accept: "text/html",
      },
      redirect: "manual",
    });
    if (response.status === 429 || response.status === 503) {
      throw new AppError("Google asked us to slow down. Discovery stopped instead of retrying around the limit.");
    }
    if (response.status >= 300 && response.status < 400) {
      throw new AppError("Google did not return search results. Discovery stopped.");
    }
    if (!response.ok) throw new AppError(`Google search failed with status ${response.status}.`);
    const html = await response.text();
    if (/unusual traffic|detected unusual traffic|recaptcha/i.test(html)) {
      throw new AppError("Google blocked automated search. Discovery stopped.");
    }
    const hits = parseGoogleResults(html, limit);
    if (hits.length === 0) throw new AppError("Google returned no company results for that query.");
    return hits;
  }
}

export function getSearchProvider(): SearchProvider {
  return new GoogleSearchProvider();
}
