import { describe, expect, it } from "vitest";
import {
  acquireAutomationLock,
  admitRun,
  beginAutomation,
  blockerIsPermanent,
  crashAutomation,
  createEngineState,
  fieldIdentity,
  fillRemaining,
  inspectionIdempotencyKey,
  packageVersionAfter,
  persistDetectedField,
  recordDiscovery,
  recordFill,
  recordUpload,
  recordValidation,
  resumeAfterCrash,
  retryPlan,
  stopForBlocker,
} from "@/lib/applications/automation-engine";
import { preparationDecision } from "@/lib/applications/package-version";

const fields = [
  { label: "First name", name: "first_name", id: "first", type: "text", required: true, classification: "FIRST_NAME", confidence: 0.95, answer: "Bamidele", answerSource: "CANDIDATE", resolution: "ANSWERED" as const },
  { label: "Email", name: "email", id: "email", type: "email", required: true, classification: "EMAIL", confidence: 0.98, answer: "person@example.com", answerSource: "CANDIDATE", resolution: "ANSWERED" as const },
  { label: "Work authorization", name: "work_auth", id: "auth", type: "select", required: true, classification: "WORK_AUTHORIZATION", confidence: 0.9, answer: "yes", answerSource: "MODEL_GUESS", resolution: "ANSWERED" as const },
];

function readyState() {
  return createEngineState({
    applicationId: "app-1",
    applicationStatus: "READY_FOR_SUBMISSION",
    packageId: "pkg-1",
    packageVersion: 2,
    cvId: "cv-2",
    coverLetterId: "letter-2",
  });
}

