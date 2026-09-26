export type OutboundEmail = {
  to: string;
  from: string;
  fromName?: string | null;
  subject: string;
  text: string;
  replyTo?: string | null;
};

export type SendResult = {
  providerMessageId: string;
};

export type ProviderMessage = {
  id: string;
  status: string;
};

export interface EmailProvider {
  readonly name: "resend" | "gmail";
  sendEmail(message: OutboundEmail): Promise<SendResult>;
  getMessage(id: string): Promise<ProviderMessage>;
  getThread(id: string): Promise<ProviderMessage[]>;
  getDeliveryStatus(id: string): Promise<string>;
  syncInbox(): Promise<ProviderMessage[]>;
}

export function sanitizeOutbound(message: OutboundEmail): OutboundEmail {
  const to = message.to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error("The contact does not have a usable email address.");
  }
  const subject = message.subject.replace(/[\r\n]+/g, " ").trim();
  const from = message.from.replace(/[\r\n]+/g, " ").trim();
  const text = message.text.replace(/\r\n/g, "\n").trim();
  if (!from || !subject || !text) throw new Error("The email is missing a sender, subject, or body.");
  if (subject.length > 200) throw new Error("The subject line is too long.");
  if (text.length > 8000) throw new Error("The email body is too long.");
  return { ...message, to, from, subject, text };
}
