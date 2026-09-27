import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { cleanCompanyName, socialLinks, websiteFromUrl } from "@/lib/domains";
import { queueJob, recordActivity } from "@/lib/jobs";
import { buildDiscoveryQueries } from "@/lib/search/queries";
import { getSearchProvider } from "@/lib/search/google";

export async function processDiscovery(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new AppError("Campaign was not found.");
  if (campaign.status === "PAUSED" || campaign.status === "ARCHIVED" || campaign.status === "COMPLETED") {
    throw new AppError("Campaign is not accepting discovery.");
  }
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const discoveredToday = await prisma.prospect.count({
    where: { campaignId, createdAt: { gte: start }, source: "google" },
  });
  const remaining = campaign.dailyDiscoveryLimit - discoveredToday;
  if (remaining <= 0) throw new AppError("The daily discovery limit has been reached.");

  const queries = buildDiscoveryQueries(campaign).slice(0, campaign.dailyDiscoveryLimit <= 2 ? 1 : 8);
  if (queries.length === 0) throw new AppError("Add search terms before starting discovery.");
  const provider = getSearchProvider();
  let stored = 0;
  for (const query of queries) {
    if (stored >= remaining) break;
    const hits = await provider.search(query, { limit: Math.min(10, remaining - stored) });
    for (const hit of hits) {
      if (stored >= remaining) break;
      const website = websiteFromUrl(hit.url);
      const social = socialLinks([hit.url]);
      if (!website && !social.linkedinUrl && !social.facebookUrl && !social.instagramUrl) continue;
      if (website) {
        const existing = await prisma.prospect.findUnique({
          where: { organizationId_domain: { organizationId: campaign.organizationId, domain: website.domain } },
        });
        if (existing) continue;
      }
      const prospect = await prisma.prospect.create({
        data: {
          organizationId: campaign.organizationId,
          campaignId: campaign.id,
          companyName: cleanCompanyName(hit.title) || hit.title.slice(0, 160),
          domain: website?.domain,
          website: website?.website ?? null,
          industry: campaign.industry,
          source: provider.name,
          sourceUrl: hit.url,
          description: hit.snippet || null,
          discoveryStatus: "FOUND",
          researchStatus: website ? "QUEUED" : "SKIPPED",
          ...social,
        },
      });
      stored += 1;
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
        });
      }
    }
  }
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: stored > 0 ? "RESEARCHING" : campaign.status },
  });
  await recordActivity({
    organizationId: campaign.organizationId,
    campaignId: campaign.id,
    action: "campaign.discovery_finished",
    detail: `${stored} new companies stored.`,
  });
}
