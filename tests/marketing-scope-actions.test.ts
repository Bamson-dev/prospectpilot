import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  vacancies: {} as Record<string, Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
  queued: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${decodeURIComponent(url.replace(/\+/g, " "))}`); } }));
vi.mock("@/lib/current-user", () => ({ requireOrganization: vi.fn(async () => ({ organization: { id: "org-1" } })) }));
vi.mock("@/lib/db", () => ({
  prisma: {
    jobVacancy: {
      findFirst: vi.fn(async (args: { where: { id: string } }) => db.vacancies[args.where.id] ?? null),
      findMany: vi.fn(async (args: { where: { id?: { in: string[] } } }) => (args.where.id?.in ?? []).map((id) => db.vacancies[id]).filter(Boolean)),
    },
    jobApplication: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => { db.created.push(args.data); return {}; }),
    },
    backgroundJob: { findMany: vi.fn(async () => []) },
    jobDiscoveryRun: { create: vi.fn(async (args: { data: Record<string, unknown> }) => { db.runs.push(args.data); return { id: "run-1" }; }) },
  },
}));
vi.mock("@/lib/jobs", () => ({ queueJob: vi.fn(async (input: Record<string, unknown>) => { db.queued.push(input); return { id: "job" }; }), recordActivity: vi.fn(async () => undefined) }));
vi.mock("@/lib/queues", () => ({ getQueue: vi.fn(), enqueue: vi.fn(), getRedis: vi.fn() }));
vi.mock("@/lib/applications/service", () => ({ ensureCandidate: vi.fn(async () => ({ id: "cand-1" })) }));

import { addReviewToQueue, enqueueApplicationBatch, enqueueApplicationPreparation, enqueueJobSearch } from "@/actions/job-applications";

const marketingText = "Own paid media campaigns, SEO and lifecycle email marketing. Report on CAC and funnel conversion across acquisition channels.";
const engineeringText = "Write clean code in the backend and frontend, own the codebase, run code reviews and deploy with CI/CD on Kubernetes.";

function vacancy(id: string, title: string, description: string) {
  return {
    id, title, description, companyName: "Acme", source: "greenhouse", status: "ANALYZED",
    applicationUrl: `https://boards.greenhouse.io/acme/jobs/${id}`,
    fit: { profile: "MARKETING", analysis: { explanation: { state: "REVIEW", opportunity: { decision: "REVIEW" } } } },
    applications: [],
  };
}

function form(values: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  return data;
}

async function redirected(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
}

beforeEach(() => {
  db.vacancies = {
    se: vacancy("se", "Software Engineer", engineeringText),
    pm: vacancy("pm", "Product Manager", "Own the roadmap and write requirements."),
    gm: vacancy("gm", "Growth Marketing Manager", marketingText),
  };
  db.created.length = 0;
  db.queued.length = 0;
  db.runs.length = 0;
  process.env.JOB_DISCOVERY_ENABLED = "true";
});

describe("manual entry points", () => {
  it("refuses a search for a non-marketing title and creates no run", async () => {
    const message = await redirected(() => enqueueJobSearch(form({ query: "software engineer" })));
    expect(message).toMatch(/marketing roles only/i);
    expect(db.runs).toHaveLength(0);
    expect(db.queued).toHaveLength(0);
  });

  it("accepts a search for a marketing title", async () => {
    await redirected(() => enqueueJobSearch(form({ query: "Growth Marketing Manager" })));
    expect(db.runs).toHaveLength(1);
    expect(db.queued[0]).toMatchObject({ queue: "job-discovery" });
  });

  it("will not prepare an application for a non-marketing vacancy", async () => {
    for (const id of ["se", "pm"]) {
      const message = await redirected(() => enqueueApplicationPreparation(form({ vacancyId: id })));
      expect(message).toMatch(/not a marketing role/i);
    }
    expect(db.queued).toHaveLength(0);
  });

  it("prepares a marketing vacancy", async () => {
    await redirected(() => enqueueApplicationPreparation(form({ vacancyId: "gm" })));
    expect(db.queued[0]).toMatchObject({ queue: "application-preparation" });
  });

  it("will not add a non-marketing vacancy to the review queue", async () => {
    const message = await redirected(() => addReviewToQueue(form({ vacancyId: "se" })));
    expect(message).toMatch(/not a marketing role/i);
    expect(db.created).toHaveLength(0);
  });

  it("queues only the marketing vacancies from a mixed batch", async () => {
    // A manually queued review vacancy is admitted by the queue rules, so the scope check is what separates them.
    for (const id of Object.keys(db.vacancies)) (db.vacancies[id] as { applications: unknown[] }).applications = [{ id: `app-${id}`, blockedReason: "Queued for manual review.", package: null }];
    await redirected(() => enqueueApplicationBatch(form({ vacancyId: ["se", "pm", "gm"] })));
    expect(db.queued.map((job) => (job.payload as { vacancyId: string }).vacancyId)).toEqual(["gm"]);
  });
});
