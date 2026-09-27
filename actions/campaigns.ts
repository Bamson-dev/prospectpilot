"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { errorMessage } from "@/lib/errors";
import { stepsFromText } from "@/lib/follow-ups";
import { queueJob, recordActivity } from "@/lib/jobs";

const campaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  industry: z.string().trim().max(120).optional(),
  country: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  searchTerms: z.string().trim().min(2).max(1000),
  opportunityFocus: z.enum(["SOFTWARE", "ADVERTISING", "SOFTWARE_AND_ADVERTISING", "AUTOMATION", "OTHER"]),
  targetCompanySize: z.string().trim().max(80).optional(),
  dailyDiscoveryLimit: z.coerce.number().int().min(1).max(1000),
  dailyResearchLimit: z.coerce.number().int().min(1).max(500),
  dailyQualificationLimit: z.coerce.number().int().min(1).max(500),
  dailyOutreachLimit: z.coerce.number().int().min(1).max(500),
  excludedKeywords: z.string().trim().max(500).optional(),
  maxQueries: z.coerce.number().int().min(1).max(12),
  maxPagesPerSite: z.coerce.number().int().min(1).max(20),
  crawlDepth: z.coerce.number().int().min(1).max(3),
  enableDirectory: z.boolean(),
  enableMap: z.boolean(),
  enableSocial: z.boolean(),
  provider: z.enum(["RESEND", "GMAIL", ""]).optional(),
  emailAccountId: z.string().optional(),
  followUps: z.string().trim().max(80).optional(),
});

function optional(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

export async function createCampaign(formData: FormData) {
  const { organization } = await requireOrganization();
  const parsed = campaignSchema.safeParse({
    name: formData.get("name"),
    description: optional(formData.get("description")),
    industry: optional(formData.get("industry")),
    country: optional(formData.get("country")),
    city: optional(formData.get("city")),
    searchTerms: formData.get("searchTerms"),
    opportunityFocus: formData.get("opportunityFocus"),
    targetCompanySize: optional(formData.get("targetCompanySize")),
    dailyDiscoveryLimit: formData.get("dailyDiscoveryLimit") || 25,
    dailyResearchLimit: formData.get("dailyResearchLimit") || 25,
    dailyQualificationLimit: formData.get("dailyQualificationLimit") || 25,
    dailyOutreachLimit: formData.get("dailyOutreachLimit") || 25,
    excludedKeywords: optional(formData.get("excludedKeywords")),
    maxQueries: formData.get("maxQueries") || 6,
    maxPagesPerSite: formData.get("maxPagesPerSite") || 10,
    crawlDepth: formData.get("crawlDepth") || 2,
    enableDirectory: formData.get("enableDirectory") === "true",
    enableMap: formData.get("enableMap") === "true",
    enableSocial: formData.get("enableSocial") === "true",
    provider: formData.get("provider") || "",
    emailAccountId: optional(formData.get("emailAccountId")),
    followUps: optional(formData.get("followUps")),
  });
  if (!parsed.success) redirect(`/campaigns/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the campaign.")}`);
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: organization.id,
      name: parsed.data.name,
      description: parsed.data.description,
      industry: parsed.data.industry,
      country: parsed.data.country,
      city: parsed.data.city,
      searchTerms: parsed.data.searchTerms,
      opportunityFocus: parsed.data.opportunityFocus,
      targetCompanySize: parsed.data.targetCompanySize,
      dailyDiscoveryLimit: parsed.data.dailyDiscoveryLimit,
      dailyResearchLimit: parsed.data.dailyResearchLimit,
      dailyQualificationLimit: parsed.data.dailyQualificationLimit,
      dailyOutreachLimit: parsed.data.dailyOutreachLimit,
      excludedKeywords: parsed.data.excludedKeywords,
      maxQueries: parsed.data.maxQueries,
      maxPagesPerSite: parsed.data.maxPagesPerSite,
      crawlDepth: parsed.data.crawlDepth,
      enableDirectory: parsed.data.enableDirectory,
      enableMap: parsed.data.enableMap,
      enableSocial: parsed.data.enableSocial,
      provider: parsed.data.provider ? parsed.data.provider : null,
      emailAccountId: parsed.data.emailAccountId || null,
      followUpSteps: stepsFromText(parsed.data.followUps || "3,7,14"),
      requireApproval: true,
      autoFollowUp: false,
    },
  });
  await recordActivity({ organizationId: organization.id, campaignId: campaign.id, action: "campaign.created", detail: campaign.name });
  redirect(`/campaigns/${campaign.id}?notice=Campaign+saved.`);
}

async function setStatus(id: string, status: "DISCOVERY" | "PAUSED" | "ACTIVE" | "ARCHIVED", enqueueDiscovery: boolean) {
  const { organization } = await requireOrganization();
  const campaign = await prisma.campaign.findFirst({ where: { id, organizationId: organization.id } });
  if (!campaign) redirect("/campaigns?error=Campaign+not+found.");
  try {
    await prisma.campaign.update({ where: { id }, data: { status } });
    await recordActivity({ organizationId: organization.id, campaignId: id, action: `campaign.${status.toLowerCase()}` });
    if (enqueueDiscovery) {
      await queueJob({ organizationId: organization.id, campaignId: id, queue: "discovery", name: "discovery.search" });
    }
  } catch (error) {
    redirect(`/campaigns/${id}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  redirect(`/campaigns/${id}?notice=Campaign+updated.`);
}

export async function startCampaign(formData: FormData) {
  await setStatus(String(formData.get("id")), "DISCOVERY", true);
}

export async function pauseCampaign(formData: FormData) {
  await setStatus(String(formData.get("id")), "PAUSED", false);
}

export async function resumeCampaign(formData: FormData) {
  await setStatus(String(formData.get("id")), "ACTIVE", true);
}

export async function archiveCampaign(formData: FormData) {
  await setStatus(String(formData.get("id")), "ARCHIVED", false);
}

export async function saveSequence(formData: FormData) {
  const { organization, user } = await requireOrganization("ADMIN");
  const campaignId = String(formData.get("campaignId") ?? "");
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, organizationId: organization.id } });
  if (!campaign) redirect("/follow-ups?error=Campaign+not+found.");
  const steps = stepsFromText(String(formData.get("days") ?? ""));
  const name = String(formData.get("name") ?? "Follow-up sequence").trim().slice(0, 80) || "Follow-up sequence";
  await prisma.sequence.deleteMany({ where: { campaignId, organizationId: organization.id } });
  await prisma.sequence.create({
    data: {
      organizationId: organization.id,
      campaignId,
      name,
      steps: {
        create: [
          { position: 0, dayOffset: 0, subject: "Initial email", body: "Sent from the approved outreach draft." },
          ...steps.map((step, index) => ({
            position: index + 1,
            dayOffset: step.dayOffset,
            subject: `Follow-up ${index + 1}`,
            body: "Written when the earlier message is approved. Nothing sends while the provider is not configured.",
          })),
        ],
      },
    },
  });
  await prisma.campaign.update({ where: { id: campaignId }, data: { followUpSteps: steps } });
  await recordActivity({ organizationId: organization.id, campaignId, userId: user.id, action: "followup.sequence_saved", detail: name });
  redirect("/follow-ups?notice=Sequence+saved.+Follow-ups+still+wait+for+approval+and+a+configured+provider.");
}
