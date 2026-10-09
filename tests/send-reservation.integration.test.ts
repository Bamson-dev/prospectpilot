import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
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
