import { searxngEnabled, searxngSearch, parseSearxngResults } from "@/lib/discovery/searxng";
import { AppError } from "@/lib/errors";
import { classifyMarketingRole } from "@/lib/applications/marketing-scope";
import { parseJobPage, type DiscoveredJob } from "@/lib/applications/providers";

// Marketing roles only.
export const DISCOVERY_QUERIES = [
  "Growth Marketing Manager",
  "Performance Marketing Manager",
  "Digital Marketing Manager",
  "Demand Generation Manager",
  "Product Marketing Manager",
  "Marketing Operations Manager",
  "Head of Marketing",
  "Go-To-Market Manager",
];

export async function searchPublicJobs(query: string): Promise<DiscoveredJob[]> {
  if (!searxngEnabled()) throw new AppError("SearXNG is not configured.");
  const payload = await searxngSearch({ query, limit: 10, language: "en" });
  return parseSearxngResults(payload, query, 10)
    .map((hit) => parseJobPage({ url: hit.url, title: hit.title, text: `${hit.title}. ${hit.snippet}`.padEnd(40, ".") }))
    .filter((job): job is DiscoveredJob => job !== null)
    .filter((job) => classifyMarketingRole({ title: job.title, description: job.description }).inScope);
}
