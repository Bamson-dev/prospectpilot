import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  application: null as Record<string, unknown> | null,
  vacancy: null as Record<string, unknown> | null,
  run: null as Record<string, unknown> | null,
  applicationUpdates: [] as Array<Record<string, unknown>>,
  vacancyUpdates: [] as Array<Record<string, unknown>>,
  runUpdates: [] as Array<Record<string, unknown>>,
  activities: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    jobApplication: {
      findUnique: vi.fn(async () => state.application),
      findMany: vi.fn(async () => (state.application ? [{ id: "app-1" }] : [])),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => { state.applicationUpdates.push(args.data); return {}; }),
    },
    jobVacancy: {
      findFirst: vi.fn(async () => state.vacancy),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => { state.vacancyUpdates.push(args.data); return {}; }),
    },
    jobDiscoveryRun: {
      findUnique: vi.fn(async () => state.run),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => { state.runUpdates.push(args.data); return {}; }),
    },
    applicationEvent: { create: vi.fn(async () => ({})) },
    backgroundJob: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 0 })) },
  },
}));
vi.mock("@/lib/queues", () => ({ getQueue: vi.fn(() => ({ getJob: vi.fn(async () => null) })), enqueue: vi.fn(async () => undefined), getRedis: vi.fn() }));

const spies = vi.hoisted(() => ({
  queueJob: vi.fn(async (_input: Record<string, unknown>) => ({ id: "job" })),
  sendEmailApplication: vi.fn(async (_id: string) => ({ outcome: "SENT" })),
  attachBrowserInspection: vi.fn(async (_id: string, _options?: unknown) => undefined),
  prepareApplication: vi.fn(async () => "app-1"),
  collect: vi.fn(async (_input: { query: string; location?: string; limit: number }) => ({ jobs: [] as Array<Record<string, unknown>>, failures: [] })),
  persist: vi.fn(async (_org: string, jobs: Array<{ title: string }>) => ({ ids: jobs.map((_, index) => `id-${index}`), duplicateReasons: [] as string[], outOfScopeTitles: [] as string[] })),
}));

