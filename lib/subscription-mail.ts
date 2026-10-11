import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { GmailProvider } from "@/lib/email/gmail";

// Sends the one confirmation email that the person requested from the subscribe form, through the
// organization's connected Gmail account. This is not marketing mail and is not gated by
// OUTREACH_SEND_ENABLED. Returns false when no usable sender exists.
export async function sendSubscriptionConfirmation(organizationId: string, to: string, subject: string, text: string) {
  const account = await prisma.emailAccount.findFirst({ where: { organizationId, provider: "GMAIL", status: "ACTIVE", refreshTokenEncrypted: { not: null } } });
  if (!account?.refreshTokenEncrypted) return false;
  const provider = new GmailProvider(decryptSecret(account.refreshTokenEncrypted));
  await provider.sendEmail({ to, from: account.fromEmail, fromName: account.fromName ?? undefined, subject, text });
  return true;
}
