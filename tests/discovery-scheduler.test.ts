import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { queueJob } from "@/lib/jobs";
import { processCampaignDiscoveryScheduler, processDiscovery } from "@/worker/processors/discovery";

vi.mock("@/lib/db", () => ({
  prisma: {
    campaign: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/jobs", () => ({
  queueJob: vi.fn(),
  recordActivity: vi.fn(),
}));

describe("campaign discovery scheduling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("schedules only explicitly started or active campaigns", async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);

    await processCampaignDiscoveryScheduler();

    expect(prisma.campaign.findMany).toHaveBeenCalledWith({
      where: { status: { in: ["DISCOVERY", "ACTIVE"] } },
    });
  });

  it("refuses direct discovery for a draft campaign", async () => {
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ status: "DRAFT" } as never);

    await expect(processDiscovery("draft-campaign")).rejects.toThrow("Campaign is not accepting discovery.");
  });

  it("does not queue discovery when the scheduled scan returns no started campaigns", async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);

    await processCampaignDiscoveryScheduler();

    expect(queueJob).not.toHaveBeenCalled();
  });
});
