import { AppError } from "@/lib/errors";
import { classifyProviderFailure, isPermanentProviderFailure, providerFailureMessage } from "@/lib/provider-errors";
import { listUnsubscribeHeaders, sanitizeOutbound, type EmailProvider, type OutboundEmail } from "@/lib/email/types";

export class GmailProvider implements EmailProvider {
  readonly name = "gmail" as const;

  constructor(private readonly refreshToken: string) {}

  async sendEmail(message: OutboundEmail) {
    const clean = sanitizeOutbound(message);
    const accessToken = await this.accessToken();
    const boundary = "boundary_" + Math.random().toString(36).substring(2);
    const mime = [
      `From: ${clean.fromName ? `${clean.fromName} <${clean.from}>` : clean.from}`,
      `To: ${clean.to}`,
      `Subject: ${clean.subject}`,
      ...listUnsubscribeHeaders(clean.listUnsubscribeUrl).map(([name, value]) => `${name}: ${value}`),
      "MIME-Version: 1.0",
    ];
    
    if (clean.html) {
      mime.push(
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        clean.text,
        `--${boundary}`,
        "Content-Type: text/html; charset=utf-8",
        "",
        clean.html,
        `--${boundary}--`
      );
    } else {
      mime.push(
        "Content-Type: text/plain; charset=utf-8",
        "",
        clean.text
      );
    }
    const raw = Buffer.from(mime.join("\r\n")).toString("base64url");
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    const body = await response.text();
    if (!response.ok) {
      const kind = classifyProviderFailure(response.status, body);
      const error = new AppError(providerFailureMessage(kind));
      error.name = isPermanentProviderFailure(kind) ? "PermanentProviderError" : "TransientProviderError";
      throw error;
    }
    const payload = JSON.parse(body) as { id?: string };
    if (!payload.id) throw new AppError("Gmail accepted the message without an id.");
    return { providerMessageId: payload.id };
  }

  async getMessage(id: string) {
    this.requireOAuth();
    return { id, status: "NOT_AVAILABLE" };
  }

  async getThread(id: string) {
    return [await this.getMessage(id)];
  }

  async getDeliveryStatus(id: string) {
    return (await this.getMessage(id)).status;
  }

  async syncInbox() {
    this.requireOAuth();
    return [];
  }

  private requireOAuth() {
    if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
      throw new AppError("Gmail is not configured.");
    }
  }

  private async accessToken() {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new AppError("Gmail OAuth is not configured.");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      const kind = classifyProviderFailure(response.status, body);
      throw new AppError(providerFailureMessage(kind));
    }
    const payload = JSON.parse(body) as { access_token?: string };
    if (!payload.access_token) throw new AppError("Gmail did not return an access token.");
    return payload.access_token;
  }
}

export const GMAIL_STATE_PURPOSE = "gmail-connect";

export function gmailAuthUrl(state: string) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;
  if (!clientId || !redirectUri) throw new AppError("Gmail OAuth is not configured.");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly");
  url.searchParams.set("state", state);
  return url.toString();
}
