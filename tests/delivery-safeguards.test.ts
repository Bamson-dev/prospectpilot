import { afterEach, describe, expect, it, vi } from "vitest";
import { listUnsubscribeHeaders, sanitizeOutbound } from "@/lib/email/types";
import { applyGmailBounce, gmailPlainText, isBounceSender, parseGmailBounce } from "@/lib/email/gmail-bounce";
import { suppressContactForUnsubscribe } from "@/lib/unsubscribe";
import { defaultDomainDailyLimit, domainLockKey, recipientDomain, reserveRecipientSend } from "@/lib/email/send-reservation";
import { listStuckSending, reconcileMessage } from "@/lib/email/reconcile";

const base = { to: "a@example.com", from: "me@example.org", subject: "Hi", text: "Body" };

describe("List-Unsubscribe headers", () => {
  it("builds RFC 8058 one-click headers", () => {
    expect(listUnsubscribeHeaders("https://x.test/unsubscribe/one-click?token=t")).toEqual([
      ["List-Unsubscribe", "<https://x.test/unsubscribe/one-click?token=t>"],
      ["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"],
    ]);
    expect(listUnsubscribeHeaders(null)).toEqual([]);
  });
  it("rejects a non-HTTPS unsubscribe URL", () => {
    expect(() => sanitizeOutbound({ ...base, listUnsubscribeUrl: "http://x.test/u" })).toThrow(/HTTPS/);
    expect(() => sanitizeOutbound({ ...base, listUnsubscribeUrl: "https://x.test/u\r\nBcc: z@z.com" })).toThrow(/HTTPS/);
  });
  it("puts the headers into the Gmail request body", async () => {
    process.env.GMAIL_CLIENT_ID = "id";
    process.env.GMAIL_CLIENT_SECRET = "secret";
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: unknown }) => {
      calls.push({ url, body: String(init.body) });
      return url.includes("oauth2") ? new Response(JSON.stringify({ access_token: "t" })) : new Response(JSON.stringify({ id: "gm1" }));
    }));
    const { GmailProvider } = await import("@/lib/email/gmail");
    await new GmailProvider("refresh").sendEmail({ ...base, listUnsubscribeUrl: "https://x.test/unsubscribe/one-click?token=t" });
    const send = calls.find((c) => c.url.includes("messages/send"))!;
    const raw = Buffer.from(JSON.parse(send.body).raw, "base64url").toString("utf8");
    expect(raw).toContain("List-Unsubscribe: <https://x.test/unsubscribe/one-click?token=t>");
    expect(raw).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  });
  afterEach(() => vi.unstubAllGlobals());
});

const dsn = (extra = "") => `Delivery has failed\n\nReporting-MTA: dns; googlemail.com\n\nFinal-Recipient: rfc822; Bad@Example.com\nAction: failed\nStatus: 5.1.1\n${extra}`;

describe("Gmail bounce parsing", () => {
  it("recognizes mail system senders only", () => {
    expect(isBounceSender("Mail Delivery Subsystem <mailer-daemon@googlemail.com>")).toBe(true);
    expect(isBounceSender("Jo <jo@example.com>")).toBe(false);
  });
  it("reads a permanent failure from delivery-status fields", () => {
    expect(parseGmailBounce({ headers: {}, body: dsn() })).toEqual({ recipient: "bad@example.com", status: "5.1.1", kind: "permanent" });
  });
  it("reads X-Failed-Recipients", () => {
    expect(parseGmailBounce({ headers: { "x-failed-recipients": "bad@example.com" }, body: "Status: 5.1.1\nAction: failed" })?.recipient).toBe("bad@example.com");
  });
  it("treats 4.x.x and delayed notices as temporary", () => {
    expect(parseGmailBounce({ headers: {}, body: "Final-Recipient: rfc822; a@b.com\nAction: delayed\nStatus: 4.4.1" })?.kind).toBe("temporary");
  });
  it("returns null when two recipients or no status code appear", () => {
    expect(parseGmailBounce({ headers: {}, body: "Final-Recipient: rfc822; a@b.com\nFinal-Recipient: rfc822; c@d.com\nStatus: 5.1.1" })).toBeNull();
    expect(parseGmailBounce({ headers: {}, body: "Final-Recipient: rfc822; a@b.com" })).toBeNull();
    expect(parseGmailBounce({ headers: {}, body: "Mail sent OK" })).toBeNull();
  });
  it("flattens Gmail API delivery-status part headers", () => {
    const part = { mimeType: "multipart/report", parts: [
      { mimeType: "message/delivery-status", parts: [{ headers: [{ name: "Final-Recipient", value: "rfc822; bad@example.com" }, { name: "Action", value: "failed" }, { name: "Status", value: "5.1.1" }] }] },
    ] };
    expect(parseGmailBounce({ headers: {}, body: gmailPlainText(part) })?.recipient).toBe("bad@example.com");
  });
});

