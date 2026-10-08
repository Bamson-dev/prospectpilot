import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getQueue } from "@/lib/queues";
import { authorizeAdmin } from "@/app/api/diagnostics/discovery/route";
import { GET as getProspects } from "@/app/api/diagnostics/get-prospects/route";
import { GET as getProdAudit } from "@/app/api/diagnostics/prod-audit/route";

vi.mock("@/lib/db", () => ({
  prisma: {
    prospect: { findMany: vi.fn() },
    campaign: { findMany: vi.fn() },
    outreachMessage: { findMany: vi.fn() },
    backgroundJob: { findMany: vi.fn() },
    emailAccount: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/queues", () => ({ getQueue: vi.fn() }));

vi.mock("@/app/api/diagnostics/discovery/route", () => ({
  authorizeAdmin: vi.fn(),
}));

const request = () => new Request("http://localhost/api/diagnostics/test");

function authorizedFor(organizationId: string) {
  return {
    user: { id: "admin" },
    organization: { id: organizationId },
  } as unknown as NonNullable<Awaited<ReturnType<typeof authorizeAdmin>>>;
}

describe("sensitive diagnostic data access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getQueue).mockReturnValue({
      getActive: vi.fn().mockResolvedValue([]),
      getWaiting: vi.fn().mockResolvedValue([]),
      getFailed: vi.fn().mockResolvedValue([]),
      getDelayed: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof getQueue>);
    vi.mocked(prisma.prospect.findMany).mockResolvedValue([]);
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
    vi.mocked(prisma.outreachMessage.findMany).mockResolvedValue([]);
    vi.mocked(prisma.backgroundJob.findMany).mockResolvedValue([]);
    vi.mocked(prisma.emailAccount.findFirst).mockResolvedValue(null);
  });

  it.each([
    ["prospect diagnostics", getProspects],
    ["production audit", getProdAudit],
  ])("rejects unauthenticated access to %s before reading data", async (_name, handler) => {
    vi.mocked(authorizeAdmin).mockResolvedValue(null);

    const response = await handler(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(prisma.prospect.findMany).not.toHaveBeenCalled();
    expect(prisma.campaign.findMany).not.toHaveBeenCalled();
    expect(prisma.emailAccount.findFirst).not.toHaveBeenCalled();
  });

  it("rejects an authenticated but unauthorized user before reading data", async () => {
    vi.mocked(authorizeAdmin).mockResolvedValue(null);

    const response = await getProspects(request());

    expect(response.status).toBe(403);
    expect(prisma.prospect.findMany).not.toHaveBeenCalled();
  });

  it("allows an authorized admin and scopes prospect data to their organization", async () => {
    vi.mocked(authorizeAdmin).mockResolvedValue(authorizedFor("org-authorized"));

    const response = await getProspects(request());

    expect(response.status).toBe(200);
    expect(prisma.prospect.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-authorized" }),
    }));
  });

  it("allows an authorized admin and scopes audit data while excluding OAuth tokens", async () => {
    vi.mocked(authorizeAdmin).mockResolvedValue(authorizedFor("org-authorized"));

    const response = await getProdAudit(request());

    expect(response.status).toBe(200);
    expect(prisma.campaign.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-authorized" },
    }));
    expect(prisma.outreachMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-authorized" }),
    }));
    expect(prisma.backgroundJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-authorized", queue: "outreach" },
    }));
    expect(prisma.emailAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-authorized", provider: "GMAIL" },
      select: expect.not.objectContaining({ refreshTokenEncrypted: true }),
    }));
  });
});
