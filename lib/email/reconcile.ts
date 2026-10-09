import type { Prisma } from "@prisma/client";

type ReconcileDb = {
  outreachMessage: Pick<Prisma.OutreachMessageDelegate, "findMany" | "findUnique" | "updateMany">;
  prospect: Pick<Prisma.ProspectDelegate, "update">;
  activityLog: Pick<Prisma.ActivityLogDelegate, "create">;
};

export type StuckMessage = {
  id: string;
  provider: string | null;
  recipient: string | null;
  minutesInSending: number;
  lastResult: string;
};

export function stuckThresholdMinutes(value = process.env.RECONCILE_MIN_AGE_MINUTES) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 15;
}

// Read only. Lists messages that stayed in SENDING after an uncertain provider outcome.
export async function listStuckSending(db: ReconcileDb, options: { thresholdMinutes: number; now?: Date }): Promise<StuckMessage[]> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.thresholdMinutes * 60_000);
  const rows = await db.outreachMessage.findMany({
    where: { state: "SENDING", updatedAt: { lt: cutoff } },
    select: { id: true, provider: true, error: true, updatedAt: true, contact: { select: { email: true } }, campaign: { select: { emailAccount: { select: { provider: true } } } } },
    orderBy: { updatedAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider ?? row.campaign?.emailAccount?.provider ?? null,
    recipient: row.contact?.email ?? null,
    minutesInSending: Math.floor((now.getTime() - row.updatedAt.getTime()) / 60_000),
    lastResult: (row.error ?? "No result recorded").replace(/[\r\n]+/g, " ").slice(0, 160),
  }));
}

export type Disposition = "sent" | "not-sent";

// Records a human decision for one message. It never sends email. It needs the exact message id
// twice (id and confirm), a disposition, and written evidence. Marking a message "sent" also needs
// the provider message id found in the provider's own records.
export async function reconcileMessage(
  db: ReconcileDb,
  input: { messageId: string; confirm: string; disposition: Disposition; evidence: string; providerMessageId?: string; now?: Date },
) {
  if (!input.messageId || input.confirm !== input.messageId) throw new Error("Confirmation must repeat the exact message id.");
  if (input.disposition !== "sent" && input.disposition !== "not-sent") throw new Error("Disposition must be sent or not-sent.");
  const evidence = input.evidence.trim();
  if (evidence.length < 10) throw new Error("Describe the evidence in at least 10 characters.");
  if (input.disposition === "sent" && !input.providerMessageId?.trim()) throw new Error("Marking a message sent needs the provider message id.");
  const message = await db.outreachMessage.findUnique({ where: { id: input.messageId }, select: { id: true, state: true, organizationId: true, campaignId: true, prospectId: true } });
  if (!message || message.state !== "SENDING") throw new Error("That message is not in SENDING.");
  const now = input.now ?? new Date();
  const data: Prisma.OutreachMessageUpdateManyMutationInput =
    input.disposition === "sent"
      ? { state: "SENT", sentAt: now, providerMessageId: input.providerMessageId!.trim(), error: null }
      : { state: "FAILED", error: "Confirmed not sent during manual reconciliation." };
  const result = await db.outreachMessage.updateMany({ where: { id: message.id, organizationId: message.organizationId, state: "SENDING" }, data });
  if (result.count !== 1) throw new Error("The message changed while you were reconciling it.");
  const next = input.disposition === "sent" ? "SENT" : "FAILED";
  await db.prospect.update({ where: { id: message.prospectId }, data: { outreachState: next } });
  await db.activityLog.create({
    data: {
      organizationId: message.organizationId,
      campaignId: message.campaignId,
      prospectId: message.prospectId,
      action: "outreach.reconciled",
      detail: `Message ${message.id} moved from SENDING to ${next}. Evidence: ${evidence.slice(0, 300)}`,
    },
  });
  return next;
}
