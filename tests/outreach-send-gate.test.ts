import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { processOutreach } from "@/worker/processors/outreach";
import { processOutreachScan } from "@/worker/processors/outreach-scan";

vi.mock("@/lib/db", () => ({
  prisma: {
    outreachMessage: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    suppression: { findUnique: vi.fn() },
    prospect: { update: vi.fn() },
    subscriber: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/jobs", () => ({
  queueJob: vi.fn(),
  recordActivity: vi.fn(),
}));

describe("outreach send gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("does not let a queued worker message reach the provider when sending is disabled", async () => {
    vi.stubEnv("OUTREACH_SEND_ENABLED", "false");

    await expect(processOutreach("message-1")).rejects.toThrow("Outbound sending is turned off.");

    expect(prisma.outreachMessage.findUnique).not.toHaveBeenCalled();
  });

  it("does not scan or enqueue automatic outreach when sending is disabled", async () => {
    vi.stubEnv("OUTREACH_SEND_ENABLED", "false");

    await processOutreachScan();

    expect(prisma.subscriber.findMany).not.toHaveBeenCalled();
    expect(prisma.outreachMessage.findMany).not.toHaveBeenCalled();
  });

  it("automatically scans only confirmed opt-in contacts when sending is enabled", async () => {
    vi.stubEnv("OUTREACH_SEND_ENABLED", "true");
    vi.mocked(prisma.subscriber.findMany).mockResolvedValue([{ contactId: "contact-1" }] as never);
    vi.mocked(prisma.outreachMessage.findMany).mockResolvedValue([] as never);

    await processOutreachScan();

    expect(prisma.outreachMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        campaign: expect.not.objectContaining({ requireApproval: false }),
        contact: expect.objectContaining({ id: { in: ["contact-1"] }, source: "opt-in", suppressed: false, email: { not: null } }),
      }),
    }));
  });

  it("refuses to send to anyone but the test recipient while the lock is set", async () => {
    vi.stubEnv("OUTREACH_SEND_ENABLED", "true");
    vi.stubEnv("OUTREACH_TEST_RECIPIENT", "owner@example.com");
    vi.mocked(prisma.outreachMessage.findUnique).mockResolvedValue({
      id: "message-9",
      organizationId: "org-1",
      campaignId: "campaign-1",
      prospectId: "prospect-1",
      state: "APPROVED",
      subject: "Hello",
      body: "A short note.",
      contact: { id: "contact-9", email: "someone-else@example.com", suppressed: false, source: "opt-in" },
      prospect: { id: "prospect-1", companyName: "Example", country: "NG", salesIntelligence: null },
      campaign: { id: "campaign-1", status: "ACTIVE", country: "NG", dailyOutreachLimit: 25, emailAccount: { id: "acct-1", status: "ACTIVE", provider: "GMAIL", refreshTokenEncrypted: null } },
    } as never);
    vi.mocked(prisma.outreachMessage.updateMany).mockClear();

    await expect(processOutreach("message-9")).rejects.toThrow("restricted to the test recipient");

    expect(prisma.outreachMessage.updateMany).not.toHaveBeenCalled();
  });

  it("scans only the test recipient while the lock is set", async () => {
    vi.stubEnv("OUTREACH_SEND_ENABLED", "true");
    vi.stubEnv("OUTREACH_TEST_RECIPIENT", "Owner@Example.com");
    vi.mocked(prisma.subscriber.findMany).mockResolvedValue([{ contactId: "contact-1" }] as never);
    vi.mocked(prisma.outreachMessage.findMany).mockClear();
    vi.mocked(prisma.outreachMessage.findMany).mockResolvedValue([] as never);

    await processOutreachScan();

    expect(prisma.outreachMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        contact: expect.objectContaining({ email: { equals: "owner@example.com", mode: "insensitive" } }),
      }),
    }));
  });

  it("scans nothing when the lock value is not a valid address", async () => {
    vi.stubEnv("OUTREACH_SEND_ENABLED", "true");
    vi.stubEnv("OUTREACH_TEST_RECIPIENT", "not-an-email");
    vi.mocked(prisma.subscriber.findMany).mockResolvedValue([{ contactId: "contact-1" }] as never);
    vi.mocked(prisma.outreachMessage.findMany).mockClear();

    await processOutreachScan();

    expect(prisma.outreachMessage.findMany).not.toHaveBeenCalled();
  });

  it("cancels an approved message at send time when the contact has no confirmed subscription", async () => {
    vi.stubEnv("OUTREACH_SEND_ENABLED", "true");
    vi.mocked(prisma.outreachMessage.findUnique).mockResolvedValue({
      id: "message-1",
      organizationId: "org-1",
      campaignId: "campaign-1",
      prospectId: "prospect-1",
      state: "APPROVED",
      subject: "Hello",
      body: "A short note.",
      contact: { id: "contact-1", email: "person@example.com", suppressed: false, source: "opt-in" },
      prospect: { id: "prospect-1", companyName: "Example", country: "NG", salesIntelligence: null },
      campaign: { id: "campaign-1", status: "ACTIVE", country: "NG", dailyOutreachLimit: 25, emailAccount: { id: "acct-1", status: "ACTIVE", provider: "GMAIL", refreshTokenEncrypted: null } },
    } as never);
    vi.mocked(prisma.suppression.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.subscriber.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.outreachMessage.updateMany).mockResolvedValue({ count: 1 } as never);

    await expect(processOutreach("message-1")).rejects.toThrow("no confirmed subscription");

    expect(prisma.subscriber.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1", contactId: "contact-1", status: "CONFIRMED" },
    }));
    expect(prisma.outreachMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ state: "CANCELLED" }),
    }));
    expect(prisma.outreachMessage.count).not.toHaveBeenCalled();
  });
});
