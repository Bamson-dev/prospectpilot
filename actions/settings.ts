"use server";

import { redirect } from "next/navigation";
import { compare, hash } from "bcryptjs";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

const SETTING_KEYS = [
  "defaultDiscoveryLimit",
  "defaultResearchLimit",
  "defaultOutreachLimit",
  "defaultProvider",
  "requireApproval",
  "followUpDays",
  "notifyOnReply",
] as const;

export async function saveWorkspaceSettings(formData: FormData) {
  const { organization } = await requireOrganization("ADMIN");
  const section = String(formData.get("section") ?? "general");
  for (const key of SETTING_KEYS) {
    const raw = formData.get(key);
    if (raw == null) continue;
    const value = String(raw).trim().slice(0, 80);
    if (!value) continue;
    await prisma.setting.upsert({
      where: { organizationId_key: { organizationId: organization.id, key } },
      update: { value },
      create: { organizationId: organization.id, key, value },
    });
  }
  redirect(`/settings?section=${encodeURIComponent(section)}&notice=Settings+saved.`);
}

export async function updateProfile(formData: FormData) {
  const { user } = await requireOrganization();
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (name.length < 2) redirect("/settings?section=profile&error=Enter+your+name.");
  await prisma.user.update({ where: { id: user.id }, data: { name } });
  redirect("/settings?section=profile&notice=Profile+updated.");
}

export async function updateOrganizationName(formData: FormData) {
  const { organization } = await requireOrganization("ADMIN");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (name.length < 2) redirect("/settings?section=organization&error=Enter+an+organization+name.");
  await prisma.organization.update({ where: { id: organization.id }, data: { name } });
  redirect("/settings?section=organization&notice=Organization+updated.");
}

export async function changePassword(formData: FormData) {
  const { user } = await requireOrganization();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  if (next.length < 10) redirect("/settings?section=security&error=Use+at+least+10+characters.");
  const stored = await prisma.user.findUnique({ where: { id: user.id } });
  if (!stored || !(await compare(current, stored.passwordHash))) {
    redirect("/settings?section=security&error=Current+password+is+incorrect.");
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(next, 12) } });
  redirect("/settings?section=security&notice=Password+updated.");
}