function bounceDb(opts: { sentTo?: string[]; org?: string } = {}) {
  const logs: Array<{ organizationId: string; action: string; detail: string }> = [];
  const suppressions: Array<{ organizationId: string; email: string; reason: string; source: string }> = [];
  const contactUpdates: unknown[] = [];
  const followUps: unknown[] = [];
  const sentTo = (opts.sentTo ?? []).map((e) => e.toLowerCase());
  return {
    logs, suppressions, contactUpdates, followUps,
    outreachMessage: { async findMany({ where }: { where: { organizationId: string; contact: { email: { equals: string } } } }) {
      return where.organizationId === (opts.org ?? "org-1") && sentTo.includes(where.contact.email.equals.toLowerCase()) ? [{ prospectId: "p1" }] : [];
    } },
    suppression: { async upsert({ where, update, create }: { where: { organizationId_email: { organizationId: string; email: string } }; update: object; create: { organizationId: string; email: string; reason: string; source: string } }) {
      const found = suppressions.find((s) => s.organizationId === where.organizationId_email.organizationId && s.email === where.organizationId_email.email);
      if (!found) suppressions.push(create); else Object.assign(found, update);
    } },
    contact: { async updateMany(args: unknown) { contactUpdates.push(args); return { count: 1 }; } },
    followUp: { async updateMany(args: unknown) { followUps.push(args); return { count: 1 }; } },
    activityLog: {
      async findFirst({ where }: { where: { organizationId: string; detail: { contains: string } } }) { return logs.find((l) => l.organizationId === where.organizationId && l.detail.includes(where.detail.contains)) ? { id: "x" } : null; },
      async create({ data }: { data: { organizationId: string; action: string; detail: string } }) { logs.push(data); },
    },
  };
}
const permanent = { recipient: "bad@example.com", status: "5.1.1", kind: "permanent" as const };

describe("Gmail bounce handling", () => {
  it("suppresses a confirmed permanent bounce, case-insensitively, and cancels follow-ups", async () => {
    const db = bounceDb({ sentTo: ["Bad@Example.com"] });
    expect(await applyGmailBounce(db as never, { organizationId: "org-1", gmailMessageId: "g1", bounce: permanent })).toBe("suppressed");
    expect(db.suppressions).toEqual([{ organizationId: "org-1", email: "bad@example.com", reason: "hard_bounce", source: "gmail_dsn" }]);
    expect(db.contactUpdates).toHaveLength(1);
    expect(db.followUps).toHaveLength(1);
  });
  it("is idempotent for the same Gmail message", async () => {
    const db = bounceDb({ sentTo: ["bad@example.com"] });
    await applyGmailBounce(db as never, { organizationId: "org-1", gmailMessageId: "g1", bounce: permanent });
    expect(await applyGmailBounce(db as never, { organizationId: "org-1", gmailMessageId: "g1", bounce: permanent })).toBe("already-recorded");
    expect(db.suppressions).toHaveLength(1);
  });
  it("keeps an earlier suppression reason", async () => {
    const db = bounceDb({ sentTo: ["bad@example.com"] });
    db.suppressions.push({ organizationId: "org-1", email: "bad@example.com", reason: "Unsubscribe link", source: "unsubscribe-link" });
    await applyGmailBounce(db as never, { organizationId: "org-1", gmailMessageId: "g2", bounce: permanent });
    expect(db.suppressions[0].reason).toBe("Unsubscribe link");
  });
  it("does not suppress an address this organization never contacted", async () => {
    const db = bounceDb({ sentTo: ["other@example.com"] });
    expect(await applyGmailBounce(db as never, { organizationId: "org-1", gmailMessageId: "g3", bounce: permanent })).toBe("unresolved");
    expect(db.suppressions).toHaveLength(0);
  });
  it("does not suppress across organizations", async () => {
    const db = bounceDb({ sentTo: ["bad@example.com"], org: "org-2" });
    expect(await applyGmailBounce(db as never, { organizationId: "org-1", gmailMessageId: "g4", bounce: permanent })).toBe("unresolved");
  });
  it("logs but does not suppress temporary failures or unparseable notices", async () => {
    const db = bounceDb({ sentTo: ["bad@example.com"] });
    expect(await applyGmailBounce(db as never, { organizationId: "org-1", gmailMessageId: "g5", bounce: { ...permanent, status: "4.4.1", kind: "temporary" } })).toBe("temporary-logged");
    expect(await applyGmailBounce(db as never, { organizationId: "org-1", gmailMessageId: "g6", bounce: null })).toBe("unresolved");
    expect(db.suppressions).toHaveLength(0);
    expect(db.logs.map((l) => l.action)).toEqual(["outreach.bounce_temporary", "outreach.bounce_unresolved"]);
  });
});

