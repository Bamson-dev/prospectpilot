import { createHash } from "node:crypto";
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

export function webhookStateTransition(current: string, type: string) {
  const write = providerEventWrite(type);
  if (!write || !write.from.includes(current as OutreachState)) return current;
  return write.state;
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

export function inboundReplyId(eventId: string) {
  return `svix:${eventId}`;
}

export function inboundReplyDecision(existingIds: string[], eventId: string) {
  if (!eventId) return "ignore" as const;
  if (existingIds.includes(inboundReplyId(eventId))) return "duplicate" as const;
  return "store" as const;
}

export function prospectOutreachAfterProviderEvent(current: string, type: string) {
  const write = providerEventWrite(type);
  if (!write || !write.from.includes(current as OutreachState)) return current;
  return write.state;
}

export function prospectOutreachAfterBounce(current: string) {
  return prospectOutreachAfterProviderEvent(current, "email.bounced");
}

export function classifyJobId(replyId: string) {
  const digest = createHash("sha256").update(replyId).digest("hex").slice(0, 32);
  return `classify_${digest}`;
}

export function replyWorkDecision(classification: string, suppression: boolean) {
  if (suppression) return "suppress" as const;
  if (classification === "UNCLASSIFIED") return "classify" as const;
  return "skip" as const;
}
