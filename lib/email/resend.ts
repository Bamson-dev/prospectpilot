import { AppError } from "@/lib/errors";
import { classifyProviderFailure, isPermanentProviderFailure, providerFailureMessage } from "@/lib/provider-errors";
import { listUnsubscribeHeaders, sanitizeOutbound, type EmailProvider, type OutboundEmail } from "@/lib/email/types";

export class ResendProvider implements EmailProvider {
  readonly name = "resend" as const;

  async sendEmail(message: OutboundEmail) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) throw new AppError("Resend is not configured.");
    const clean = sanitizeOutbound(message);
    const from = clean.fromName ? `${clean.fromName.replace(/[\r\n]+/g, " ")} <${clean.from}>` : clean.from;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [clean.to],
        subject: clean.subject,
        text: clean.text,
        ...(clean.html ? { html: clean.html } : {}),
        ...(clean.listUnsubscribeUrl ? { headers: Object.fromEntries(listUnsubscribeHeaders(clean.listUnsubscribeUrl)) } : {}),
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      const kind = classifyProviderFailure(response.status, body);
      const error = new AppError(providerFailureMessage(kind));
      if (!isPermanentProviderFailure(kind) && kind === "transient") error.name = "TransientProviderError";
      if (isPermanentProviderFailure(kind)) error.name = "PermanentProviderError";
      throw error;
    }
    let payload: { id?: string } = {};
    try {
      payload = JSON.parse(body) as { id?: string };
    } catch {
      payload = {};
    }
    if (!payload.id) throw new AppError("Resend accepted the message without an id.");
    return { providerMessageId: payload.id };
  }

  async getMessage(id: string) {
    this.requireKey();
    return { id, status: "NOT_AVAILABLE" };
  }

  async getThread(id: string) {
    return [await this.getMessage(id)];
  }

  async getDeliveryStatus(id: string) {
    return (await this.getMessage(id)).status;
  }

  async syncInbox() {
    this.requireKey();
    return [];
  }

  private requireKey() {
    if (!process.env.RESEND_API_KEY?.trim()) throw new AppError("Resend is not configured.");
  }
}
