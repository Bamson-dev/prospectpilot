import { beforeEach, describe, expect, it, vi } from "vitest";

const suppress = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/session", () => ({ verifyUnsubscribeToken: async (t: string) => (t === "good" ? "c1" : null) }));
vi.mock("@/lib/unsubscribe", () => ({ suppressContactForUnsubscribe: (...args: unknown[]) => suppress(...args) }));

const call = async (method: string, query: string, body?: string) => {
  const mod = await import("@/app/unsubscribe/one-click/route");
  const handler = (mod as Record<string, unknown>)[method] as ((r: Request) => Promise<Response>) | undefined;
  if (!handler) return null;
  return handler(new Request(`https://x.test/unsubscribe/one-click${query}`, { method, body }));
};

describe("one-click unsubscribe route", () => {
  beforeEach(() => suppress.mockReset());
  it("suppresses on a valid one-click POST without a session", async () => {
    suppress.mockResolvedValue("a@b.com");
    const res = await call("POST", "?token=good", "List-Unsubscribe=One-Click");
    expect(res?.status).toBe(200);
    expect(suppress).toHaveBeenCalledWith({}, "c1");
  });
  it("rejects a bad token, a missing token and a wrong body", async () => {
    expect((await call("POST", "?token=bad", "List-Unsubscribe=One-Click"))?.status).toBe(400);
    expect((await call("POST", "", "List-Unsubscribe=One-Click"))?.status).toBe(400);
    expect((await call("POST", "?token=good", "nothing"))?.status).toBe(400);
    expect(suppress).not.toHaveBeenCalled();
  });
  it("returns 404 when the contact is gone and exposes no GET handler", async () => {
    suppress.mockResolvedValue(null);
    expect((await call("POST", "?token=good", "List-Unsubscribe=One-Click"))?.status).toBe(404);
    expect(await call("GET", "?token=good")).toBeNull();
  });
});

describe("unsubscribe token lifetime", () => {
  it("still verifies a token after more than a year", async () => {
    vi.resetModules();
    vi.doUnmock("@/lib/session");
    process.env.AUTH_SECRET = "unsubscribe-test-secret-with-more-than-32-chars";
    const session = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
    const token = await session.signUnsubscribeToken("c9");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 800 * 24 * 3600 * 1000));
    expect(await session.verifyUnsubscribeToken(token)).toBe("c9");
    vi.useRealTimers();
  });
});
