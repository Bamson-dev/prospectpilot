"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { recordActivity } from "@/lib/jobs";

const contactSchema = z.object({
  prospectId: z.string().min(1),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(40).optional(),
  linkedinUrl: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
  confidence: z.coerce.number().min(0).max(100).optional(),
});

function blank(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function createContact(formData: FormData) {
  const { organization, user } = await requireOrganization();
  const parsed = contactSchema.safeParse({
    prospectId: formData.get("prospectId"),
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    jobTitle: String(formData.get("jobTitle") ?? ""),
    email: String(formData.get("email") ?? "").trim() || undefined,
    phone: String(formData.get("phone") ?? ""),
    linkedinUrl: String(formData.get("linkedinUrl") ?? ""),
    notes: String(formData.get("notes") ?? ""),
    confidence: formData.get("confidence") || 0,
  });
  const prospectId = String(formData.get("prospectId") ?? "");
  if (!parsed.success) redirect(`/prospects/${prospectId}?section=contacts&error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the contact.")}`);
  const prospect = await prisma.prospect.findFirst({ where: { id: parsed.data.prospectId, organizationId: organization.id } });
  if (!prospect) redirect("/prospects?error=Prospect+not+found.");
  const email = parsed.data.email ? parsed.data.email.toLowerCase() : null;
  const suppressed = email ? Boolean(await prisma.suppression.findUnique({ where: { organizationId_email: { organizationId: organization.id, email } } })) : false;
  const fullName = [parsed.data.firstName, parsed.data.lastName].filter(Boolean).join(" ") || null;
  const primaryCount = await prisma.contact.count({ where: { prospectId: prospect.id, isPrimary: true } });
  const contact = await prisma.contact.create({
    data: {
      organizationId: organization.id,
      prospectId: prospect.id,
      firstName: blank(parsed.data.firstName),
      lastName: blank(parsed.data.lastName),
      fullName,
      jobTitle: blank(parsed.data.jobTitle),
      email,
      phone: blank(parsed.data.phone),
      linkedinUrl: blank(parsed.data.linkedinUrl),
      notes: blank(parsed.data.notes),
      source: "manual",
      confidence: parsed.data.confidence ?? 0,
      isPrimary: primaryCount === 0,
      suppressed,
    },
  });
  await recordActivity({
    organizationId: organization.id,
    prospectId: prospect.id,
    contactId: contact.id,
    userId: user.id,
    action: "contact.added",
    detail: email || fullName || "contact",
  });
  redirect(`/prospects/${prospect.id}?section=contacts&notice=${suppressed ? "Contact+saved.+This+email+is+already+suppressed." : "Contact+saved."}`);
}

export async function setPrimaryContact(formData: FormData) {
  const { organization } = await requireOrganization();
  const id = String(formData.get("id"));
  const contact = await prisma.contact.findFirst({ where: { id, organizationId: organization.id } });
  if (!contact) redirect("/contacts?error=Contact+not+found.");
  await prisma.contact.updateMany({ where: { prospectId: contact.prospectId, organizationId: organization.id }, data: { isPrimary: false } });
  await prisma.contact.update({ where: { id }, data: { isPrimary: true } });
  redirect(`/prospects/${contact.prospectId}?section=contacts&notice=Primary+contact+updated.`);
}

export async function deleteContact(formData: FormData) {
  const { organization, user } = await requireOrganization();
  const id = String(formData.get("id"));
  if (formData.get("confirm") !== "yes") redirect("/contacts?error=Confirm+deletion+before+removing+the+contact.");
  const contact = await prisma.contact.findFirst({ where: { id, organizationId: organization.id } });
  if (!contact) redirect("/contacts?error=Contact+not+found.");
  await recordActivity({ organizationId: organization.id, prospectId: contact.prospectId, userId: user.id, action: "contact.deleted", detail: contact.email || contact.fullName || id });
  await prisma.contact.delete({ where: { id } });
  redirect(`/prospects/${contact.prospectId}?section=contacts&notice=Contact+deleted.`);
}