vi.mock("@/lib/jobs", () => ({
  queueJob: spies.queueJob,
  recordActivity: vi.fn(async (input: Record<string, unknown>) => { state.activities.push(input); }),
}));
vi.mock("@/lib/applications/email-apply", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/applications/email-apply")>()), sendEmailApplication: spies.sendEmailApplication }));
vi.mock("@/lib/applications/public-inspection", () => ({ attachBrowserInspection: spies.attachBrowserInspection }));
vi.mock("@/lib/applications/job-sources", () => ({ collectPublicVacancies: spies.collect }));
vi.mock("@/lib/discovery/health", () => ({ isApplicationAccessible: vi.fn(async () => true) }));
vi.mock("@/lib/applications/service", () => ({
  prepareApplication: spies.prepareApplication,
  persistNormalizedVacancies: spies.persist,
  archiveStaleVacancies: vi.fn(async () => undefined),
}));

import { classifyMarketingRole } from "@/lib/applications/marketing-scope";
import { processApplicationPreparation, processApplicationSubmit, processJobDiscovery } from "@/worker/processors/job-applications";

const marketingText = "Own paid media campaigns, SEO and lifecycle email marketing. Report on CAC and funnel conversion across acquisition channels.";
const engineeringText = "Write clean code in the backend and frontend, own the codebase, run code reviews and deploy with CI/CD on Kubernetes.";

function vacancy(title: string, description: string) {
  return { id: "vac-1", title, description, rawData: null };
}

beforeEach(() => {
  state.application = null;
  state.vacancy = null;
  state.run = null;
  state.applicationUpdates.length = 0;
  state.vacancyUpdates.length = 0;
  state.runUpdates.length = 0;
  state.activities.length = 0;
  for (const spy of Object.values(spies)) spy.mockClear();
  // Persistence returns ids for in-scope vacancies only, as the real function does.
  spies.persist.mockImplementation(async (_org: string, jobs: Array<{ title: string; description?: string }>) => ({
    ids: jobs.flatMap((job, index) => (classifyMarketingRole({ title: job.title, description: (job as { description?: string }).description ?? "" }).inScope ? [`id-${index}`] : [])),
    duplicateReasons: [],
    outOfScopeTitles: [],
  }));
  process.env.APPLICATION_AUTOMATION_ENABLED = "true";
  process.env.APPLICATION_LIVE_SUBMIT = "true";
  process.env.APPLICATION_MODE = "AUTO_SUBMIT";
  process.env.JOB_APPLICATION_EMAIL_ENABLED = "true";
  delete process.env.JOB_DISCOVERY_ENABLED;
});

describe("submission gate", () => {
  it("does not send or fill a form for a role outside marketing, even with live submission on", async () => {
    state.application = { id: "app-1", organizationId: "org-1", status: "READY_TO_SUBMIT", emailSentAt: null, submittedAt: null, vacancy: { title: "Software Engineer", description: engineeringText } };
    await processApplicationSubmit("org-1", "app-1");
    expect(spies.sendEmailApplication).not.toHaveBeenCalled();
    expect(spies.attachBrowserInspection).not.toHaveBeenCalled();
    expect(state.applicationUpdates[0]).toMatchObject({ status: "WITHDRAWN" });
  });

  it("lets a marketing role continue to the email send", async () => {
    state.application = { id: "app-1", organizationId: "org-1", status: "READY_TO_SUBMIT", emailSentAt: null, submittedAt: null, vacancy: { title: "Growth Marketing Manager", description: marketingText } };
    await processApplicationSubmit("org-1", "app-1");
    expect(spies.sendEmailApplication).toHaveBeenCalledWith("app-1");
  });
});

describe("preparation gate", () => {
  it("creates no package for a role outside marketing and rejects the vacancy", async () => {
    state.vacancy = vacancy("Product Manager", "Own the roadmap and write requirements with the engineering team.");
    state.application = { id: "app-1", organizationId: "org-1", status: "REQUIRES_REVIEW", emailSentAt: null, submittedAt: null };
    await processApplicationPreparation("org-1", "vac-1");
    expect(spies.prepareApplication).not.toHaveBeenCalled();
    expect(state.vacancyUpdates[0]).toMatchObject({ status: "REJECTED" });
    expect(spies.queueJob).not.toHaveBeenCalled();
  });
});

describe("discovery queries", () => {
  function run(targetRoles: string[]) {
    return { id: "run-1", candidate: { targetRoles, profiles: [{ title: "Software Engineer" }, { title: "Product Manager" }], preference: { locations: ["Lagos"], remoteOnly: false, dailyTarget: 40 } } };
  }

  it("searches only marketing titles and ignores software, product and founder profiles", async () => {
    state.run = run(["Growth Marketing Manager", "Software Engineer", "Product Manager", "Marketing Director"]);
    await processJobDiscovery("org-1", "run-1");
    const queries = spies.collect.mock.calls.map((call) => call[0].query);
    expect(queries.sort()).toEqual(["growth marketing manager", "marketing director"]);
    expect(spies.collect.mock.calls.every((call) => call[0].location === "Lagos")).toBe(true);
  });

  it("falls back to the approved marketing list, never to the saved software profile", async () => {
    state.run = run([]);
    await processJobDiscovery("org-1", "run-1");
    const queries = spies.collect.mock.calls.map((call) => call[0].query);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some((query) => /software|engineer|developer|product manager|founder/i.test(query))).toBe(false);
    expect(queries.every((query) => /marketing|growth|go-to-market|gtm|seo|demand|paid media|chief|cmo/i.test(query))).toBe(true);
  });

  it("refuses a manual search for a non-marketing title", async () => {
    state.run = run(["Growth Marketing Manager"]);
    await processJobDiscovery("org-1", "run-1", "software engineer");
    expect(spies.collect).not.toHaveBeenCalled();
    expect(state.runUpdates.some((update) => update.status === "COMPLETED")).toBe(true);
  });

  it("filters mixed provider results before they are queued and reports the counts", async () => {
    state.run = run(["Growth Marketing Manager"]);
    spies.collect.mockResolvedValueOnce({
      jobs: [
        { source: "greenhouse", sourceUrl: "https://boards.greenhouse.io/a/jobs/1", applicationUrl: "https://boards.greenhouse.io/a/jobs/1", externalId: "1", companyName: "A", title: "Growth Marketing Manager", location: "Lagos", description: marketingText },
        { source: "greenhouse", sourceUrl: "https://boards.greenhouse.io/a/jobs/2", applicationUrl: "https://boards.greenhouse.io/a/jobs/2", externalId: "2", companyName: "A", title: "Growth Marketing Engineer", location: "Lagos", description: engineeringText },
        { source: "greenhouse", sourceUrl: "https://boards.greenhouse.io/a/jobs/3", applicationUrl: "https://boards.greenhouse.io/a/jobs/3", externalId: "3", companyName: "A", title: "Growth Marketing Manager", location: "Lagos", description: engineeringText },
      ],
      failures: [],
    });
    await processJobDiscovery("org-1", "run-1");
    const persisted = spies.persist.mock.calls[0][1].map((job) => job.title);
    // Out-of-scope jobs are passed to persistence only to be stored as REJECTED. Only the accepted one is queued.
    expect(persisted[0]).toBe("Growth Marketing Manager");
    expect(spies.queueJob).toHaveBeenCalledTimes(1);
    expect(spies.queueJob.mock.calls[0][0]).toMatchObject({ queue: "job-analysis" });
    const detail = JSON.parse(String(state.activities.at(-1)?.detail)) as { retrieved: number; acceptedMarketing: number; rejectedNotMarketing: number };
    expect(detail).toMatchObject({ retrieved: 3, acceptedMarketing: 1, rejectedNotMarketing: 2 });
  });
});
