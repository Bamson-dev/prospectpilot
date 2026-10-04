import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { authorizeAdmin, POST } from "@/app/api/diagnostics/discovery/route";
import { GET } from "@/app/api/diagnostics/discovery/[id]/route";

vi.mock("@/lib/current-user", () => ({
  readSession: vi.fn(),
}));

vi.mock("@/lib/jobs", () => ({
  queueJob: vi.fn(),
}));

describe("Diagnostics API", () => {
  let adminUser: { id: string; name: string | null; email: string };
  let organization: { id: string; name: string };

  beforeEach(async () => {
    organization = await prisma.organization.create({
      data: { name: "Test Org", slug: `test-org-${Date.now()}` },
    });
    
    adminUser = await prisma.user.create({
      data: { 
        name: "Admin", 
        email: `admin-${Date.now()}@example.com`,
        passwordHash: "test-hash",
      },
    });

    await prisma.membership.create({
      data: {
        userId: adminUser.id,
        organizationId: organization.id,
        role: "ADMIN",
      },
    });
  });

  it("authorizes with ADMIN_API_KEY (AUTH_SECRET)", async () => {
    process.env.AUTH_SECRET = "test-secret";
    
    const req = new Request("http://localhost/api/diagnostics/discovery", {
      headers: { "authorization": "Bearer test-secret" }
    });

    const auth = await authorizeAdmin(req);
    expect(auth).not.toBeNull();
    expect(auth?.user).toBeDefined();
  });

  it("rejects invalid JSON body", async () => {
    process.env.AUTH_SECRET = "test-secret";
    
    const req = new Request("http://localhost/api/diagnostics/discovery", {
      method: "POST",
      headers: { "authorization": "Bearer test-secret" },
      body: "invalid json"
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid JSON body");
  });

  it("triggers diagnostic job and returns runId", async () => {
    process.env.AUTH_SECRET = "test-secret";
    
    const req = new Request("http://localhost/api/diagnostics/discovery", {
      method: "POST",
      headers: { 
        "authorization": "Bearer test-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({ query: "software engineer", limit: 1 })
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.runId).toBeDefined();

    const run = await prisma.jobDiscoveryRun.findUnique({
      where: { id: data.runId }
    });
    expect(run).not.toBeNull();
    expect(run?.status).toBe("STARTED");
  });

  it("fetches diagnostic job results", async () => {
    process.env.AUTH_SECRET = "test-secret";
    
    const candidate = await prisma.candidate.create({
      data: {
        organizationId: organization.id,
        fullName: "Test",
        firstName: "Test",
        lastName: "Candidate",
        email: `test-${Date.now()}@example.com`,
      }
    });

    const run = await prisma.jobDiscoveryRun.create({
      data: {
        organizationId: organization.id,
        candidateId: candidate.id,
        status: "COMPLETED",
        queries: 1,
        validVacancies: 5
      }
    });

    const req = new Request(`http://localhost/api/diagnostics/discovery/${run.id}`, {
      method: "GET",
      headers: { "authorization": "Bearer test-secret" }
    });

    const res = await GET(req, { params: Promise.resolve({ id: run.id }) });
    expect(res.status).toBe(200);
    
    const data = await res.json();
    expect(data.id).toBe(run.id);
    expect(data.status).toBe("COMPLETED");
    expect(data.validVacancies).toBe(5);
  });
});
