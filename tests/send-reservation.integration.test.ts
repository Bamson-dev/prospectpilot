import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { applyGmailBounce } from "@/lib/email/gmail-bounce";
import { acquireRecipientLock, reserveRecipientSend } from "@/lib/email/send-reservation";

// Runs against a real PostgreSQL database. Skipped unless PG_INTEGRATION_URL is set, and refuses any
// database whose name does not end in _test. Set PG_INTEGRATION_ADAPTER=pg to connect through
// @prisma/adapter-pg instead of the native query engine.
const url = process.env.PG_INTEGRATION_URL;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!url)("recipient reservation on PostgreSQL", () => {
  let prisma: PrismaClient;
  const orgs: string[] = [];

  beforeAll(async () => {
    if (!url || !/\/[^/?]*_test(\?|$)/.test(url)) throw new Error("PG_INTEGRATION_URL must point at a database whose name ends in _test.");
    const { PrismaClient } = await import("@prisma/client");
    if (process.env.PG_INTEGRATION_ADAPTER === "pg") {
      const adapterModule = "@prisma/adapter-pg";
      const { PrismaPg } = await import(adapterModule);
      prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) } as never);
    } else {
      prisma = new PrismaClient({ datasourceUrl: url });
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await prisma.$disconnect();
  });

  async function seedOrg() {
    const org = await prisma.organization.create({ data: { name: "Reservation test", slug: `reservation-${randomUUID()}` } });
    orgs.push(org.id);
    return org.id;
  }

  async function seedMessage(organizationId: string, contactEmail: string, state: "APPROVED" | "SENT" | "FAILED" = "APPROVED") {
    const prospect = await prisma.prospect.create({ data: { organizationId, companyName: `Company ${randomUUID()}`, source: "test" } });
    const contact = await prisma.contact.create({ data: { organizationId, prospectId: prospect.id, email: contactEmail, source: "test" } });
    return prisma.outreachMessage.create({ data: { organizationId, prospectId: prospect.id, contactId: contact.id, subject: "Subject here now", body: "Body", state } });
  }

  const states = async (ids: string[]) => (await prisma.outreachMessage.findMany({ where: { id: { in: ids } }, select: { id: true, state: true } })).map((m) => m.state).sort();

  it("lets exactly one of two concurrent messages to one address claim SENDING", async () => {
    const org = await seedOrg();
    const a = await seedMessage(org, "Owner@Example.com");
    const b = await seedMessage(org, "  owner@example.com");
    const results = await Promise.all([
      reserveRecipientSend(prisma, { messageId: a.id, organizationId: org, email: "Owner@Example.com" }),
      reserveRecipientSend(prisma, { messageId: b.id, organizationId: org, email: "owner@example.com" }),
    ]);
    expect(results.filter((r) => r === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r === "duplicate-recipient")).toHaveLength(1);
    expect(await states([a.id, b.id])).toEqual(["CANCELLED", "SENDING"]);
  });

  it("holds up under many concurrent attempts for one address", async () => {
    const org = await seedOrg();
    const messages = await Promise.all(Array.from({ length: 8 }, (_, i) => seedMessage(org, i % 2 ? "TEAM@example.com" : "team@example.com")));
    const results = await Promise.all(messages.map((m) => reserveRecipientSend(prisma, { messageId: m.id, organizationId: org, email: "team@example.com" })));
    expect(results.filter((r) => r === "claimed")).toHaveLength(1);
    const sending = await prisma.outreachMessage.count({ where: { organizationId: org, state: "SENDING" } });
    expect(sending).toBe(1);
  });

  it("does not serialize different addresses or different organizations", async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    const one = await seedMessage(orgA, "one@example.com");
    const two = await seedMessage(orgA, "two@example.com");
    const other = await seedMessage(orgB, "one@example.com");
    const results = await Promise.all([
      reserveRecipientSend(prisma, { messageId: one.id, organizationId: orgA, email: "one@example.com" }),
      reserveRecipientSend(prisma, { messageId: two.id, organizationId: orgA, email: "two@example.com" }),
      reserveRecipientSend(prisma, { messageId: other.id, organizationId: orgB, email: "one@example.com" }),
    ]);
    expect(results).toEqual(["claimed", "claimed", "claimed"]);
  });

  it("cancels a message when the address was already sent, and retries a failed message", async () => {
    const org = await seedOrg();
    const sent = await seedMessage(org, "sent@example.com", "SENT");
    const later = await seedMessage(org, "SENT@example.com");
    expect(await reserveRecipientSend(prisma, { messageId: later.id, organizationId: org, email: "SENT@example.com" })).toBe("duplicate-recipient");
    expect(await states([sent.id, later.id])).toEqual(["CANCELLED", "SENT"]);
    const failed = await seedMessage(org, "retry@example.com", "FAILED");
    expect(await reserveRecipientSend(prisma, { messageId: failed.id, organizationId: org, email: "retry@example.com" })).toBe("claimed");
  });

  it("enforces the per-domain daily limit under concurrency and counts stale SENDING rows", async () => {
    const org = await seedOrg();
    const messages = await Promise.all(Array.from({ length: 6 }, (_, i) => seedMessage(org, `person${i}@limit.example`)));
    const results = await Promise.all(messages.map((m, i) => reserveRecipientSend(prisma, { messageId: m.id, organizationId: org, email: `person${i}@limit.example`, domainDailyLimit: 2 })));
    expect(results.filter((r) => r === "claimed")).toHaveLength(2);
    expect(results.filter((r) => r === "domain-limit")).toHaveLength(4);
    expect(await prisma.outreachMessage.count({ where: { organizationId: org, state: "SENDING" } })).toBe(2);
    // A claim left in SENDING from an earlier day still holds its slot until someone reconciles it.
    const org2 = await seedOrg();
    const stale = await seedMessage(org2, "old@stale.example");
    await prisma.outreachMessage.update({ where: { id: stale.id }, data: { state: "SENDING" } });
    await prisma.$executeRaw`UPDATE "OutreachMessage" SET "updatedAt" = now() - interval '3 days' WHERE id = ${stale.id}`;
    const fresh = await seedMessage(org2, "new@stale.example");
    expect(await reserveRecipientSend(prisma, { messageId: fresh.id, organizationId: org2, email: "new@stale.example", domainDailyLimit: 1 })).toBe("domain-limit");
    const other = await seedMessage(org2, "new@other.example");
    expect(await reserveRecipientSend(prisma, { messageId: other.id, organizationId: org2, email: "new@other.example", domainDailyLimit: 1 })).toBe("claimed");

    // Whitespace in legacy contact records must not bypass the per-domain cap.
    const org3 = await seedOrg();
    const whitespaceExisting = await seedMessage(org3, " old@space.example ");
    await prisma.outreachMessage.update({ where: { id: whitespaceExisting.id }, data: { state: "SENDING" } });
    const whitespaceFresh = await seedMessage(org3, "new@space.example");
    expect(await reserveRecipientSend(prisma, {
      messageId: whitespaceFresh.id,
      organizationId: org3,
      email: "new@space.example",
      domainDailyLimit: 1,
    })).toBe("domain-limit");
  });

  it("records one outcome when two inbox syncs process the same bounce notice at once", async () => {
    const org = await seedOrg();
    const sent = await seedMessage(org, "gone@bounce.example", "SENT");
    await prisma.outreachMessage.update({ where: { id: sent.id }, data: { providerMessageId: "gm-sent-1" } });
    const args = { organizationId: org, gmailMessageId: "dsn-1", bounce: { recipient: "gone@bounce.example", status: "5.1.1", kind: "permanent" as const }, verifyOrigin: async () => true };
    const results = await Promise.all([applyGmailBounce(prisma as never, args), applyGmailBounce(prisma as never, args), applyGmailBounce(prisma as never, args)]);
    expect(results.filter((r) => r === "suppressed")).toHaveLength(1);
    expect(results.filter((r) => r === "already-recorded")).toHaveLength(2);
    expect(await prisma.activityLog.count({ where: { organizationId: org, detail: { contains: "gmail-dsn:dsn-1" } } })).toBe(1);
    expect(await prisma.suppression.count({ where: { organizationId: org, email: "gone@bounce.example" } })).toBe(1);
    const forged = await applyGmailBounce(prisma as never, { ...args, gmailMessageId: "dsn-2", verifyOrigin: async () => false, bounce: { ...args.bounce, recipient: "other@bounce.example" } });
    expect(forged).toBe("unresolved");
  });

  it("holds the advisory lock until the transaction ends and makes a second transaction wait", async () => {
    const org = await seedOrg();
    const events: string[] = [];
    const first = prisma.$transaction(async (tx) => {
      await acquireRecipientLock(tx, org, "lock@example.com");
      const held = await tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted`;
      events.push(`first holds ${held[0]?.n}`);
      await sleep(400);
      events.push("first commits");
    });
    await sleep(100);
    const second = prisma.$transaction(async (tx) => {
      events.push("second asks");
      await acquireRecipientLock(tx, org, " LOCK@example.com ");
      events.push("second acquired");
    });
    await Promise.all([first, second]);
    expect(events).toEqual(["first holds 1", "second asks", "first commits", "second acquired"]);
    const leftover = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted`;
    expect(leftover[0]?.n).toBe(0);
  }, 15000);
});
