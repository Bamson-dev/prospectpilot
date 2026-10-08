import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { cleanCompanyName, socialLinks, websiteFromUrl } from "@/lib/domains";
import { companyWebsiteFromDirectory, discoverySourceType, isListingPortal } from "@/lib/discovery/normalize";
import { discoveryProviders } from "@/lib/discovery/providers";
import { recordSourceHealth } from "@/lib/discovery/health";
import type { DiscoveryHit, DiscoveryProvider } from "@/lib/discovery/types";
import { queueJob, recordActivity } from "@/lib/jobs";
import { logInfo } from "@/lib/logger";
import { buildDiscoveryQueries } from "@/lib/search/queries";

const AGGREGATORS = ["google.", "bing.com", "duckduckgo.com", "yahoo.com", "wikipedia.org"];

export async function processCampaignDiscoveryScheduler() {
  const campaigns = await prisma.campaign.findMany({
    where: { status: { in: ["DISCOVERY", "ACTIVE"] } },
  });
  
  for (const campaign of campaigns) {
    const window = Math.floor(new Date().getHours() / 3);
    await queueJob({
      id: `discovery-campaign-${campaign.id}-${new Date().toISOString().split('T')[0]}-${window}`,
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      queue: "discovery",
      name: "run",
      payload: { campaignId: campaign.id },
    }).catch(() => { /* ignore unique constraint */ });
  }
}

export async function processDiscovery(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new AppError("Campaign was not found.");
  if (campaign.status !== "DISCOVERY" && campaign.status !== "ACTIVE") {
    throw new AppError("Campaign is not accepting discovery.");
  }
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const discoveredToday = await prisma.prospect.count({ where: { campaignId, createdAt: { gte: start } } });
  const remaining = campaign.dailyDiscoveryLimit - discoveredToday;
  if (remaining <= 0) throw new AppError("The daily discovery limit has been reached.");

  const providers = discoveryProviders({
    directory: campaign.enableDirectory,
    map: campaign.enableMap,
    social: campaign.enableSocial,
  });
  if (providers.length === 0) throw new AppError("SearXNG is not configured.");
  const queries = buildDiscoveryQueries(campaign).slice(0, Math.min(campaign.maxQueries, remaining <= 2 ? 4 : campaign.maxQueries));
  if (queries.length === 0) throw new AppError("Add search terms before starting discovery.");
  logInfo("discovery.started", { campaignId, providers: providers.map((item) => item.getName()).join(","), queries: queries.length });

  let stored = 0;
  const failed = new Set<string>();
  for (const query of queries) {
    if (stored >= remaining) break;
    for (const provider of providers) {
      if (stored >= remaining || failed.has(provider.getName())) continue;
      const found = await collect(provider, query, 10);
      if (found === null) {
        failed.add(provider.getName());
        continue;
      }
      for (const hit of found) {
        if (stored >= remaining) break;
        logInfo("discovery.result.found", { provider: provider.getName(), url: hit.url });
        const created = await storeHit(campaign, hit);
        if (created) stored += 1;
      }
    }
    if (stored < remaining) await delay(1200);
  }

  // Removed status change to RESEARCHING so the campaign stays ACTIVE
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { updatedAt: new Date() },
  });
  await recordActivity({
    organizationId: campaign.organizationId,
    campaignId: campaign.id,
    action: "campaign.discovery_finished",
    detail: `${stored} new companies stored.`,
  });
  if (stored === 0 && failed.size > 0) throw new AppError("SearXNG did not return results.");
}

async function collect(provider: DiscoveryProvider, query: string, limit: number) {
  logInfo("discovery.provider.started", { provider: provider.getName(), query });
  try {
    const hits = await provider.discover({ query, limit });
    await recordSourceHealth(provider.getName(), hits.length > 0 ? "success" : "empty");
    logInfo("discovery.provider.completed", { provider: provider.getName(), results: hits.length });
    return hits;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discovery provider failed.";
    const blocked = /captcha|403|429|unavailable/i.test(message);
    await recordSourceHealth(provider.getName(), blocked ? "blocked" : "failure", message);
    logInfo("discovery.provider.failed", { provider: provider.getName(), message });
    return null;
  }
}

