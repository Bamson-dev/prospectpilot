import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { processOutreach } from "@/worker/processors/outreach";
import { processOutreachScan } from "@/worker/processors/outreach-scan";

vi.mock("@/lib/db", () => ({
  prisma: {
    outreachMessage: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
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

    expect(prisma.outreachMessage.findMany).not.toHaveBeenCalled();
  });

  it("automatically scans only confirmed opt-in contacts when sending is enabled", async () => {
    vi.stubEnv("OUTREACH_SEND_ENABLED", "true");
    vi.mocked(prisma.outreachMessage.findMany).mockResolvedValue([] as never);

    await processOutreachScan();

    expect(prisma.outreachMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        campaign: expect.not.objectContaining({ requireApproval: false }),
        contact: expect.objectContaining({ source: "opt-in", suppressed: false, email: { not: null } }),
      }),
    }));
  });
});
