import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every database and queue call goes through these mocks. Nothing here touches a real database.
const WRITES = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"] as const;

type Call = { model: string; method: string; args: unknown };
const calls: Call[] = [];

function model(name: string, reads: Record<string, unknown> = {}) {
  const target: Record<string, unknown> = {};
  for (const method of [...WRITES, "findMany", "findFirst", "findUnique", "count", "groupBy"]) {
    target[method] = vi.fn(async (args: unknown) => {
      calls.push({ model: name, method, args });
      if (method in reads) return reads[method];
      if (method === "groupBy" || method === "findMany") return [];
      return method === "count" ? 0 : null;
    });
  }
  return target;
}

const freshModels = () => ({
  campaign: model("campaign", { groupBy: [{ status: "ACTIVE", requireApproval: false, _count: { _all: 2 } }] }),
  outreachMessage: model("outreachMessage", { groupBy: [{ state: "APPROVED", _count: { _all: 3 } }] }),
  backgroundJob: model("backgroundJob", { groupBy: [{ state: "FAILED", _count: { _all: 1 } }] }),
  emailAccount: model("emailAccount", { findMany: [{ status: "ACTIVE" }] }),
  prospect: model("prospect"),
  user: model("user", { findFirst: { id: "admin-1" }, findUnique: { id: "admin-1" } }),
  membership: model("membership", { findMany: [{ role: "ADMIN", organizationId: "org-1", organization: { id: "org-1" } }] }),
});
const fakePrisma: ReturnType<typeof freshModels> = freshModels();

const queueJob = vi.fn();
const readSession = vi.fn();
const processOutreachScan = vi.fn();

vi.mock("@/lib/db", () => ({ prisma: fakePrisma }));
vi.mock("@/lib/jobs", () => ({ queueJob: (...args: unknown[]) => queueJob(...args), recordActivity: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ readSession: () => readSession() }));
vi.mock("@/lib/applications/service", () => ({ ensureCandidate: vi.fn() }));

const writesMade = () => calls.filter((call) => (WRITES as readonly string[]).includes(call.method));
const admin = { user: { id: "admin-1" }, organization: { id: "org-1" } };

beforeEach(() => {
  calls.length = 0;
  Object.assign(fakePrisma, freshModels());
  queueJob.mockReset();
  readSession.mockReset().mockResolvedValue(null);
  processOutreachScan.mockReset();
  process.env.AUTH_SECRET = "test-secret-with-more-than-thirty-two-characters";
  delete process.env.OUTREACH_SEND_ENABLED;
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/app/api/diagnostics/discovery/route");
  vi.doUnmock("@/worker/processors/outreach-scan");
});

// The routes with the real authorizeAdmin. Only the database, session and queue are mocked.
async function loadRoutes(scan: "mock" | "real" = "mock") {
  if (scan === "mock") vi.doMock("@/worker/processors/outreach-scan", () => ({ processOutreachScan }));
  const audit = await import("@/app/api/webhooks/gmail-audit/route");
  const sync = await import("@/app/api/webhooks/outreach-sync/route");
  return { audit, sync };
}

const request = (url: string, init: RequestInit = {}) => new Request(url, init);

describe("unauthenticated requests", () => {
  it("rejects every gmail-audit and outreach-sync request, including doSend=true", async () => {
    const { audit, sync } = await loadRoutes();
    const responses = await Promise.all([
      audit.GET(request("http://localhost/api/webhooks/gmail-audit")),
      audit.GET(request("http://localhost/api/webhooks/gmail-audit?doSend=true")),
      sync.GET(request("http://localhost/api/webhooks/outreach-sync")),
      sync.POST(request("http://localhost/api/webhooks/outreach-sync", { method: "POST" })),
    ]);
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(calls.filter((c) => c.model === "campaign" || c.model === "outreachMessage" || c.model === "backgroundJob")).toEqual([]);
    expect(writesMade()).toEqual([]);
    expect(queueJob).not.toHaveBeenCalled();
    expect(processOutreachScan).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token and a bare Bearer header", async () => {
    const { audit, sync } = await loadRoutes();
    for (const authorization of ["Bearer wrong", "Bearer ", "Bearer undefined", "test-secret"]) {
      expect((await audit.GET(request("http://localhost/a", { headers: { authorization } }))).status).toBe(403);
      expect((await sync.POST(request("http://localhost/b", { method: "POST", headers: { authorization } }))).status).toBe(403);
    }
    expect(processOutreachScan).not.toHaveBeenCalled();
    expect(writesMade()).toEqual([]);
  });

  it("rejects a signed-in member without an admin role", async () => {
    readSession.mockResolvedValue({ sub: "user-2", organizationId: "org-1" });
    fakePrisma.membership.findMany = vi.fn(async () => [{ role: "MEMBER", organizationId: "org-1", organization: { id: "org-1" } }]);
    const { audit, sync } = await loadRoutes();
    expect((await audit.GET(request("http://localhost/a"))).status).toBe(403);
    expect((await sync.POST(request("http://localhost/b", { method: "POST" }))).status).toBe(403);
    expect(processOutreachScan).not.toHaveBeenCalled();
  });

  it("does not leave AUTH_SECRET unset-equals-undefined open", async () => {
    delete process.env.AUTH_SECRET;
    const { audit } = await loadRoutes();
    const response = await audit.GET(request("http://localhost/a", { headers: { authorization: "Bearer undefined" } }));
    expect(response.status).toBe(403);
  });
});

