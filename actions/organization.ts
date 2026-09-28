"use server";

import { redirect } from "next/navigation";
import { requireUser, setSession } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export async function switchOrganization(formData: FormData) {
  const user = await requireUser();
  const organizationId = String(formData.get("organizationId") || "");
  const membership = organizationId
    ? await prisma.membership.findFirst({ where: { userId: user.id, organizationId } })
    : null;
  if (!membership) redirect("/organizations?error=That+workspace+is+not+available.");
  await setSession({ sub: user.id, email: user.email, name: user.name, organizationId: membership.organizationId });
  redirect("/dashboard");
}
