import { AppError } from "@/lib/errors";
import type { DiscoveryHit, DiscoveryInput, DiscoveryProvider, ProviderHealth } from "@/lib/discovery/types";

export function searxngEnabled() {
  return process.env.SEARXNG_ENABLED === "true" && Boolean(process.env.SEARXNG_URL?.trim());
}

export function parseSearxngResults(payload: unknown, query: string, limit: number): DiscoveryHit[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { results?: unknown }).results)) return [];
  const results = (payload as { results: unknown[] }).results;
  const hits: DiscoveryHit[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const row = item as { title?: unknown; url?: unknown; content?: unknown };
    if (typeof row.url !== "string" || typeof row.title !== "string") continue;
    if (!/^https?:\/\//i.test(row.url)) continue;
    hits.push({
      title: row.title.slice(0, 300),
      url: row.url,
      snippet: typeof row.content === "string" ? row.content.slice(0, 500) : "",
      sourceType: "search",
      sourceName: "searxng",
      query,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export class SearXNGProvider implements DiscoveryProvider {
  getName() {
    return "searxng";
  }

  isEnabled() {
    return searxngEnabled();
  }

  async discover(input: DiscoveryInput) {
    const payload = await searxngSearch(input);
    return parseSearxngResults(payload, input.query, input.limit);
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.isEnabled()) return { ok: false, detail: "Not configured" };
    try {
      const response = await fetch(endpoint("/healthz"), { signal: AbortSignal.timeout(5000) });
      return response.ok ? { ok: true, detail: "Healthy" } : { ok: false, detail: `HTTP ${response.status}` };
    } catch {
      return { ok: false, detail: "Unavailable" };
    }
  }
}

export async function searxngSearch(input: DiscoveryInput) {
  if (!searxngEnabled()) throw new AppError("SearXNG is not configured.");
  const url = endpoint("/search");
  url.searchParams.set("q", input.query);
  url.searchParams.set("format", "json");
  url.searchParams.set("language", input.language || "en");
  url.searchParams.set("pageno", "1");
  if (input.country) url.searchParams.set("locale", input.country);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { Accept: "application/json" },
    redirect: "error",
  });
  if (response.status === 403 || response.status === 429) {
    throw new AppError(`SearXNG is unavailable (${response.status}).`);
  }
  if (!response.ok) throw new AppError(`SearXNG is unavailable (${response.status}).`);
  try {
    return await response.json();
  } catch {
    throw new AppError("SearXNG did not return JSON.");
  }
}

function endpoint(path: string) {
  const base = process.env.SEARXNG_URL?.trim();
  if (!base) throw new AppError("SearXNG is not configured.");
  const root = new URL(base);
  if (root.protocol !== "http:" && root.protocol !== "https:") throw new AppError("SearXNG is not configured.");
  return new URL(path, root);
}
