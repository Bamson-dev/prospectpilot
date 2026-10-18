"use server";

import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { GmailProvider } from "@/lib/email/gmail";
import { runGmailSendCheck } from "@/lib/email/gmail-check";
import { recordActivity } from "@/lib/jobs";

export async function runGmailCheck() {
  const { organization } = await requireOrganization("ADMIN");
  const account = await prisma.emailAccount.findFirst({
    where: { organizationId: organization.id, provider: "GMAIL", status: "ACTIVE", refreshTokenEncrypted: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  if (!account?.refreshTokenEncrypted) redirect("/integrations/gmail?check=NO_ACCOUNT");
  const result = await runGmailSendCheck(new GmailProvider(decryptSecret(account.refreshTokenEncrypted)), { fromEmail: account.fromEmail, fromName: account.fromName });
  await recordActivity({
    organizationId: organization.id,
    action: "gmail.send_check",
    detail: JSON.stringify(result.ok ? { ok: true } : { ok: false, step: result.step, detail: result.detail.slice(0, 200) }),
  });
  redirect(result.ok ? "/integrations/gmail?check=PASS" : `/integrations/gmail?check=FAIL&step=${result.step}`);
}
