import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  application: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  sentToday: 0,
  sentToEmployer: 0,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    jobApplication: {
      findUnique: vi.fn(async () => db.application),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => { db.updates.push(args.data); return {}; }),
      updateMany: vi.fn(async (args: { data: Record<string, unknown> }) => { db.updates.push(args.data); return { count: 1 }; }),
      count: vi.fn(async (args: { where: { vacancy?: unknown } }) => (args.where.vacancy ? db.sentToEmployer : db.sentToday)),
    },
    applicationEvent: { create: vi.fn(async (args: { data: Record<string, unknown> }) => { db.events.push(args.data); return {}; }) },
    generatedDocument: { findUnique: vi.fn(async () => ({ id: "doc", fileName: "file.pdf", fileType: "application/pdf", content: new Uint8Array([1, 2, 3]), text: "Dear team, I would like to apply." })) },
    emailAccount: { findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/jobs", () => ({ queueJob: vi.fn(async () => ({ id: "job" })) }));

import { emailFitAllowed, emailPackageBlockers, sendEmailApplication } from "@/lib/applications/email-apply";
import { titleMatchesTargetRoles } from "@/lib/applications/job-queries";

function mailer() {
  return {
    sendEmail: vi.fn(async (_message: { to: string }) => ({ providerMessageId: "msg-1" })),
    confirmSent: vi.fn(async () => true),
    findSent: vi.fn(async () => null),
  };
}

function application(overrides: { strategy?: string; title?: string; description?: string; targetRoles?: string[]; warnings?: string[] } = {}) {
  return {
    id: "app-1",
    organizationId: "org-1",
    status: "READY_TO_SUBMIT",
    emailSentAt: null,
    emailAttemptAt: null,
    cvId: "cv",
    coverLetterId: "letter",
    vacancy: {
      title: overrides.title ?? "Growth Marketing Manager",
      companyName: "Northwind Digital",
      companyDomain: "northwind.io",
      normalizedCompany: "northwind digital",
      applicationUrl: "https://northwind.io/jobs/1",
      sourceUrl: "https://northwind.io/jobs/1",
      description: overrides.description ?? "To apply, email your CV and cover letter to careers@northwind.io.",
    },
    candidate: { fullName: "Ada Lovelace", email: "ada.lovelace@gmail.com", phone: null, targetRoles: overrides.targetRoles ?? ["growth marketing manager"] },
    package: { strategy: overrides.strategy ?? "PREPARE", warnings: overrides.warnings ?? [] },
  };
}

beforeEach(() => {
  process.env.JOB_APPLICATION_EMAIL_ENABLED = "true";
  db.updates.length = 0;
  db.events.length = 0;
  db.sentToday = 0;
  db.sentToEmployer = 0;
  db.application = application();
});

describe("sendEmailApplication safety", () => {
  it("sends a PREPARE application with a matching title to the designated address", async () => {
    const m = mailer();
    const result = await sendEmailApplication("app-1", { mailer: m, from: "ada.lovelace@gmail.com" });
    expect(result.outcome).toBe("SENT");
    expect(m.sendEmail).toHaveBeenCalledTimes(1);
    expect(m.sendEmail.mock.calls[0][0]).toMatchObject({ to: "careers@northwind.io" });
    expect(m.confirmSent).toHaveBeenCalledWith("msg-1");
  });

  it("does not send a REVIEW application", async () => {
    db.application = application({ strategy: "REVIEW" });
    const m = mailer();
    const result = await sendEmailApplication("app-1", { mailer: m, from: "x@y.co" });
    expect(result.outcome).toBe("BLOCKED");
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("does not send when the title is outside the configured target roles", async () => {
    db.application = application({ title: "Brand Marketing Manager", description: "Own brand strategy and positioning campaigns. To apply, email your CV and cover letter to careers@northwind.io." });
    const m = mailer();
    const result = await sendEmailApplication("app-1", { mailer: m, from: "x@y.co" });
    expect(result.outcome).toBe("BLOCKED");
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("does not send when no target roles are configured", async () => {
    db.application = application({ targetRoles: [] });
    const m = mailer();
    expect((await sendEmailApplication("app-1", { mailer: m, from: "x@y.co" })).outcome).toBe("BLOCKED");
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("does not send to an accessibility mailbox", async () => {
    db.application = application({ description: "To apply, send your CV to accessibility@northwind.io." });
    const m = mailer();
    const result = await sendEmailApplication("app-1", { mailer: m, from: "x@y.co" });
    expect(result.outcome).toBe("NO_EMAIL_ROUTE");
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("does not send a package with a placeholder warning", async () => {
    db.application = application({ warnings: ["Cover letter placeholder text found"] });
    const m = mailer();
    expect((await sendEmailApplication("app-1", { mailer: m, from: "x@y.co" })).outcome).toBe("BLOCKED");
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("keeps the daily limit", async () => {
    db.sentToday = 25;
    const m = mailer();
    expect((await sendEmailApplication("app-1", { mailer: m, from: "x@y.co" })).outcome).toBe("DEFERRED");
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("keeps the per employer weekly limit", async () => {
    db.sentToEmployer = 3;
    const m = mailer();
    expect((await sendEmailApplication("app-1", { mailer: m, from: "x@y.co" })).outcome).toBe("DEFERRED");
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("does not send twice when the application already has a send record", async () => {
    db.application = { ...application(), emailSentAt: new Date() };
    const m = mailer();
    expect((await sendEmailApplication("app-1", { mailer: m, from: "x@y.co" })).outcome).toBe("ALREADY_SENT");
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it("does nothing when the email switch is off", async () => {
    process.env.JOB_APPLICATION_EMAIL_ENABLED = "false";
    const m = mailer();
    expect((await sendEmailApplication("app-1", { mailer: m, from: "x@y.co" })).outcome).toBe("DISABLED");
    expect(m.sendEmail).not.toHaveBeenCalled();
  });
});

describe("automatic application fit states", () => {
  it("allows only PREPARE", () => {
    expect(emailFitAllowed("PREPARE")).toBe(true);
  });

  it("refuses REVIEW, which means a required skill is missing or a degree blocker exists", () => {
    expect(emailFitAllowed("REVIEW")).toBe(false);
  });

  it("refuses every other state and a missing state", () => {
    for (const state of ["MANUAL_REVIEW", "DO_NOT_PREPARE", "SKIP", "", null, undefined]) {
      expect(emailFitAllowed(state as string | null | undefined)).toBe(false);
    }
  });

  it("still blocks packages with unsupported claims or placeholders", () => {
    expect(emailPackageBlockers(["Unsupported claim: led a team of 50"])).toHaveLength(1);
    expect(emailPackageBlockers(["Cover letter contains a placeholder"])).toHaveLength(1);
    expect(emailPackageBlockers(["Missing requirement: bachelor degree"])).toHaveLength(0);
  });
});

describe("vacancy title against configured target roles", () => {
  const roles = ["Growth Marketing Manager", "Performance Marketing", "CTO"];

  it("accepts a title that contains every subject word of a role", () => {
    expect(titleMatchesTargetRoles("Senior Growth Marketing Manager (Remote)", roles)).toBe(true);
    expect(titleMatchesTargetRoles("Performance Marketing Lead", roles)).toBe(true);
  });

  it("refuses a title that matches none of the roles", () => {
    expect(titleMatchesTargetRoles("Renewals Manager", roles)).toBe(false);
    expect(titleMatchesTargetRoles("Accessibility Verification Officer", roles)).toBe(false);
    expect(titleMatchesTargetRoles("Marketing Intern", roles)).toBe(false);
  });

  it("matches short roles as whole words only", () => {
    expect(titleMatchesTargetRoles("CTO, Fintech Startup", roles)).toBe(true);
    expect(titleMatchesTargetRoles("Doctor of Optometry", roles)).toBe(false);
  });

  it("refuses everything when no target roles are configured", () => {
    expect(titleMatchesTargetRoles("Growth Marketing Manager", [])).toBe(false);
    expect(titleMatchesTargetRoles("Growth Marketing Manager", null)).toBe(false);
    expect(titleMatchesTargetRoles("Growth Marketing Manager", ["  "])).toBe(false);
  });
});

describe("hourly requeue scan", () => {
  it("does nothing unless live submission, automation, auto mode and the email switch are all on", async () => {
    const { queueDueEmailApplications, emailApplicationsMayRun } = await import("@/lib/applications/email-apply");
    const keys = ["JOB_APPLICATION_EMAIL_ENABLED", "APPLICATION_AUTOMATION_ENABLED", "APPLICATION_LIVE_SUBMIT", "APPLICATION_MODE"] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      process.env.JOB_APPLICATION_EMAIL_ENABLED = "true";
      process.env.APPLICATION_AUTOMATION_ENABLED = "true";
      process.env.APPLICATION_MODE = "AUTO_SUBMIT";
      process.env.APPLICATION_LIVE_SUBMIT = "false";
      expect(emailApplicationsMayRun()).toBe(false);
      expect(await queueDueEmailApplications()).toBe(0);
      process.env.APPLICATION_LIVE_SUBMIT = "true";
      expect(emailApplicationsMayRun()).toBe(true);
      process.env.APPLICATION_MODE = "AUTO_PREPARE";
      expect(emailApplicationsMayRun()).toBe(false);
    } finally {
      for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  });
});
