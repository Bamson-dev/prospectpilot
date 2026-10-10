import { describe, expect, it } from "vitest";
import { recipientLockKey, reserveRecipientSend } from "@/lib/email/send-reservation";

type Msg = { id: string; organizationId: string; state: string; email: string; campaignId: string; prospectId: string; error?: string | null };

// In-memory stand-in for PostgreSQL. $executeRaw takes a lock keyed by its first parameter and holds
// it until the transaction ends, like pg_advisory_xact_lock. Each query yields to the event loop so
// two transactions would interleave if the lock were missing.
function fakeDb(messages: Msg[], options: { lock?: boolean } = {}) {
  const useLock = options.lock !== false;
  const locks = new Map<string, Promise<void>>();
  const yieldTick = () => new Promise((resolve) => setTimeout(resolve, 2));
  const inStates = (state: string, filter?: { in?: string[] }) => !filter?.in || filter.in.includes(state);
  return {
    messages,
    async $transaction<T>(fn: (tx: never) => Promise<T>): Promise<T> {
      const held: Array<{ key: string; release: () => void }> = [];
      const tx = {
        async $executeRaw(_strings: TemplateStringsArray, ...values: unknown[]) {
          if (!useLock) return 0;
          const key = String(values[0]);
          for (let current = locks.get(key); current; current = locks.get(key)) await current;
          let release!: () => void;
          locks.set(key, new Promise<void>((resolve) => (release = resolve)));
          held.push({ key, release });
          return 0;
        },
          async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
          await yieldTick();
          const sql = strings.join("");
          if (sql.includes("split_part")) return [{ count: 0n }];
          const [organizationId, messageId, email] = values.map(String);
          return messages
            .filter((m) => m.organizationId === organizationId && m.id !== messageId && CONTACTED_TEST_STATES.has(m.state) && m.email.trim().toLowerCase() === email)
            .map((m) => ({ state: m.state }))
            .slice(0, 1);
        },
        outreachMessage: {
          async findMany({ where }: { where: { organizationId: string; id: { not: string }; state: { in: string[] }; contact: { email: { equals: string } } } }) {
            await yieldTick();
            return messages
              .filter((m) => m.organizationId === where.organizationId && m.id !== where.id.not && inStates(m.state, where.state) && m.email.toLowerCase() === where.contact.email.equals.toLowerCase())
              .map((m) => ({ state: m.state }));
          },
          async updateMany({ where, data }: { where: { id: string; state: { in: string[] } }; data: { state: string; error: string | null } }) {
            await yieldTick();
            const target = messages.find((m) => m.id === where.id && inStates(m.state, where.state));
            if (!target) return { count: 0 };
            target.state = data.state;
            target.error = data.error;
            return { count: 1 };
          },
        },
      };
      try {
        return await fn(tx as never);
      } finally {
        for (const item of held) {
          locks.delete(item.key);
          item.release();
        }
      }
    },
  };
}

const CONTACTED_TEST_STATES = new Set(["SENDING", "SENT", "DELIVERED", "OPENED", "REPLIED"]);

const msg = (id: string, email: string, state = "APPROVED", extra: Partial<Msg> = {}): Msg => ({ id, organizationId: "org-1", state, email, campaignId: `camp-${id}`, prospectId: `pros-${id}`, ...extra });
const reserve = (db: ReturnType<typeof fakeDb>, id: string, email: string, organizationId = "org-1") =>
  reserveRecipientSend(db as never, { messageId: id, organizationId, email });

