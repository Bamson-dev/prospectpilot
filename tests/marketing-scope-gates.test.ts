import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  vacancies: [] as Array<Record<string, unknown>>,
  applications: [] as Array<Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
  vacancyUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  applicationUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  queued: [] as Array<Record<string, unknown>>,
  cancelled: [] as string[],
  jobs: [] as Array<{ id: string; queue: string }>,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    jobVacancy: {
      findMany: vi.fn(async (args?: { cursor?: { id: string } }) => (args?.cursor ? [] : db.vacancies)),
      findFirst: vi.fn(async (args: { where: { id?: string } }) => db.vacancies.find((row) => row.id === args.where.id) ?? null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => { const row = { id: `v${db.created.length + 1}`, ...args.data }; db.created.push(row); return row; }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => { db.vacancyUpdates.push({ id: args.where.id, data: args.data }); return {}; }),
    },
    jobApplication: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => db.applications.find((row) => row.id === args.where.id) ?? null),
      findMany: vi.fn(async () => db.applications),
      findFirst: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => { db.applicationUpdates.push({ id: args.where.id, data: args.data }); return {}; }),
      count: vi.fn(async () => 0),
    },
    applicationEvent: { create: vi.fn(async () => ({})) },
    generatedDocument: { findUnique: vi.fn(async () => ({ id: "doc", fileName: "file.pdf", fileType: "application/pdf", content: new Uint8Array([1, 2, 3]), text: "Dear team, I would like to apply." })) },
    emailAccount: { findFirst: vi.fn(async () => null) },
    backgroundJob: {
      findMany: vi.fn(async () => db.jobs),
      updateMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => { db.cancelled.push(...args.where.id.in); return { count: args.where.id.in.length }; }),
    },
  },
}));
vi.mock("@/lib/queues", () => ({ getQueue: vi.fn(() => ({ getJob: vi.fn(async () => null) })), enqueue: vi.fn(async () => undefined), getRedis: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ queueJob: vi.fn(async (input: Record<string, unknown>) => { db.queued.push(input); return { id: "job" }; }), recordActivity: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/client", () => ({ completeJson: vi.fn(async () => null) }));

import { prepareDiscoveredVacancies, assessVacancy } from "@/lib/applications/job-pipeline";
import { queueAdmission, storedFitDecision } from "@/lib/applications/application-queue";
import { seedCandidateRecord } from "@/lib/applications/seed-data";
import { sendEmailApplication } from "@/lib/applications/email-apply";
import { persistNormalizedVacancies } from "@/lib/applications/service";
import { auditMarketingScope } from "@/lib/applications/scope-enforce";
import { normalizeVacancy } from "@/lib/applications/job-normalize";

const marketingText = "Own paid media campaigns, SEO and lifecycle email marketing. Report on CAC and funnel conversion across acquisition channels and manage the marketing budget.";
const engineeringText = "Write clean code in the backend and frontend, own the codebase, run code reviews, deploy with CI/CD on Kubernetes, and join the on-call rotation.";
const salesText = "Carry a quota. Close deals with enterprise accounts, run outbound sales and cold calling, negotiate contracts and handle renewals and upsell.";

function raw(title: string, description: string, id: string) {
  return {
    source: "greenhouse",
    sourceUrl: `https://boards.greenhouse.io/acme/jobs/${id}`,
    applicationUrl: `https://boards.greenhouse.io/acme/jobs/${id}`,
    externalId: id,
    companyName: `Acme ${id}`,
    title,
    location: "Remote",
    description,
  };
}

beforeEach(() => {
  db.vacancies = [];
  db.applications = [];
  db.created.length = 0;
  db.vacancyUpdates.length = 0;
  db.applicationUpdates.length = 0;
  db.queued.length = 0;
  db.cancelled.length = 0;
  db.jobs = [];
  process.env.JOB_APPLICATION_EMAIL_ENABLED = "true";
});

describe("discovery keeps marketing roles only", () => {
  it("drops unrelated roles before qualification and lists the reasons", () => {
    const prepared = prepareDiscoveredVacancies([
      raw("Growth Marketing Manager", marketingText, "1"),
      raw("Software Engineering Manager", engineeringText, "2"),
      raw("Product Manager", "Own the roadmap and write requirements with engineering. Work with growth and marketing on launches.", "3"),
      raw("Sales Manager", salesText, "4"),
      raw("Marketing Manager", engineeringText, "5"),
      raw("Customer Success Manager", "Own renewals and onboarding for enterprise customers and support marketing campaigns.", "6"),
      raw("Product Marketing Manager", "Own positioning and messaging, launch plans, competitive intelligence and go-to-market campaigns.", "7"),
    ], "manager");
    expect(prepared.kept.map((job) => job.title)).toEqual(["Growth Marketing Manager", "Product Marketing Manager"]);
    expect(prepared.outOfScope.map((item) => item.job.title)).toEqual(["Software Engineering Manager", "Product Manager", "Sales Manager", "Marketing Manager", "Customer Success Manager"]);
    for (const item of prepared.outOfScope) expect(item.verdict.reason.length).toBeGreaterThan(10);
    for (const job of prepared.kept) expect(job.marketing?.inScope).toBe(true);
  });
});

describe("saving vacancies", () => {
  it("stores a non-marketing role as REJECTED with its reason and never returns it for qualification", async () => {
    const jobs = [raw("Growth Marketing Manager", marketingText, "1"), raw("Software Engineering Manager", engineeringText, "2"), raw("Sales Manager", salesText, "3")]
      .map((item) => normalizeVacancy(item)!);
    const saved = await persistNormalizedVacancies("org-1", jobs);
    expect(saved.ids).toHaveLength(1);
    expect(saved.outOfScopeTitles).toEqual(["Software Engineering Manager", "Sales Manager"]);
    const byTitle = Object.fromEntries(db.created.map((row) => [row.title as string, row]));
    expect(byTitle["Growth Marketing Manager"].status).toBe("DISCOVERED");
    expect(byTitle["Software Engineering Manager"].status).toBe("REJECTED");
    expect(byTitle["Sales Manager"].status).toBe("REJECTED");
    const stored = (byTitle["Software Engineering Manager"].rawData as { marketing: { inScope: boolean; reason: string } }).marketing;
    expect(stored.inScope).toBe(false);
    expect(stored.reason.length).toBeGreaterThan(10);
  });

  it("does not reactivate an archived out-of-scope vacancy when it is found again", async () => {
    const job = normalizeVacancy(raw("Software Engineering Manager", engineeringText, "2"))!;
    db.vacancies = [{ id: "old", companyName: job.companyName, title: job.title, applicationUrl: job.applicationUrl, sourceUrl: job.sourceUrl, location: job.location, externalId: job.externalId, status: "ARCHIVED" }];
    await persistNormalizedVacancies("org-1", [job]);
    expect(db.vacancyUpdates.every((update) => update.data.status !== "DISCOVERED")).toBe(true);
  });
});

describe("qualification", () => {
  const person = { ...seedCandidateRecord(), email: "ada.lovelace@gmail.com" };

  it("marks an unrelated role NOT_A_FIT even when the fit scorer would apply", () => {
    const assessed = assessVacancy({ title: "Senior Software Developer", companyName: "Acme", description: "Requirements\nExperience with TypeScript and PostgreSQL.\nYou will build APIs.", applicationUrl: "https://jobs.example/1" }, person);
    expect(assessed.state).toBe("NOT_A_FIT");
    expect(assessed.marketing.inScope).toBe(false);
    expect(assessed.opportunity.queue).toBe("hold");
    expect(queueAdmission({ decision: storedFitDecision({ explanation: assessed.explanation }), manuallyQueued: true })).toBe("excluded");
  });

  it("explains an accepted marketing role", () => {
    const assessed = assessVacancy({ title: "Growth Marketing Manager", companyName: "Acme", description: marketingText, applicationUrl: "https://jobs.example/2" }, person);
    expect(assessed.marketing.inScope).toBe(true);
    expect(assessed.explanation.marketing?.role).toBeTruthy();
  });
});

describe("final send gate", () => {
  function application(title: string, description: string) {
    return {
      id: "app-1",
      organizationId: "org-1",
      status: "READY_TO_SUBMIT",
      emailSentAt: null,
      submittedAt: null,
      emailAttemptAt: null,
      cvId: "cv",
      coverLetterId: "letter",
      vacancy: { title, companyName: "Northwind", companyDomain: "northwind.io", normalizedCompany: "northwind", applicationUrl: "https://northwind.io/jobs/1", sourceUrl: "https://northwind.io/jobs/1", description: `${description} To apply, email your CV and cover letter to careers@northwind.io.` },
      candidate: { fullName: "Ada Lovelace", email: "ada.lovelace@gmail.com", phone: null, targetRoles: ["software engineer", "growth marketing manager"] },
      package: { strategy: "PREPARE", warnings: [] },
    };
  }
  function mailer() {
    return { sendEmail: vi.fn(async (_message: { to: string }) => ({ providerMessageId: "m1" })), confirmSent: vi.fn(async () => true), findSent: vi.fn(async () => null) };
  }

  it("never sends an application for a role outside marketing, even with a PREPARE fit and a matching saved title", async () => {
    db.applications = [application("Software Engineer", engineeringText)];
    const m = mailer();
    const result = await sendEmailApplication("app-1", { mailer: m, from: "ada.lovelace@gmail.com" });
    expect(result.outcome).toBe("BLOCKED");
    expect(m.sendEmail).not.toHaveBeenCalled();
    expect(db.applicationUpdates[0]?.data.status).toBe("WITHDRAWN");
    expect(String(db.applicationUpdates[0]?.data.blockedReason)).toMatch(/not a marketing role/i);
  });

  it("never sends a Marketing Manager title whose description is sales work", async () => {
    db.applications = [application("Marketing Manager", salesText)];
    const m = mailer();
    expect((await sendEmailApplication("app-1", { mailer: m, from: "x@y.co" })).outcome).toBe("BLOCKED");
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("still sends a marketing role that passes every other check", async () => {
    db.applications = [application("Growth Marketing Manager", marketingText)];
    const m = mailer();
    const result = await sendEmailApplication("app-1", { mailer: m, from: "ada.lovelace@gmail.com" });
    expect(result.outcome).toBe("SENT");
    expect(m.sendEmail.mock.calls[0][0]).toMatchObject({ to: "careers@northwind.io" });
  });

  it("leaves an application that was already sent untouched", async () => {
    db.applications = [{ ...application("Software Engineer", engineeringText), emailSentAt: new Date() }];
    const m = mailer();
    expect((await sendEmailApplication("app-1", { mailer: m, from: "x@y.co" })).outcome).toBe("ALREADY_SENT");
    expect(db.applicationUpdates).toHaveLength(0);
  });
});

describe("existing records audit", () => {
  function vacancy(id: string, title: string, description: string, applications: Array<Record<string, unknown>> = []) {
    return { id, title, companyName: `Co ${id}`, description, status: "ANALYZED", rawData: { keep: "me" }, applications };
  }

  it("previews without writing", async () => {
    db.vacancies = [vacancy("a", "Growth Marketing Manager", marketingText), vacancy("b", "Software Engineer", engineeringText, [{ id: "app-b", status: "REQUIRES_REVIEW", emailSentAt: null, submittedAt: null }])];
    const result = await auditMarketingScope("org-1", { apply: false });
    expect(result).toMatchObject({ vacancies: 2, inScope: 1, outOfScope: 1, applicationsExcluded: 1, vacanciesExcluded: 0 });
    expect(db.vacancyUpdates).toHaveLength(0);
    expect(db.applicationUpdates).toHaveLength(0);
  });

  it("excludes unrelated vacancies, withdraws unsent applications, cancels queued work and keeps sent history", async () => {
    db.vacancies = [
      vacancy("a", "Growth Marketing Manager", marketingText, [{ id: "app-a", status: "REQUIRES_REVIEW", emailSentAt: null, submittedAt: null }]),
      vacancy("b", "Software Engineer", engineeringText, [{ id: "app-b", status: "READY_TO_SUBMIT", emailSentAt: null, submittedAt: null }]),
      vacancy("c", "Sales Manager", salesText, [{ id: "app-c", status: "VERIFIED", emailSentAt: new Date(), submittedAt: new Date() }]),
    ];
    db.applications = [
      { id: "app-b", organizationId: "org-1", status: "READY_TO_SUBMIT", emailSentAt: null, submittedAt: null },
      { id: "app-c", organizationId: "org-1", status: "VERIFIED", emailSentAt: new Date(), submittedAt: new Date() },
    ];
    db.jobs = [{ id: "queued-1", queue: "application-submit" }];
    const result = await auditMarketingScope("org-1", { apply: true });
    expect(result).toMatchObject({ vacancies: 3, inScope: 1, outOfScope: 2, vacanciesExcluded: 2 });
    const vacancyById = Object.fromEntries(db.vacancyUpdates.map((update) => [update.id, update.data]));
    expect(vacancyById.b.status).toBe("REJECTED");
    expect(vacancyById.c.status).toBe("REJECTED");
    expect(vacancyById.a.status).toBeUndefined();
    expect((vacancyById.b.rawData as { keep: string; marketing: { inScope: boolean } })).toMatchObject({ keep: "me", marketing: { inScope: false } });
    const withdrawn = db.applicationUpdates.filter((update) => update.data.status === "WITHDRAWN").map((update) => update.id);
    expect(withdrawn).toEqual(["app-b"]);
    expect(db.cancelled).toContain("queued-1");
  });
});
