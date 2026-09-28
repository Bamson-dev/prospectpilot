import type { OutreachState } from "@prisma/client";

const DISMISSABLE = new Set(["DRAFT", "PENDING_APPROVAL", "APPROVED", "QUEUED", "SCHEDULED"]);
const ALREADY_SENT = new Set(["SENT", "DELIVERED", "OPENED", "REPLIED"]);
const SENDABLE = new Set(["APPROVED", "QUEUED"]);
const DO_NOT_RESEND = new Set(["FAILED", "SENDING"]);

export function canApproveOutreach(state: string) {
  return state === "PENDING_APPROVAL";
}

export function canDismissOutreach(state: string) {
  return DISMISSABLE.has(state);
}

export function outreachSendDecision(state: string) {
  if (ALREADY_SENT.has(state)) return "already-sent" as const;
  if (DO_NOT_RESEND.has(state)) return "do-not-resend" as const;
  if (SENDABLE.has(state)) return "send" as const;
  return "refuse" as const;
}

export function providerEventWrite(type: string): { state: OutreachState; from: OutreachState[]; error: string | null } | null {
  if (type === "email.delivered") return { state: "DELIVERED", from: ["SENT"], error: null };
  if (type === "email.opened") return { state: "OPENED", from: ["SENT", "DELIVERED"], error: null };
  if (type === "email.bounced") {
    return { state: "FAILED", from: ["SENDING", "SENT", "DELIVERED", "OPENED"], error: "The provider reported a bounce." };
  }
  return null;
}

export function webhookTimestampFresh(timestamp: string, nowMs: number) {
  if (!/^\d{10,13}$/.test(timestamp)) return false;
  const raw = Number(timestamp);
  const ms = raw > 10_000_000_000 ? raw : raw * 1000;
  return Math.abs(nowMs - ms) <= 5 * 60 * 1000;
}

export function onlyMatchingContact<T>(contacts: T[]) {
  return contacts.length === 1 ? contacts[0] : null;
}
