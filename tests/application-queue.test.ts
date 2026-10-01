import { describe, expect, it } from "vitest";
import { discoveryLimit, keptQualificationExplanation, queueAdmission, selectBulkPrepare, storedFitDecision } from "@/lib/applications/application-queue";
import { inspectionIsBlocked } from "@/lib/applications/public-inspection";

describe("application queue", () => {
  it("admits apply vacancies automatically and review vacancies only when queued", () => {
    expect(queueAdmission({ decision: "APPLY", manuallyQueued: false })).toBe("automatic");
    expect(queueAdmission({ decision: "REVIEW", manuallyQueued: false })).toBe("excluded");
    expect(queueAdmission({ decision: "REVIEW", manuallyQueued: true })).toBe("manual");
    expect(queueAdmission({ decision: "NOT_A_FIT", manuallyQueued: true })).toBe("excluded");
    expect(queueAdmission({ decision: "NOT_A_FIT", manuallyQueued: false })).toBe("excluded");
  });

  it("keeps a bulk batch at 10 and drops ineligible vacancies", () => {
    const eligible = new Set(["a", "b"]);
    expect(selectBulkPrepare(["a", "a", "c"], eligible)).toEqual({ ok: true, reason: null, ids: ["a"], rejected: ["c"] });
    const tooMany = selectBulkPrepare(Array.from({ length: 11 }, (_, index) => `v${index}`), new Set(Array.from({ length: 11 }, (_, index) => `v${index}`)));
    expect(tooMany.ok).toBe(false);
    expect(tooMany.ids).toEqual([]);
  });

  it("caps an explicit discovery batch at 20 and keeps the previous default", () => {
    expect(discoveryLimit(undefined)).toBe(40);
    expect(discoveryLimit("15")).toBe(15);
    expect(discoveryLimit("500")).toBe(20);
    expect(discoveryLimit("0")).toBe(1);
  });

  it("keeps the stored qualification explanation when a package is prepared", () => {
    const analysis = { explanation: { state: "APPLY", opportunity: { decision: "APPLY", primaryProfile: "GROWTH_GTM" } } };
    expect(keptQualificationExplanation(analysis)?.state).toBe("APPLY");
    expect(storedFitDecision({ ...analysis, qualification: "APPLY", explanation: keptQualificationExplanation(analysis) })).toBe("APPLY");
    expect(keptQualificationExplanation({ qualification: "APPLY" })).toBeUndefined();
    expect(keptQualificationExplanation(null)).toBeUndefined();
  });

  it("reads the stored qualification decision", () => {
    expect(storedFitDecision({ explanation: { state: "APPLY", opportunity: { decision: "REVIEW", primaryProfile: "SOFTWARE_ENGINEER" } } })).toBe("REVIEW");
    expect(storedFitDecision({ qualification: "NOT_A_FIT" })).toBe("NOT_A_FIT");
  });

  it("treats a paused form as inspected and a captcha as blocked", () => {
    expect(inspectionIsBlocked({ submitted: false, reason: "pause before submit", status: "READY_FOR_HUMAN_SUBMISSION" })).toBe(false);
    expect(inspectionIsBlocked({ submitted: false, reason: "captcha", status: "REQUIRES_MANUAL_ACTION" })).toBe(true);
    expect(inspectionIsBlocked({ submitted: true, reason: null, status: "READY_FOR_HUMAN_SUBMISSION" })).toBe(true);
  });
});