describe("authorized diagnostics are read-only", () => {
  const headers = { authorization: "Bearer test-secret-with-more-than-thirty-two-characters" };

  it("gmail-audit GET reads counts and writes nothing, even with doSend=true", async () => {
    const { audit } = await loadRoutes();
    for (const url of ["http://localhost/api/webhooks/gmail-audit", "http://localhost/api/webhooks/gmail-audit?doSend=true&doSend=1"]) {
      const response = await audit.GET(request(url, { headers }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.messages).toEqual({ APPROVED: 3 });
      expect(body.sendingEnabled).toBe(false);
    }
    expect(writesMade()).toEqual([]);
    expect(queueJob).not.toHaveBeenCalled();
    expect(processOutreachScan).not.toHaveBeenCalled();
  });

  it("gmail-audit exposes no write handlers", async () => {
    const { audit } = await loadRoutes();
    expect(Object.keys(audit).filter((key) => ["POST", "PUT", "PATCH", "DELETE"].includes(key))).toEqual([]);
  });

  it("reads are limited to the caller's organization", async () => {
    const { audit, sync } = await loadRoutes();
    await audit.GET(request("http://localhost/a", { headers }));
    await sync.GET(request("http://localhost/b", { headers }));
    const reads = calls.filter((c) => ["campaign", "outreachMessage", "backgroundJob", "emailAccount"].includes(c.model));
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect(JSON.stringify(read.args)).toContain("org-1");
  });

  it("outreach-sync GET returns counts only, with no message text, recipients or errors", async () => {
    fakePrisma.outreachMessage = model("outreachMessage", { groupBy: [{ state: "SENT", _count: { _all: 16 } }] });
    const { sync } = await loadRoutes();
    const response = await sync.GET(request("http://localhost/b", { headers }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ states: { SENT: 16 }, jobStates: { FAILED: 1 } });
    expect(JSON.stringify(body)).not.toMatch(/@|subject|body|error|secret/i);
    expect(writesMade()).toEqual([]);
    const reads = calls.filter((c) => c.model === "outreachMessage");
    expect(reads.every((c) => c.method === "groupBy")).toBe(true);
  });

  it("an admin session works the same as the bearer token", async () => {
    readSession.mockResolvedValue({ sub: "admin-1", organizationId: "org-1" });
    const { audit } = await loadRoutes();
    expect((await audit.GET(request("http://localhost/a"))).status).toBe(200);
    expect(writesMade()).toEqual([]);
  });
});

describe("outreach-sync POST", () => {
  const headers = { authorization: "Bearer test-secret-with-more-than-thirty-two-characters" };

  it("runs the existing scan only after authorization", async () => {
    const { sync } = await loadRoutes();
    expect((await sync.POST(request("http://localhost/b", { method: "POST" }))).status).toBe(403);
    expect(processOutreachScan).not.toHaveBeenCalled();
    expect((await sync.POST(request("http://localhost/b", { method: "POST", headers }))).status).toBe(200);
    expect(processOutreachScan).toHaveBeenCalledTimes(1);
  });

  it("does not leak scan error details", async () => {
    processOutreachScan.mockRejectedValue(new Error("password=hunter2 at db.internal"));
    const { sync } = await loadRoutes();
    const response = await sync.POST(request("http://localhost/b", { method: "POST", headers }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/hunter2|db\.internal/);
  });

  it("with the send switch off, an authorized POST changes nothing and queues nothing", async () => {
    const { sync } = await loadRoutes("real");
    const response = await sync.POST(request("http://localhost/b", { method: "POST", headers }));
    expect(response.status).toBe(200);
    expect(writesMade()).toEqual([]);
    expect(queueJob).not.toHaveBeenCalled();
    expect(calls.filter((c) => c.model === "outreachMessage")).toEqual([]);
  });

  it("with the send switch on, the scan still limits itself to approval-free campaigns and unsuppressed contacts", async () => {
    process.env.OUTREACH_SEND_ENABLED = "true";
    const { sync } = await loadRoutes("real");
    await sync.POST(request("http://localhost/b", { method: "POST", headers }));
    const scan = calls.find((c) => c.model === "outreachMessage" && c.method === "findMany");
    expect(scan).toBeDefined();
    const where = (scan?.args as { where: { campaign: Record<string, unknown>; contact: Record<string, unknown>; state: { in: string[] } } }).where;
    expect(where.campaign.requireApproval).toBe(false);
    expect(where.campaign.status).toEqual({ notIn: ["PAUSED", "ARCHIVED", "COMPLETED"] });
    expect(where.contact.suppressed).toBe(false);
    expect(where.state.in).toEqual(["DRAFT", "PENDING_APPROVAL"]);
    // Nothing was approved or queued because the fake database returned no messages.
    expect(writesMade()).toEqual([]);
    expect(queueJob).not.toHaveBeenCalled();
  });
});
