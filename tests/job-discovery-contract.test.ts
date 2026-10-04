import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { enqueueJobSearch } from "@/actions/job-applications";
import { processJobDiscovery } from "@/worker/processors/job-applications";
import { requireOrganization } from "@/lib/current-user";
import { ensureCandidate } from "@/lib/applications/service";

// Mock the current user to return a test organization
vi.mock("@/lib/current-user", () => ({
  requireOrganization: vi.fn(),
}));

// Mock the config
vi.mock("@/lib/applications/config", () => ({
  jobDiscoveryEnabled: () => true,
  applicationAutomationEnabled: () => true,
  applicationMode: () => "AUTO_SUBMIT",
}));

// Mock redirect to throw an error so we can catch it
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT: ${url}`); },
}));

describe("job discovery contract", () => {
  it("creates a JobDiscoveryRun and includes runId in the queue payload", async () => {
    // 1. Setup a test organization and candidate
    const organization = await prisma.organization.create({
      data: { name: "Test Org", slug: `test-org-${Date.now()}` },
    });
    const candidate = await ensureCandidate(organization.id);
    expect(candidate).not.toBeNull();

    (requireOrganization as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "test" }, organization });

    // 2. Trigger the manual discovery via the producer
    const formData = new FormData();
    formData.append("query", "software engineer typescript");
    formData.append("limit", "1");

    let redirectedTo = "";
    try {
      await enqueueJobSearch(formData);
    } catch (error: unknown) {
      if (error instanceof Error) {
        redirectedTo = error.message;
      }
    }

    expect(redirectedTo).toContain("/jobs/discover?notice=Job+search+queued");

    // 3. Verify JobDiscoveryRun was created
    const run = await prisma.jobDiscoveryRun.findFirst({
      where: { organizationId: organization.id },
    });
    expect(run).not.toBeNull();
    expect(run?.status).toBe("STARTED");

    // 4. Verify BullMQ (BackgroundJob table) contains the correct payload
    const job = await prisma.backgroundJob.findFirst({
      where: { organizationId: organization.id, queue: "job-discovery", name: "search" },
      orderBy: { createdAt: "desc" },
    });
    
    expect(job).not.toBeNull();
    
    const payload = job?.payload as Record<string, unknown>;
    expect(payload.runId).toBe(run?.id);
    expect(payload.query).toBe("software engineer typescript");
    expect(payload.limit).toBe("1");

    // 5. Test the consumer contract (hand-off)
    // We don't want to actually run SearXNG, so we just verify it doesn't throw 'id: undefined'
    
    // We mock collectPublicVacancies to return nothing to avoid external calls
    vi.mock("@/lib/applications/job-sources", async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...(actual as Record<string, unknown>),
        collectPublicVacancies: vi.fn().mockResolvedValue({ jobs: [], failures: [] }),
      };
    });

    // Call processJobDiscovery with the correct runId and manualQuery
    await processJobDiscovery(organization.id, payload.runId as string, payload.query as string, parseInt(payload.limit as string, 10));

    // Verify it updated the run
    const updatedRun = await prisma.jobDiscoveryRun.findUnique({ where: { id: run!.id } });
    expect(updatedRun?.status).toBe("COMPLETED");
  });
});
