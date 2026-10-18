import type { OutboundEmail } from "@/lib/email/types";

export type GmailCheckMailer = {
  sendEmail(message: OutboundEmail): Promise<{ providerMessageId: string }>;
  confirmSent(id: string): Promise<boolean>;
  findSent(input: { to: string; subject: string; afterMs: number }): Promise<string | null>;
};

export type GmailCheckStep = "send" | "labelled_sent" | "sent_search";
export type GmailCheckResult =
  | { ok: true; messageId: string }
  | { ok: false; step: GmailCheckStep; detail: string };

// Sends one labelled test message to the connected account itself and checks Gmail's Sent label and Sent search.
// The recipient is always the sender address. An employer address can never reach this function.
export async function runGmailSendCheck(
  mailer: GmailCheckMailer,
  account: { fromEmail: string; fromName?: string | null },
  now = new Date(),
): Promise<GmailCheckResult> {
  const to = account.fromEmail.trim();
  const subject = `ProspectPilot send check ${now.toISOString()}`;
  let messageId: string;
  try {
    const sent = await mailer.sendEmail({
      to,
      from: to,
      fromName: account.fromName ?? undefined,
      subject,
      text: "This is an automatic ProspectPilot send check to your own account. No employer received it. You can delete it.",
    });
    messageId = sent.providerMessageId;
  } catch (error) {
    return { ok: false, step: "send", detail: error instanceof Error ? error.message : "Gmail refused the send." };
  }
  try {
    if (!(await mailer.confirmSent(messageId))) return { ok: false, step: "labelled_sent", detail: "Gmail accepted the message but did not label it SENT." };
  } catch (error) {
    return { ok: false, step: "labelled_sent", detail: error instanceof Error ? error.message : "Sent label check failed." };
  }
  try {
    const found = await mailer.findSent({ to, subject, afterMs: now.getTime() - 60_000 });
    if (found !== messageId) return { ok: false, step: "sent_search", detail: "Sent search did not return the message that was just sent." };
  } catch (error) {
    return { ok: false, step: "sent_search", detail: error instanceof Error ? error.message : "Sent search failed." };
  }
  return { ok: true, messageId };
}
