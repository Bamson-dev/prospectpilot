import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { queueJob } from "@/lib/jobs";
import { confirmedOptInContactIds, hasConfirmedSubscription, isOptInSource } from "@/lib/email/opt-in";
import { accountDailyLimit, sentTodayWhere, systemDailyLimit } from "@/lib/email/send-limits";
import { FAILED_JOB_REQUEUE_AFTER_MS, processOutreachScan, shouldRequeueFailedJob } from "@/worker/processors/outreach-scan";

vi.mock("@/lib/db", () => ({
  prisma: {
    subscriber: { findMany: vi.fn(), findFirst: vi.fn() },
    outreachMessage: { findMany: vi.fn(), updateMany: vi.fn() },
    prospect: { update: vi.fn() },
    backgroundJob: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("@/lib/jobs", () => ({
  queueJob: vi.fn(),
  recordActivity: vi.fn(),
}));

const db = prisma as unknown as {
  subscriber: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  outreachMessage: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  prospect: { update: ReturnType<typeof vi.fn> };
  backgroundJob: { findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
};

describe("opt-in consent helpers", () => {
  it("recognises only the opt-in source label", () => {
    expect(isOptInSource("opt-in")).toBe(true);
    expect(isOptInSource(" Opt-In ")).toBe(true);
    expect(isOptInSource("website")).toBe(false);
    expect(isOptInSource(null)).toBe(false);
  });

  it("asks for a CONFIRMED subscriber linked to the contact", async () => {
    db.subscriber.findFirst.mockResolvedValueOnce({ id: "s1" });
    await expect(hasConfirmedSubscription(prisma, "org1", "c1")).resolves.toBe(true);
    expect(db.subscriber.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org1", contactId: "c1", status: "CONFIRMED" },
    }));
  });

  it("treats a contact without a confirmed subscriber as not consented", async () => {
    db.subscriber.findFirst.mockResolvedValueOnce(null);
    await expect(hasConfirmedSubscription(prisma, "org1", "c2")).resolves.toBe(false);
  });

  it("lists only contacts that a confirmed subscriber points at", async () => {
    db.subscriber.findMany.mockResolvedValueOnce([{ contactId: "c1" }, { contactId: null }, { contactId: "c3" }]);
    await expect(confirmedOptInContactIds(prisma)).resolves.toEqual(["c1", "c3"]);
    expect(db.subscriber.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: "CONFIRMED", contactId: { not: null } },
    }));
  });
});

describe("send limits", () => {
  it("keeps the previous defaults and accepts valid overrides", () => {
    expect(accountDailyLimit({})).toBe(40);
    expect(systemDailyLimit({})).toBe(200);
    expect(accountDailyLimit({ OUTREACH_ACCOUNT_DAILY_LIMIT: "25" })).toBe(25);
    expect(systemDailyLimit({ OUTREACH_SYSTEM_DAILY_LIMIT: "120" })).toBe(120);
  });

  it("ignores invalid overrides instead of removing the cap", () => {
    for (const value of ["", "0", "-5", "abc", "1.5"]) {
      expect(accountDailyLimit({ OUTREACH_ACCOUNT_DAILY_LIMIT: value })).toBe(40);
      expect(systemDailyLimit({ OUTREACH_SYSTEM_DAILY_LIMIT: value })).toBe(200);
    }
  });

  it("counts messages that are still sending toward today's total", () => {
    const start = new Date("2026-10-15T00:00:00.000Z");
    expect(sentTodayWhere(start)).toEqual({
      OR: [{ sentAt: { gte: start } }, { state: "SENDING", updatedAt: { gte: start } }],
    });
  });
});

describe("failed job requeue throttle", () => {
  const now = Date.parse("2026-10-15T12:00:00.000Z");

  it("waits before resuming a failed job", () => {
    expect(shouldRequeueFailedJob({ state: "FAILED", updatedAt: new Date(now - 60_000) }, now)).toBe(false);
  });

  it("resumes a failed job once the wait has passed", () => {
    expect(shouldRequeueFailedJob({ state: "FAILED", updatedAt: new Date(now - FAILED_JOB_REQUEUE_AFTER_MS) }, now)).toBe(true);
  });

  it("never touches jobs that are not failed", () => {
    for (const state of ["QUEUED", "ACTIVE", "COMPLETED"]) {
      expect(shouldRequeueFailedJob({ state, updatedAt: new Date(0) }, now)).toBe(false);
    }
  });
});

