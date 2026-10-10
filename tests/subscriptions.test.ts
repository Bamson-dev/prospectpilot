import { describe, expect, it, vi } from "vitest";
import { CONSENT_VERSION, confirmSubscription, confirmationEmail, consentText, createPendingSubscription, hashToken, validateSubscription } from "@/lib/subscriptions";
import { providerMayCarryContact } from "@/lib/compliance/uk-b2b";
import { suppressContactForUnsubscribe } from "@/lib/unsubscribe";

function makeDb(opts: { suppressed?: boolean; existing?: Record<string, unknown> | null; pending?: Record<string, unknown> | null } = {}) {
  const db = {
    subscriber: {
      findUnique: vi.fn(async () => opts.existing ?? null),
      findFirst: vi.fn(async () => opts.pending ?? null),
      upsert: vi.fn(async (a: unknown) => a),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: "s1", ...a.data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    suppression: { findUnique: vi.fn(async () => (opts.suppressed ? { id: "x" } : null)) },
    prospect: { create: vi.fn(async () => ({ id: "p1" })) },
    contact: { create: vi.fn(async (_a: unknown) => ({ id: "c1" })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db;
}

const input = { organizationId: "o1", email: "a@b.co", name: "A", company: "B", consentText: consentText("Sender"), source: "subscribe-form:/subscribe/x" };

describe("subscription validation", () => {
  it("requires the unticked box to be ticked and a valid email", () => {
    expect(validateSubscription({ email: "a@b.co", consent: false }).ok).toBe(false);
    expect(validateSubscription({ email: "nope", consent: true }).ok).toBe(false);
    expect(validateSubscription({ email: " A@B.co ", name: "x\r\nBcc: y", consent: true })).toEqual({ ok: true, email: "a@b.co", name: "x Bcc: y", company: null });
  });
});

describe("pending subscription", () => {
  it("stores the exact consent wording, version and source with a hashed token", async () => {
    const db = makeDb();
    const token = await createPendingSubscription(db as never, input);
    expect(token).toBeTruthy();
    const args = db.subscriber.upsert.mock.calls[0][0] as { create: Record<string, unknown> };
    expect(args.create).toMatchObject({ consentText: input.consentText, consentVersion: CONSENT_VERSION, source: input.source, confirmTokenHash: hashToken(token!) });
    expect(JSON.stringify(args)).not.toContain(token!);
  });
  it("sends nothing to a suppressed or already confirmed address", async () => {
    expect(await createPendingSubscription(makeDb({ suppressed: true }) as never, input)).toBeNull();
    expect(await createPendingSubscription(makeDb({ existing: { status: "CONFIRMED" } }) as never, input)).toBeNull();
  });
});

describe("confirmation", () => {
  const pending = { id: "s1", organizationId: "o1", email: "a@b.co", name: "A", company: "B", status: "PENDING", contactId: null, createdAt: new Date("2026-10-10T00:00:00Z") };
  it("creates an opt-in contact only after confirmation, and the provider gate accepts it", async () => {
    const db = makeDb({ pending });
    const result = await confirmSubscription(db as never, "t".repeat(43), new Date("2026-10-11T00:00:00Z"));
    expect(result).toMatchObject({ status: "CONFIRMED", contactId: "c1", confirmTokenHash: null });
    const contact = db.contact.create.mock.calls[0][0] as unknown as { data: { source: string; email: string } };
    expect(contact.data).toMatchObject({ source: "opt-in", email: "a@b.co" });
    expect(providerMayCarryContact("GMAIL", contact.data.source, {})).toBe(true);
  });
  it("rejects unknown, expired, short and suppressed tokens without creating a contact", async () => {
    expect(await confirmSubscription(makeDb() as never, "t".repeat(43))).toBeNull();
    expect(await confirmSubscription(makeDb({ pending }) as never, "t".repeat(43), new Date("2026-10-30T00:00:00Z"))).toBeNull();
    expect(await confirmSubscription(makeDb({ pending }) as never, "short")).toBeNull();
    const db = makeDb({ pending, suppressed: true });
    expect(await confirmSubscription(db as never, "t".repeat(43), new Date("2026-10-11T00:00:00Z"))).toBeNull();
    expect(db.contact.create).not.toHaveBeenCalled();
  });
  it("keeps website contacts blocked for Gmail", () => {
    expect(providerMayCarryContact("GMAIL", "website", {})).toBe(false);
  });
  it("builds a confirmation email that quotes the consent and the link", () => {
    const m = confirmationEmail({ senderName: "Sender", confirmUrl: "https://x.test/subscribe/confirm?token=t", consentText: "I agree" });
    expect(m.text).toContain("I agree");
    expect(m.text).toContain("https://x.test/subscribe/confirm?token=t");
  });
});

describe("unsubscribe marks the subscriber", () => {
  it("sets the subscriber to UNSUBSCRIBED alongside suppression and follow-up cancellation", async () => {
    const db = {
      contact: { findUnique: vi.fn(async () => ({ id: "c1", organizationId: "o1", prospectId: "p1", email: "A@b.co" })), updateMany: vi.fn(async () => ({ count: 1 })), findMany: vi.fn(async () => []) },
      suppression: { upsert: vi.fn(async () => ({})) },
      followUp: { updateMany: vi.fn(async () => ({ count: 2 })) },
      subscriber: { updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    expect(await suppressContactForUnsubscribe(db as never, "c1")).toBe("a@b.co");
    expect(db.followUp.updateMany).toHaveBeenCalled();
    expect(db.subscriber.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ email: "a@b.co" }), data: expect.objectContaining({ status: "UNSUBSCRIBED" }) }));
  });
});
