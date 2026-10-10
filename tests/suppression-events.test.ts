import { describe, expect, it } from "vitest";
import { suppressRecipientForProviderEvent } from "@/lib/email/suppression-events";

function fakeDb(sent: Array<{ providerMessageId: string; organizationId: string; email: string | null }>, suppressions: Array<{ organizationId: string; email: string; reason: string }> = []) {
  const contacts: Array<{ organizationId: string; email: string; suppressed: boolean }> = [
    { organizationId: "org-1", email: "Owner@Example.com", suppressed: false },
    { organizationId: "org-1", email: "other@example.com", suppressed: false },
  ];
  return {
    suppressions,
    contacts,
    outreachMessage: {
      findMany: async ({ where }: { where: { providerMessageId: string } }) =>
        sent.filter((m) => m.providerMessageId === where.providerMessageId).map((m) => ({ organizationId: m.organizationId, contact: m.email ? { email: m.email } : null })),
    },
    suppression: {
      upsert: async ({ where, create }: { where: { organizationId_email: { organizationId: string; email: string } }; create: { organizationId: string; email: string; reason: string } }) => {
        const key = where.organizationId_email;
        const existing = suppressions.find((s) => s.organizationId === key.organizationId && s.email === key.email);
        if (existing) return existing;
        suppressions.push({ organizationId: create.organizationId, email: create.email, reason: create.reason });
        return create;
      },
    },
    contact: {
      updateMany: async ({ where }: { where: { organizationId: string; email: { equals: string } } }) => {
        let count = 0;
        for (const c of contacts) {
          if (c.organizationId === where.organizationId && c.email.toLowerCase() === where.email.equals.toLowerCase()) {
            c.suppressed = true;
            count += 1;
          }
        }
        return { count };
      },
    },
  };
}

describe("bounce and complaint suppression", () => {
  const sent = [{ providerMessageId: "re_1", organizationId: "org-1", email: "Owner@Example.com" }, { providerMessageId: "re_2", organizationId: "org-1", email: "other@example.com" }];

  it("suppresses only the recipient of the bounced message, case-insensitively", async () => {
    const db = fakeDb(sent);
    expect(await suppressRecipientForProviderEvent(db as never, "email.bounced", "re_1")).toBe(1);
    expect(db.suppressions).toEqual([{ organizationId: "org-1", email: "owner@example.com", reason: "hard_bounce" }]);
    expect(db.contacts.map((c) => c.suppressed)).toEqual([true, false]);
  });

  it("records a complaint with its own reason", async () => {
    const db = fakeDb(sent);
    await suppressRecipientForProviderEvent(db as never, "email.complained", "re_2");
    expect(db.suppressions[0]?.reason).toBe("spam_complaint");
  });

  it("is idempotent when the provider replays the event", async () => {
    const db = fakeDb(sent);
    await suppressRecipientForProviderEvent(db as never, "email.bounced", "re_1");
    await suppressRecipientForProviderEvent(db as never, "email.bounced", "re_1");
    expect(db.suppressions).toHaveLength(1);
  });

  it("keeps an existing suppression entry unchanged", async () => {
    const db = fakeDb(sent, [{ organizationId: "org-1", email: "owner@example.com", reason: "unsubscribed" }]);
    await suppressRecipientForProviderEvent(db as never, "email.bounced", "re_1");
    expect(db.suppressions).toEqual([{ organizationId: "org-1", email: "owner@example.com", reason: "unsubscribed" }]);
  });

  it("ignores delivery events, unknown message ids and messages without a contact", async () => {
    const db = fakeDb([...sent, { providerMessageId: "re_3", organizationId: "org-1", email: null }]);
    expect(await suppressRecipientForProviderEvent(db as never, "email.delivered", "re_1")).toBe(0);
    expect(await suppressRecipientForProviderEvent(db as never, "email.bounced", "unknown")).toBe(0);
    expect(await suppressRecipientForProviderEvent(db as never, "email.bounced", "re_3")).toBe(0);
    expect(await suppressRecipientForProviderEvent(db as never, "email.bounced", "")).toBe(0);
    expect(db.suppressions).toHaveLength(0);
  });
});