describe("unsubscribe suppression", () => {
  it("suppresses every contact with the address and keeps an earlier reason", async () => {
    const suppressions: Array<{ reason: string }> = [{ reason: "hard_bounce" }];
    const db = {
      contact: { findUnique: async () => ({ id: "c1", email: "User@Example.com", organizationId: "org-1", prospectId: "p1" }), updateMany: vi.fn(async () => ({ count: 2 })) },
      suppression: { upsert: vi.fn(async ({ update }: { update: object }) => { Object.assign(suppressions[0], update); }) },
      followUp: { updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    expect(await suppressContactForUnsubscribe(db as never, "c1")).toBe("user@example.com");
    expect(suppressions[0].reason).toBe("hard_bounce");
    expect(db.contact.updateMany).toHaveBeenCalledWith({ where: { organizationId: "org-1", email: { equals: "user@example.com", mode: "insensitive" } }, data: { suppressed: true } });
    expect(db.followUp.updateMany).toHaveBeenCalled();
  });
  it("returns null when the contact is missing", async () => {
    const db = { contact: { findUnique: async () => null }, suppression: {}, followUp: {} };
    expect(await suppressContactForUnsubscribe(db as never, "none")).toBeNull();
  });
});

describe("per-domain daily limit", () => {
  it("normalizes domains and reads the limit", () => {
    expect(recipientDomain(" Jo@Example.COM ")).toBe("example.com");
    expect(domainLockKey("o", "Example.com")).toBe("outreach-domain:o:example.com");
    expect(defaultDomainDailyLimit(undefined)).toBe(2);
    expect(defaultDomainDailyLimit("5")).toBe(5);
    expect(defaultDomainDailyLimit("0")).toBe(2);
  });
  it("refuses to claim when the domain already used its limit, and claims otherwise", async () => {
    const make = (used: number) => {
      const claimed: string[] = [];
      const tx = {
        $executeRaw: vi.fn(async () => 0),
        outreachMessage: {
          findMany: async () => [],
          count: vi.fn(async () => used),
          updateMany: async ({ where }: { where: { id: string } }) => { claimed.push(where.id); return { count: 1 }; },
        },
      };
      return { claimed, tx, db: { $transaction: async <T,>(fn: (t: never) => Promise<T>) => fn(tx as never) } };
    };
    const full = make(2);
    expect(await reserveRecipientSend(full.db as never, { messageId: "m", organizationId: "o", email: "a@Example.com", domainDailyLimit: 2 })).toBe("domain-limit");
    expect(full.claimed).toEqual([]);
    const room = make(1);
    expect(await reserveRecipientSend(room.db as never, { messageId: "m", organizationId: "o", email: "a@Example.com", domainDailyLimit: 2 })).toBe("claimed");
    expect(room.tx.$executeRaw).toHaveBeenCalledTimes(2);
  });
});

describe("reconciliation", () => {
  const stuckRow = { id: "m1", provider: "GMAIL", error: "Delivery unconfirmed: timeout", updatedAt: new Date("2026-10-09T10:00:00Z"), contact: { email: "a@b.com" }, campaign: null };
  it("lists stuck messages without changing anything", async () => {
    const db = { outreachMessage: { findMany: vi.fn(async () => [stuckRow]), updateMany: vi.fn() }, prospect: { update: vi.fn() }, activityLog: { create: vi.fn() } };
    const rows = await listStuckSending(db as never, { thresholdMinutes: 15, now: new Date("2026-10-09T11:00:00Z") });
    expect(rows).toEqual([{ id: "m1", provider: "GMAIL", recipient: "a@b.com", minutesInSending: 60, lastResult: "Delivery unconfirmed: timeout" }]);
    expect(db.outreachMessage.updateMany).not.toHaveBeenCalled();
  });
  const decide = (state = "SENDING") => {
    const db = {
      outreachMessage: { findUnique: vi.fn(async () => ({ id: "m1", state, organizationId: "o", campaignId: "c", prospectId: "p" })), updateMany: vi.fn(async () => ({ count: 1 })), findMany: vi.fn() },
      prospect: { update: vi.fn() }, activityLog: { create: vi.fn() },
    };
    return db;
  };
  it("requires exact confirmation, evidence and a provider id for sent", async () => {
    const db = decide();
    const input = { messageId: "m1", confirm: "m1", disposition: "sent" as const, evidence: "Found in Gmail Sent folder", providerMessageId: "gm1" };
    await expect(reconcileMessage(db as never, { ...input, confirm: "x" })).rejects.toThrow(/exact message id/);
    await expect(reconcileMessage(db as never, { ...input, evidence: "ok" })).rejects.toThrow(/evidence/);
    await expect(reconcileMessage(db as never, { ...input, providerMessageId: "" })).rejects.toThrow(/provider message id/);
    await expect(reconcileMessage(db as never, { ...input, disposition: "resend" as never })).rejects.toThrow(/Disposition/);
    expect(db.outreachMessage.updateMany).not.toHaveBeenCalled();
    expect(await reconcileMessage(db as never, input)).toBe("SENT");
    expect(db.activityLog.create).toHaveBeenCalled();
  });
  it("moves not-sent to FAILED and refuses messages outside SENDING", async () => {
    expect(await reconcileMessage(decide() as never, { messageId: "m1", confirm: "m1", disposition: "not-sent", evidence: "Provider log shows rejection" })).toBe("FAILED");
    await expect(reconcileMessage(decide("SENT") as never, { messageId: "m1", confirm: "m1", disposition: "not-sent", evidence: "Provider log shows rejection" })).rejects.toThrow(/not in SENDING/);
  });
});
