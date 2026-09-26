"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-user";
import { websiteFromUrl } from "@/lib/domains";
import { prisma } from "@/lib/db";
import { AppError, errorMessage } from "@/lib/errors";
import { queueJob, recordActivity } from "@/lib/jobs";

const prospectSchema = z.object({
  companyName: z.string().trim().min(1).max(160),
  website: z.string().trim().max(300).optional(),
  industry: z.string().trim().max(120).optional(),
  campaignId: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createProspect(formData: FormData) {
  const { organization, user } = await requireOrganization();
  const parsed = prospectSchema.safeParse({
    companyName: formData.get("companyName"),
    website: String(formData.get("website") ?? "").trim() || undefined,
    industry: String(formData.get("industry") ?? "").trim() || undefined,
    campaignId: String(formData.get("campaignId") ?? "").trim() || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
  });
  if (!parsed.success) redirect(`/prospects?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the company.")}`);
  const site = parsed.data.website ? websiteFromUrl(parsed.data.website.startsWith("http") ? parsed.data.website : `https://${parsed.data.website}`) : null;
  try {
    if (parsed.data.campaignId) {
      const campaign = await prisma.campaign.findFirst({ where: { id: parsed.data.campaignId, organizationId: organization.id } });
      if (!campaign) throw new AppError("That campaign is not in this workspace.");
    }
    const prospect = await prisma.prospect.create({
      data: {
        organizationId: organization.id,
        campaignId: parsed.data.campaignId,
        companyName: parsed.data.companyName,
        website: site?.website,
        domain: site?.domain,
        industry: parsed.data.industry,
        notes: parsed.data.notes,
        source: "manual",
        discoveryStatus: "FOUND",
        researchStatus: site ? "PENDING" : "SKIPPED",
      },
    });
    await recordActivity({ organizationId: organization.id, prospectId: prospect.id, campaignId: prospect.campaignId, userId: user.id, action: "prospect.created" });
    redirect(`/prospects/${prospect.id}?notice=Prospect+saved.`);
  } catch (error) {
    if (typeof error === "object" && error && "digest" in error) throw error;
    redirect(`/prospects?error=${encodeURIComponent(errorMessage(error))}`);
  }
}

export async function queueResearch(formData: FormData) {
  const { organization } = await requireOrganization();
  const id = String(formData.get("id"));
  const prospect = await prisma.prospect.findFirst({ where: { id, organizationId: organization.id } });
  if (!prospect?.website) redirect(`/prospects/${id}?error=Add+a+public+website+before+research.`);
  try {
    await prisma.prospect.update({ where: { id }, data: { researchStatus: "QUEUED" } });
    await queueJob({ organizationId: organization.id, campaignId: prospect.campaignId, prospectId: id, queue: "research", name: "research.website" });
  } catch (error) {
    redirect(`/prospects/${id}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  redirect(`/prospects/${id}?notice=Research+queued.`);
}

const editSchema = z.object({
  id: z.string().min(1),
  companyName: z.string().trim().min(1).max(160),
  website: z.string().trim().max(300).optional(),
  industry: z.string().trim().max(120).optional(),
  country: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  address: z.string().trim().max(240).optional(),
  phone: z.string().trim().max(40).optional(),
  description: z.string().trim().max(4000).optional(),
  companySize: z.string().trim().max(80).optional(),
  linkedinUrl: z.string().trim().max(300).optional(),
  facebookUrl: z.string().trim().max(300).optional(),
  instagramUrl: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(4000).optional(),
  recommendedService: z.string().trim().max(240).optional(),
  opportunityReason: z.string().trim().max(800).optional(),
});

function optional(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || undefined;
}

export async function updateProspect(formData: FormData) {
  const { organization, user } = await requireOrganization();
  const parsed = editSchema.safeParse({
    id: formData.get("id"),
    companyName: formData.get("companyName"),
    website: optional(formData, "website"),
    industry: optional(formData, "industry"),
    country: optional(formData, "country"),
    city: optional(formData, "city"),
    address: optional(formData, "address"),
    phone: optional(formData, "phone"),
    description: optional(formData, "description"),
    companySize: optional(formData, "companySize"),
    linkedinUrl: optional(formData, "linkedinUrl"),
    facebookUrl: optional(formData, "facebookUrl"),
    instagramUrl: optional(formData, "instagramUrl"),
    notes: optional(formData, "notes"),
    recommendedService: optional(formData, "recommendedService"),
    opportunityReason: optional(formData, "opportunityReason"),
  });
  const id = String(formData.get("id") ?? "");
  if (!parsed.success) redirect(`/prospects/${id}?section=overview&error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the company.")}`);
  const existing = await prisma.prospect.findFirst({ where: { id: parsed.data.id, organizationId: organization.id } });
  if (!existing) redirect("/prospects?error=Prospect+not+found.");
  const site = parsed.data.website ? websiteFromUrl(parsed.data.website.startsWith("http") ? parsed.data.website : `https://${parsed.data.website}`) : null;
  if (site) {
    const clash = await prisma.prospect.findFirst({ where: { organizationId: organization.id, domain: site.domain, NOT: { id: existing.id } } });
    if (clash) redirect(`/prospects/${existing.id}?error=Another+prospect+already+uses+that+domain.`);
  }
  await prisma.prospect.update({
    where: { id: existing.id },
    data: {
      companyName: parsed.data.companyName,
      website: site?.website ?? null,
      domain: site?.domain ?? null,
      industry: parsed.data.industry ?? null,
      country: parsed.data.country ?? null,
      city: parsed.data.city ?? null,
      address: parsed.data.address ?? null,
      phone: parsed.data.phone ?? null,
      description: parsed.data.description ?? null,
      companySize: parsed.data.companySize ?? null,
      linkedinUrl: parsed.data.linkedinUrl ?? null,
      facebookUrl: parsed.data.facebookUrl ?? null,
      instagramUrl: parsed.data.instagramUrl ?? null,
      notes: parsed.data.notes ?? null,
      recommendedService: parsed.data.recommendedService ?? null,
      opportunityReason: parsed.data.opportunityReason ?? null,
    },
  });
  await recordActivity({ organizationId: organization.id, prospectId: existing.id, campaignId: existing.campaignId, userId: user.id, action: "prospect.updated" });
  redirect(`/prospects/${existing.id}?section=overview&notice=Prospect+updated.`);
}

export async function updateProspectNotes(formData: FormData) {
  const { organization, user } = await requireOrganization();
  const id = String(formData.get("id"));
  const notes = String(formData.get("notes") ?? "").slice(0, 4000);
  const prospect = await prisma.prospect.findFirst({ where: { id, organizationId: organization.id } });
  if (!prospect) redirect("/prospects?error=Prospect+not+found.");
  await prisma.prospect.update({ where: { id }, data: { notes } });
  await recordActivity({ organizationId: organization.id, prospectId: id, userId: user.id, action: "prospect.notes_updated" });
  redirect(`/prospects/${id}?section=overview&notice=Notes+saved.`);
}

export async function deleteProspect(formData: FormData) {
  const { organization, user } = await requireOrganization();
  const id = String(formData.get("id"));
  if (formData.get("confirm") !== "yes") redirect(`/prospects/${id}?error=Confirm+deletion+before+removing+the+prospect.`);
  const prospect = await prisma.prospect.findFirst({ where: { id, organizationId: organization.id } });
  if (!prospect) redirect("/prospects?error=Prospect+not+found.");
  await recordActivity({ organizationId: organization.id, campaignId: prospect.campaignId, userId: user.id, action: "prospect.deleted", detail: prospect.companyName });
  await prisma.prospect.delete({ where: { id } });
  redirect("/prospects?notice=Prospect+deleted.");
}

export async function tagProspects(formData: FormData) {
  const { organization, user } = await requireOrganization();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  const name = String(formData.get("tag") ?? "").trim().slice(0, 40);
  if (!name || ids.length === 0) redirect("/prospects?error=Select+at+least+one+prospect+and+enter+a+tag.");
  const prospects = await prisma.prospect.findMany({ where: { organizationId: organization.id, id: { in: ids } }, select: { id: true, campaignId: true } });
  if (prospects.length === 0) redirect("/prospects?error=None+of+those+prospects+belong+to+this+workspace.");
  const tag = await prisma.tag.upsert({
    where: { organizationId_name: { organizationId: organization.id, name } },
    update: {},
    create: { organizationId: organization.id, name },
  });
  await prisma.prospectTag.createMany({
    data: prospects.map((prospect) => ({ prospectId: prospect.id, tagId: tag.id })),
    skipDuplicates: true,
  });
  await recordActivity({ organizationId: organization.id, userId: user.id, action: "prospect.tagged", detail: `${name} · ${prospects.length}` });
  redirect(`/prospects?notice=${encodeURIComponent(`Tagged ${prospects.length} prospects.`)}`);
}
