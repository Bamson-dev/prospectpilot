import { sameVacancy } from "@/lib/applications/dedupe";

export type JobProviderName = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workable" | "generic";

export type DiscoveredJob = {
  source: JobProviderName;
  sourceUrl: string;
  applicationUrl: string;
  externalId?: string;
  companyName: string;
  companyDomain?: string;
  title: string;
  location?: string;
  description: string;
};

export function detectProvider(url: string): JobProviderName {
  const host = safeHost(url);
  if (host.includes("greenhouse.io")) return "greenhouse";
  if (host.includes("lever.co")) return "lever";
  if (host.includes("ashbyhq.com")) return "ashby";
  if (host.includes("smartrecruiters.com")) return "smartrecruiters";
  if (host.includes("workable.com")) return "workable";
  return "generic";
}

export function parseJobPage(input: { url: string; title: string; text: string; companyName?: string }): DiscoveredJob | null {
  const description = input.text.replace(/\s+/g, " ").trim();
  if (description.length < 40 || !input.title.trim()) return null;
  const provider = detectProvider(input.url);
  const company = input.companyName?.trim() || companyFromHost(input.url);
  if (!company) return null;
  return {
    source: provider,
    sourceUrl: input.url,
    applicationUrl: input.url,
    companyName: company,
    companyDomain: safeHost(input.url) || undefined,
    title: input.title.trim(),
    description,
  };
}

export function discoveryBlock(status: number, body: string) {
  if (status === 401 || status === 403 || status === 429) return "blocked" as const;
  if (/captcha|cloudflare|just a moment|verify you are human/i.test(body)) return "blocked" as const;
  return null;
}

export function dedupeDiscovered(jobs: DiscoveredJob[]) {
  const kept: DiscoveredJob[] = [];
  for (const job of jobs) {
    if (kept.some((existing) => sameVacancy(existing, job))) continue;
    kept.push(job);
  }
  return kept;
}

function companyFromHost(url: string) {
  const host = safeHost(url).replace(/^www\./, "");
  if (!host || host.includes("greenhouse") || host.includes("lever") || host.includes("ashby")) return "";
  return host.split(".")[0] ?? "";
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