describe("recipient send reservation", () => {
  it("lets exactly one of two concurrent campaigns send to the same address", async () => {
    const db = fakeDb([msg("a", "owner@example.com"), msg("b", "owner@example.com")]);
    const results = await Promise.all([reserve(db, "a", "owner@example.com"), reserve(db, "b", "owner@example.com")]);
    expect(results.filter((r) => r === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r === "duplicate-recipient")).toHaveLength(1);
    expect(db.messages.filter((m) => m.state === "SENDING")).toHaveLength(1);
    expect(db.messages.filter((m) => m.state === "CANCELLED")).toHaveLength(1);
  });

  it("serializes many prospect records that share one email", async () => {
    const db = fakeDb(["a", "b", "c", "d"].map((id) => msg(id, "team@example.com")));
    const results = await Promise.all(["a", "b", "c", "d"].map((id) => reserve(db, id, "team@example.com")));
    expect(results.filter((r) => r === "claimed")).toHaveLength(1);
    expect(db.messages.filter((m) => m.state === "SENDING")).toHaveLength(1);
  });

  it("allows concurrent sends to different addresses", async () => {
    const db = fakeDb([msg("a", "one@example.com"), msg("b", "two@example.com")]);
    const results = await Promise.all([reserve(db, "a", "one@example.com"), reserve(db, "b", "two@example.com")]);
    expect(results).toEqual(["claimed", "claimed"]);
  });

  it("treats case differences as the same address", async () => {
    const db = fakeDb([msg("a", "Owner@Example.com"), msg("b", "owner@example.COM")]);
    const results = await Promise.all([reserve(db, "a", "Owner@Example.com"), reserve(db, "b", "owner@example.COM")]);
    expect(results.filter((r) => r === "claimed")).toHaveLength(1);
    expect(recipientLockKey("org-1", " Owner@Example.com ")).toBe(recipientLockKey("org-1", "owner@example.com"));
  });

  it("keeps organizations separate", async () => {
    const db = fakeDb([msg("a", "owner@example.com"), msg("b", "owner@example.com", "APPROVED", { organizationId: "org-2" })]);
    const results = await Promise.all([reserve(db, "a", "owner@example.com", "org-1"), reserve(db, "b", "owner@example.com", "org-2")]);
    expect(results).toEqual(["claimed", "claimed"]);
  });

  it("cancels a message when another message already reached the address", async () => {
    for (const state of ["SENT", "DELIVERED", "OPENED", "REPLIED", "SENDING"]) {
      const db = fakeDb([msg("old", "owner@example.com", state), msg("new", "owner@example.com")]);
      expect(await reserve(db, "new", "owner@example.com")).toBe("duplicate-recipient");
      expect(db.messages.find((m) => m.id === "new")?.state).toBe("CANCELLED");
    }
  });

  it("does not let an unsent sibling block a send", async () => {
    const db = fakeDb([msg("old", "owner@example.com", "FAILED"), msg("draft", "owner@example.com", "DRAFT"), msg("gone", "owner@example.com", "CANCELLED"), msg("new", "owner@example.com")]);
    expect(await reserve(db, "new", "owner@example.com")).toBe("claimed");
  });

  it("lets a failed message be claimed again for a retry", async () => {
    const db = fakeDb([msg("a", "owner@example.com", "FAILED", { error: "The email provider rejected the message." })]);
    expect(await reserve(db, "a", "owner@example.com")).toBe("claimed");
    expect(db.messages[0]).toMatchObject({ state: "SENDING", error: null });
  });

  it("does not claim a message that is already sending or sent", async () => {
    for (const state of ["SENDING", "SENT"]) {
      const db = fakeDb([msg("a", "owner@example.com", state)]);
      expect(await reserve(db, "a", "owner@example.com")).toBe("not-claimable");
      expect(db.messages[0]?.state).toBe(state);
    }
  });

  it("commits the SENDING claim before it returns so the provider call runs outside the transaction", async () => {
    const db = fakeDb([msg("a", "owner@example.com")]);
    expect(await reserve(db, "a", "owner@example.com")).toBe("claimed");
    expect(db.messages[0]?.state).toBe("SENDING");
  });

  it("would race without the lock, which shows the test detects the defect", async () => {
    const db = fakeDb([msg("a", "owner@example.com"), msg("b", "owner@example.com")], { lock: false });
    const results = await Promise.all([reserve(db, "a", "owner@example.com"), reserve(db, "b", "owner@example.com")]);
    expect(results.filter((r) => r === "claimed")).toHaveLength(2);
  });
});
