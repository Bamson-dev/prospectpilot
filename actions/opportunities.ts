"use server";

import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { recordActivity } from "@/lib/jobs";

const KINDS = [
  "CUSTOM_SOFTWARE",
  "SOFTWARE_REPLACEMENT",
  "AUTOMATION",
  "ADVERTISING_MANAGEMENT",
  "ADVERTISING_OPTIMIZATION",
  "OTHER",
] as const;

const VALUES = ["unknown", "low", "moderate", "high"] as const;

export async function addOpportunity(formData: FormData) {
  const { organization, user } = await requireOrganization();
  const prospectId = String(formData.get("prospectId") ?? "");
  const prospect = await prisma.prospect.findFirst({ where: { id: prospectId, organizationId: organization.id } });
  if (!prospect) redirect("/prospects?error=Prospect+not+found.");
  const kind = String(formData.get("kind") ?? "");
  const title = String(formData.get("title") ?? "").trim().slice(0, 140);
  const description = String(formData.get("description") ?? "").trim().slice(0, 800);
  const evidence = String(formData.get("evidence") ?? "").trim().slice(0, 800);
  const service = String(formData.get("recommendedService") ?? "").trim().slice(0, 160);
  const potentialValue = String(formData.get("potentialValue") ?? "unknown");
  const confidence = Number(formData.get("confidence") ?? 0);
  if (!KINDS.includes(kind as (typeof KINDS)[number]) || !title || !evidence) {
    redirect(`/prospects/${prospectId}?section=opportunity&error=Add+a+type,+title,+and+the+evidence+you+actually+saw.`);
  }
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) {
    redirect(`/prospects/${prospectId}?section=opportunity&error=Confidence+must+be+a+whole+number+from+0+to+100.`);
  }
  await prisma.opportunityAssessment.create({
    data: {
      prospectId,
      kind: kind as (typeof KINDS)[number],
      title,
      description: description || null,
      interpretation: description || title,
      evidence: [evidence],
      recommendedService: service || null,
      potentialValue: VALUES.includes(potentialValue as (typeof VALUES)[number]) ? potentialValue : "unknown",
      confidence,
      status: "OPEN",
    },
  });
  await recordActivity({ organizationId: organization.id, prospectId, campaignId: prospect.campaignId, userId: user.id, action: "opportunity.recorded", detail: title });
  redirect(`/prospects/${prospectId}?section=opportunity&notice=Opportunity+recorded+from+your+notes.+It+is+not+an+AI+conclusion.`);
}