describe("outreach scan consent and repair behaviour", () => {
  beforeEach(() => {
    vi.stubEnv("OUTREACH_SEND_ENABLED", "true");
    for (const group of Object.values(db)) for (const fn of Object.values(group)) fn.mockReset();
    vi.mocked(queueJob).mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("does nothing when no subscriber is confirmed", async () => {
    db.subscriber.findMany.mockResolvedValue([]);
    await processOutreachScan();
    expect(db.outreachMessage.findMany).not.toHaveBeenCalled();
    expect(queueJob).not.toHaveBeenCalled();
  });

  it("limits the scan to contacts with a confirmed subscription", async () => {
    db.subscriber.findMany.mockResolvedValue([{ contactId: "c1" }]);
    db.outreachMessage.findMany.mockResolvedValue([]);
    await processOutreachScan();
    for (const call of db.outreachMessage.findMany.mock.calls) {
      expect(call[0].where.contact).toEqual(expect.objectContaining({ id: { in: ["c1"] }, source: "opt-in", suppressed: false }));
    }
    expect(db.outreachMessage.findMany).toHaveBeenCalledTimes(2);
  });

  it("approves and queues a draft for a confirmed contact exactly once", async () => {
    db.subscriber.findMany.mockResolvedValue([{ contactId: "c1" }]);
    db.outreachMessage.findMany
      .mockResolvedValueOnce([{ id: "m1", prospectId: "p1", organizationId: "org1" }])
      .mockResolvedValueOnce([]);
    db.outreachMessage.updateMany.mockResolvedValue({ count: 1 });
    await processOutreachScan();
    expect(queueJob).toHaveBeenCalledTimes(1);
    expect(queueJob).toHaveBeenCalledWith(expect.objectContaining({ id: "outreach-m1", queue: "outreach" }));
  });

  it("does not queue a message another scan already claimed", async () => {
    db.subscriber.findMany.mockResolvedValue([{ contactId: "c1" }]);
    db.outreachMessage.findMany
      .mockResolvedValueOnce([{ id: "m1", prospectId: "p1", organizationId: "org1" }])
      .mockResolvedValueOnce([]);
    db.outreachMessage.updateMany.mockResolvedValue({ count: 0 });
    await processOutreachScan();
    expect(queueJob).not.toHaveBeenCalled();
  });

  it("keeps a recently failed job and its error instead of deleting it", async () => {
    db.subscriber.findMany.mockResolvedValue([{ contactId: "c1" }]);
    db.outreachMessage.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "m1", organizationId: "org1" }]);
    db.backgroundJob.findUnique.mockResolvedValue({ id: "outreach-m1", state: "FAILED", error: "boom", updatedAt: new Date() });
    await processOutreachScan();
    expect(db.backgroundJob.delete).not.toHaveBeenCalled();
    expect(queueJob).not.toHaveBeenCalled();
  });

  it("resumes an old failed job without deleting its record", async () => {
    db.subscriber.findMany.mockResolvedValue([{ contactId: "c1" }]);
    db.outreachMessage.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "m1", organizationId: "org1" }]);
    db.backgroundJob.findUnique.mockResolvedValue({
      id: "outreach-m1",
      state: "FAILED",
      error: "limit",
      updatedAt: new Date(Date.now() - FAILED_JOB_REQUEUE_AFTER_MS - 1000),
    });
    await processOutreachScan();
    expect(db.backgroundJob.delete).not.toHaveBeenCalled();
    expect(queueJob).toHaveBeenCalledWith(expect.objectContaining({ id: "outreach-m1" }));
  });

  it("queues an approved message that has no job record", async () => {
    db.subscriber.findMany.mockResolvedValue([{ contactId: "c1" }]);
    db.outreachMessage.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "m1", organizationId: "org1" }]);
    db.backgroundJob.findUnique.mockResolvedValue(null);
    await processOutreachScan();
    expect(queueJob).toHaveBeenCalledWith(expect.objectContaining({ id: "outreach-m1" }));
  });

  it("does not scan at all while sending is off", async () => {
    vi.stubEnv("OUTREACH_SEND_ENABLED", "false");
    await processOutreachScan();
    expect(db.subscriber.findMany).not.toHaveBeenCalled();
    expect(db.outreachMessage.findMany).not.toHaveBeenCalled();
  });
});