describe("application automation engine", () => {
  it("creates one active run and refuses a second concurrent run", () => {
    const started = beginAutomation(readyState(), 1_000);
    expect(started.started).toBe(true);
    const again = beginAutomation(started.state, 1_500);
    expect(again.started).toBe(false);
    if (!again.started) expect(again.reason).toBe("active-run");
    const lock = acquireAutomationLock(started.state.lock, "other-run", 1_500);
    expect(lock.ok).toBe(false);
  });

  it("recovers a stale run without starting a second live run", () => {
    const started = beginAutomation(readyState(), 1_000);
    const decision = admitRun({ active: { id: started.runId!, status: "RUNNING", heartbeatAt: 1_000 }, now: 1_000 + 121_000 });
    expect(decision.action).toBe("recover");
    const resumed = resumeAfterCrash(started.state, 1_000 + 121_000);
    expect(resumed.started).toBe(true);
    expect(resumed.state.packageVersion).toBe(2);
    expect(resumed.state.runs.filter((run) => run.status === "RUNNING")).toHaveLength(1);
    expect(resumed.state.events).toContain("AUTOMATION_RESUMED");
  });

  it("persists discovery, classification, answers, filling, upload, and validation", () => {
    const started = beginAutomation(readyState(), 1_000);
    let state = recordDiscovery(started.state, { runId: started.runId!, url: "https://jobs.example/apply", platform: "GREENHOUSE", fields: fields.slice(0, 2), now: 1_100 });
    expect(state.events).toEqual(expect.arrayContaining(["FORM_DISCOVERED", "FIELDS_DETECTED", "FIELDS_CLASSIFIED", "ANSWERS_RESOLVED"]));
    const resolvable = state.fields.filter((field) => field.resolution === "RESOLVED").map((field) => field.fieldKey);
    state = recordFill(state, { runId: started.runId!, fieldKeys: resolvable.slice(0, 1), now: 1_200 });
    expect(state.fields.filter((field) => field.filled)).toHaveLength(1);
    state = recordUpload(state, { runId: started.runId!, cv: true, letter: true, now: 1_300 });
    expect(state.runs.at(-1)?.cvUpload).toBe("UPLOADED");
    expect(state.runs.at(-1)?.coverUpload).toBe("UPLOADED");
    expect(state.cvId).toBe("cv-2");
    expect(state.coverLetterId).toBe("letter-2");
    state = recordValidation(state, { runId: started.runId!, now: 1_400 });
    expect(state.applicationStatus).toBe("READY_FOR_SUBMISSION");
    expect(state.submitted).toBe(false);
    expect(state.events).toContain("FORM_VALIDATED");
    expect(state.packageVersion).toBe(2);
  });

  it("resumes after a browser crash on the same package version", () => {
    const started = beginAutomation(readyState(), 1_000);
    let state = recordDiscovery(started.state, { runId: started.runId!, url: "https://jobs.example/apply", platform: "LEVER", fields, now: 1_100 });
    const keys = state.fields.filter((field) => field.resolution === "RESOLVED").map((field) => field.fieldKey);
    state = recordFill(state, { runId: started.runId!, fieldKeys: keys.slice(0, 1), now: 1_200 });
    state = crashAutomation(state, started.runId!, 1_300);
    expect(state.packageVersion).toBe(2);
    expect(state.cvId).toBe("cv-2");
    expect(state.submitted).toBe(false);
    expect(state.events).toContain("AUTOMATION_RETRY_SCHEDULED");
    expect(state.fields.filter((field) => field.filled)).toHaveLength(1);
    const resumed = beginAutomation(state, 1_400);
    expect(resumed.started).toBe(true);
    expect(resumed.state.packageVersion).toBe(2);
    expect(resumed.state.runs.at(-1)?.currentStep).toBe("FORM_FILLING");
    expect(resumed.state.runs.at(-1)?.cvId).toBe("cv-2");
    const remaining = fillRemaining(resumed.state, keys.slice(0, 1));
    expect(remaining).toEqual(keys.slice(1));
    const filled = recordFill(resumed.state, { runId: resumed.runId!, fieldKeys: remaining, liveFilled: keys.slice(0, 1), now: 1_500 });
    expect(filled.packageVersion).toBe(2);
    expect(packageVersionAfter(2, "browser-crash")).toBe(2);
    expect(packageVersionAfter(2, "content-change")).toBe(3);
  });

  it("schedules a rate limit retry without a new package or submission", () => {
    const started = beginAutomation(readyState(), 1_000);
    const stopped = stopForBlocker(started.state, started.runId!, "HTTP_429", 1_100, 30_000);
    expect(stopped.applicationStatus).toBe("RATE_LIMITED");
    expect(stopped.packageVersion).toBe(2);
    expect(stopped.submitted).toBe(false);
    expect(stopped.runs.at(-1)?.nextRetryAt).toBeGreaterThan(1_100);
    expect(stopped.events).toContain("AUTOMATION_RETRY_SCHEDULED");
    const plan = retryPlan({ code: "RATE_LIMITED", attempt: 3, now: 1_100 });
    expect(plan.retry).toBe(false);
  });

  it("keeps a captcha checkpoint and package without submission", () => {
    const started = beginAutomation(readyState(), 1_000);
    let state = recordDiscovery(started.state, { runId: started.runId!, url: "https://jobs.example/apply", platform: "GREENHOUSE", fields: fields.slice(0, 2), now: 1_100 });
    state = stopForBlocker(state, started.runId!, "CAPTCHA_REQUIRED", 1_200);
    expect(state.applicationStatus).toBe("CAPTCHA_REQUIRED");
    expect(state.packageVersion).toBe(2);
    expect(state.cvId).toBe("cv-2");
    expect(state.fields.length).toBeGreaterThan(0);
    expect(state.submitted).toBe(false);
    expect(blockerIsPermanent("CAPTCHA_REQUIRED")).toBe(true);
    expect(retryPlan({ code: "CAPTCHA_REQUIRED", attempt: 1, now: 1_200 }).retry).toBe(false);
  });

  it("keeps unknown required fields and a missing form unresolved", () => {
    const started = beginAutomation(readyState(), 1_000);
    const unknown = recordDiscovery(started.state, {
      runId: started.runId!,
      url: "https://jobs.example/apply",
      platform: "GENERIC",
      fields: [{ label: "Custom", name: "custom", id: "custom", type: "text", required: true, classification: "UNKNOWN", confidence: 0.2, resolution: "UNSUPPORTED" }],
      now: 1_100,
    });
    expect(unknown.applicationStatus).toBe("UNKNOWN_REQUIRED_FIELD");
    expect(unknown.submitted).toBe(false);
    const missing = stopForBlocker(beginAutomation(readyState(), 2_000).state, "run-1", "APPLICATION_FORM_NOT_FOUND", 2_100);
    expect(missing.applicationStatus).toBe("FORM_NOT_FOUND");
  });

  it("does not move a legacy manual application or invent a sensitive answer", () => {
    const legacy = createEngineState({ applicationId: "app-legacy", applicationStatus: "REQUIRES_MANUAL_ACTION", packageId: "pkg-2", packageVersion: 2, cvId: "cv", coverLetterId: "letter" });
    const held = beginAutomation(legacy, 1_000);
    expect(held.started).toBe(false);
    expect(held.state.applicationStatus).toBe("REQUIRES_MANUAL_ACTION");
    expect(held.state.packageVersion).toBe(2);
    expect(held.state.submitted).toBe(false);
    const sensitive = persistDetectedField(fields[2]);
    expect(sensitive.answer).toBeNull();
    expect(sensitive.resolution).toBe("UNRESOLVED");
    expect(fieldIdentity({ name: "email", id: "email", label: "Email", type: "email" })).toBe(fieldIdentity({ name: "email", id: "email", label: "Email", type: "email" }));
    expect(inspectionIdempotencyKey("app-1", "pkg-1", 2)).toBe("inspect:app-1:pkg-1:2");
    expect(preparationDecision(true, false)).toBe("REUSE");
  });

  it("reuses an uploaded document on the next attempt", () => {
    const started = beginAutomation(readyState(), 1_000);
    const uploaded = recordUpload(started.state, { runId: started.runId!, cv: true, letter: true, now: 1_100 });
    const crashed = crashAutomation(uploaded, started.runId!, 1_200);
    const resumed = beginAutomation(crashed, 1_300);
    expect(resumed.state.runs.at(-1)?.cvUpload).toBe("UPLOADED");
    expect(resumed.state.runs.at(-1)?.coverUpload).toBe("UPLOADED");
    expect(resumed.state.cvId).toBe("cv-2");
    expect(resumed.state.packageVersion).toBe(2);
  });
});