async function storeHit(campaign: { id: string; organizationId: string; industry: string | null; dailyDiscoveryLimit: number }, hit: DiscoveryHit) {
  const listed = websiteFromUrl(hit.url);
  if (listed && AGGREGATORS.some((host) => listed.domain.includes(host))) {
    logInfo("discovery.result.skipped", { domain: listed.domain, reason: "aggregator" });
    return false;
  }
  if (listed && isListingPortal(listed.domain)) {
    const resolved = companyWebsiteFromDirectory({ listingUrl: hit.url, snippet: hit.snippet, title: hit.title });
    if (!resolved) {
      await remember(campaign, null, { ...hit, sourceType: "DIRECTORY" }, 30);
      logInfo("discovery.directory.unresolved", { domain: listed.domain, url: hit.url });
      return false;
    }
    logInfo("discovery.directory.resolved", { directory: listed.domain, domain: resolved.domain });
    return storeCompany(campaign, { ...hit, sourceType: "DIRECTORY" }, resolved, hit.url);
  }
  const website = listed;
  const social = socialLinks([hit.url]);
  if (!website && !social.linkedinUrl && !social.facebookUrl && !social.instagramUrl) return false;
  if (website) {
    const existing = await prisma.prospect.findUnique({
      where: { organizationId_domain: { organizationId: campaign.organizationId, domain: website.domain } },
    });
    if (existing) {
      await remember(campaign, existing.id, hit, 80);
      await recordActivity({
        organizationId: campaign.organizationId,
        campaignId: campaign.id,
        prospectId: existing.id,
        action: "discovery.company.duplicate",
        detail: website.domain,
      });
      logInfo("discovery.company.duplicate", { domain: website.domain });
      return false;
    }
  }
  return storeCompany(campaign, { ...hit, sourceType: discoverySourceType(website?.domain ?? null, "SEARCH") }, website, hit.url, social);
}

async function storeCompany(
  campaign: { id: string; organizationId: string; industry: string | null; dailyDiscoveryLimit: number },
  hit: DiscoveryHit,
  website: { domain: string; website: string } | null,
  sourceUrl: string,
  social = socialLinks([sourceUrl]),
) {
  if (website) {
    const existing = await prisma.prospect.findUnique({
      where: { organizationId_domain: { organizationId: campaign.organizationId, domain: website.domain } },
    });
    if (existing) {
      await remember(campaign, existing.id, { ...hit, url: sourceUrl }, 80);
      await recordActivity({
        organizationId: campaign.organizationId,
        campaignId: campaign.id,
        prospectId: existing.id,
        action: "discovery.company.duplicate",
        detail: website.domain,
      });
      logInfo("discovery.company.duplicate", { domain: website.domain });
      return false;
    }
  }
  const prospect = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`discovery:${campaign.id}`}))`;
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const used = await tx.prospect.count({ where: { campaignId: campaign.id, createdAt: { gte: start } } });
    if (used >= campaign.dailyDiscoveryLimit) return null;
    return tx.prospect.create({
      data: {
        organizationId: campaign.organizationId,
        campaignId: campaign.id,
        companyName: cleanCompanyName(hit.title) || hit.title.slice(0, 160),
        domain: website?.domain,
        website: website?.website ?? null,
        industry: campaign.industry,
        source: hit.sourceName,
        sourceUrl: website?.website ?? sourceUrl,
        description: hit.snippet || null,
        discoveryStatus: "FOUND",
        researchStatus: website ? "QUEUED" : "SKIPPED",
        ...social,
      },
    });
  });
  if (!prospect) {
    logInfo("discovery.limit.reached", { campaignId: campaign.id });
    return false;
  }
  await remember(campaign, prospect.id, { ...hit, url: sourceUrl }, website ? 70 : 40);
  logInfo("discovery.company.normalized", { domain: website?.domain ?? null, prospectId: prospect.id });
  await recordActivity({
    organizationId: campaign.organizationId,
    campaignId: campaign.id,
    prospectId: prospect.id,
    action: "prospect.discovered",
    detail: hit.url,
  });
  if (website) {
    await queueJob({
      organizationId: campaign.organizationId,
      campaignId: campaign.id,
      prospectId: prospect.id,
      queue: "research",
      name: "research.website",
      payload: { provider: hit.sourceName },
    });
  }
  return true;
}

async function remember(campaign: { id: string; organizationId: string }, prospectId: string | null, hit: DiscoveryHit, confidence: number) {
  await prisma.discoverySource.create({
    data: {
      organizationId: campaign.organizationId,
      prospectId,
      campaignId: campaign.id,
      sourceType: hit.sourceType,
      sourceName: hit.sourceName,
      sourceUrl: hit.url,
      query: hit.query,
      title: hit.title,
      snippet: hit.snippet || null,
      confidence,
    },
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
