import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectInboxMessageIds, inboxMaxPages, inboxPageSize } from "@/lib/email/inbox-pages";

describe("collectInboxMessageIds", () => {
  it("follows nextPageToken through every page", async () => {
    const pages: Record<string, { ids: string[]; nextPageToken?: string }> = {
      first: { ids: ["a", "b"], nextPageToken: "t2" },
      t2: { ids: ["c"], nextPageToken: "t3" },
      t3: { ids: ["d"] },
    };
    const calls: Array<string | undefined> = [];
    const result = await collectInboxMessageIds(async (token) => { calls.push(token); return pages[token ?? "first"]; }, { maxPages: 5 });
    expect(result).toEqual({ ids: ["a", "b", "c", "d"], pages: 3, truncated: false });
    expect(calls).toEqual([undefined, "t2", "t3"]);
  });
  it("handles an empty inbox", async () => {
    expect(await collectInboxMessageIds(async () => ({ ids: [] }), { maxPages: 3 })).toEqual({ ids: [], pages: 1, truncated: false });
  });
  it("removes repeated message ids across pages", async () => {
    const result = await collectInboxMessageIds(async (token) => (token ? { ids: ["b", "c"] } : { ids: ["a", "b"], nextPageToken: "t" }), { maxPages: 3 });
    expect(result.ids).toEqual(["a", "b", "c"]);
  });
  it("stops at the page limit and reports truncation", async () => {
    let n = 0;
    const result = await collectInboxMessageIds(async () => { n += 1; return { ids: [`m${n}`], nextPageToken: `t${n}` }; }, { maxPages: 3 });
    expect(result).toEqual({ ids: ["m1", "m2", "m3"], pages: 3, truncated: true });
    expect(n).toBe(3);
  });
  it("reports an incomplete listing when Gmail repeats a page token", async () => {
    let n = 0;
    const result = await collectInboxMessageIds(async () => { n += 1; return { ids: [`m${n}`], nextPageToken: "same" }; }, { maxPages: 10 });
    expect(n).toBe(2);
    expect(result.truncated).toBe(true);
  });
  it("propagates a page failure instead of returning a partial result", async () => {
    let n = 0;
    await expect(collectInboxMessageIds(async () => { n += 1; if (n === 2) throw new Error("Gmail inbox sync failed with status 500."); return { ids: ["a"], nextPageToken: "t" }; }, { maxPages: 5 })).rejects.toThrow(/status 500/);
  });
  it("reads bounded limits from the environment", () => {
    expect(inboxPageSize(undefined)).toBe(50);
    expect(inboxPageSize("100")).toBe(100);
    expect(inboxPageSize("500")).toBe(50);
    expect(inboxMaxPages(undefined)).toBe(5);
    expect(inboxMaxPages("0")).toBe(5);
    expect(inboxMaxPages("20")).toBe(20);
  });
});

const imported: string[] = [];
vi.mock("@/lib/db", () => ({
  prisma: {
    emailAccount: { findMany: vi.fn(async () => [{ id: "acc", refreshTokenEncrypted: "enc" }]), update: vi.fn(async () => ({})) },
    contact: { findFirst: vi.fn(async () => null) },
    employerReply: { findUnique: vi.fn(async () => null) },
    jobApplication: { findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/crypto", () => ({ decryptSecret: () => "refresh" }));
vi.mock("@/lib/jobs", () => ({ queueJob: vi.fn() }));

describe("processInboxSync pagination", () => {
  beforeEach(() => { imported.length = 0; process.env.GMAIL_CLIENT_ID = "id"; process.env.GMAIL_CLIENT_SECRET = "secret"; process.env.INBOX_SYNC_MAX_PAGES = "2"; });
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("lists every page, fetches each message once, and fails visibly when the page limit hides older mail", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("oauth2.googleapis.com")) return respond({ access_token: "tok" });
      const u = new URL(url);
      if (u.pathname.endsWith("/messages")) {
        const token = u.searchParams.get("pageToken");
        return respond(token ? { messages: [{ id: "m3" }], nextPageToken: "t3" } : { messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "t2" });
      }
      imported.push(u.pathname.split("/").pop()!);
      return respond({ snippet: "", payload: { headers: [{ name: "From", value: "someone@nowhere.test" }, { name: "Subject", value: "hi" }] } });
    }));
    const { processInboxSync } = await import("@/worker/processors/inbox");
    await expect(processInboxSync("org")).rejects.toThrow(/stopped at 2 pages/);
    expect(imported.sort()).toEqual(["m1", "m2", "m3"]);
    expect(urls.some((u) => u.includes("pageToken=t2"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("fails the sync when a list page request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com")) return respond({ access_token: "tok" });
      return new Response("boom", { status: 500 });
    }));
    const { processInboxSync } = await import("@/worker/processors/inbox");
    await expect(processInboxSync("org")).rejects.toThrow(/status 500/);
    vi.unstubAllGlobals();
  });
});
