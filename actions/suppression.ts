"use server";

import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { recordActivity } from "@/lib/jobs";

const REASONS = ["Unsubscribe", "Do not contact", "Wrong person", "Manual suppression", "Provider complaint"] as const;

export async function addSuppression(formData: FormData) {
  const { organization, user } = await requireOrganization();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const reason = String(formData.get("reason") ?? "");
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 500);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/settings?section=outreach&error=Enter+a+valid+email.");
  if (!REASONS.includes(reason as (typeof REASONS)[number])) redirect("/settings?section=outreach&error=Choose+a+suppression+reason.");
  await prisma.suppression.upsert({
    where: { organizationId_email: { organizationId: organization.id, email } },
    update: { reason, notes: notes || null, source: "manual" },
    create: { organizationId: organization.id, email, reason, notes: notes || null, source: "manual" },
  });
  await prisma.contact.updateMany({ where: { organizationId: organization.id, email }, data: { suppressed: true } });
  await prisma.outreachMessage.updateMany({
    where: { organizationId: organization.id, contact: { email }, state: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "QUEUED"] } },
    data: { state: "SUPPRESSED", error: "Suppressed before sending." },
  });
  await recordActivity({ organizationId: organization.id, userId: user.id, action: "contact.suppressed", detail: email });
  redirect("/settings?section=outreach&notice=Suppression+saved.+Queued+messages+to+that+address+were+stopped.");
}
