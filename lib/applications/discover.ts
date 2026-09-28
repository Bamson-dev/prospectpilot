import { searxngEnabled, searxngSearch, parseSearxngResults } from "@/lib/discovery/searxng";
import { AppError } from "@/lib/errors";
import { parseJobPage, type DiscoveredJob } from "@/lib/applications/providers";

export async function searchPublicJobs(query: string): Promise<DiscoveredJob[]> {
  if (!searxngEnabled()) throw new AppError("SearXNG is not configured.");
  const payload = await searxngSearch({ query, limit: 10, language: "en" });
  return parseSearxngResults(payload, query, 10)
    .map((hit) => parseJobPage({ url: hit.url, title: hit.title, text: `${hit.title}. ${hit.snippet}`.padEnd(40, ".") }))
    .filter((job): job is DiscoveredJob => job !== null);
}
