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
  const { organization } = await requireOrganization();
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
        description: parsed.data.notes,
        source: "manual",
        discoveryStatus: "FOUND",
        researchStatus: site ? "PENDING" : "SKIPPED",
      },
    });
    await recordActivity({ organizationId: organization.id, prospectId: prospect.id, campaignId: prospect.campaignId, action: "prospect.created" });
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

export async function updateProspectNotes(formData: FormData) {
  const { organization } = await requireOrganization();
  const id = String(formData.get("id"));
  const notes = String(formData.get("notes") ?? "").slice(0, 2000);
  const prospect = await prisma.prospect.findFirst({ where: { id, organizationId: organization.id } });
  if (!prospect) redirect("/prospects?error=Prospect+not+found.");
  await prisma.prospect.update({ where: { id }, data: { description: notes } });
  await recordActivity({ organizationId: organization.id, prospectId: id, action: "prospect.notes_updated" });
  redirect(`/prospects/${id}?notice=Notes+saved.`);
}
