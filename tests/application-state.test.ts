import { describe, expect, it } from "vitest";
import {
  automaticSubmissionAllowed,
  canTransition,
  isBlockerState,
  isRetryableState,
  isSuccessfulSubmissionState,
  isTerminalApplicationState,
  pipelineState,
  statusAfterBlock,
} from "@/lib/applications/state";

describe("application state model", () => {
  it("maps known blockers to precise statuses and unknown blockers to legacy review", () => {
    expect(statusAfterBlock("CAPTCHA_REQUIRED")).toBe("CAPTCHA_REQUIRED");
    expect(statusAfterBlock("captcha")).toBe("CAPTCHA_REQUIRED");
    expect(statusAfterBlock("RATE_LIMITED")).toBe("RATE_LIMITED");
    expect(statusAfterBlock("HTTP_429")).toBe("RATE_LIMITED");
    expect(statusAfterBlock("UNKNOWN_REQUIRED_FIELD")).toBe("UNKNOWN_REQUIRED_FIELD");
    expect(statusAfterBlock("UNRESOLVED_REQUIRED_FIELD")).toBe("UNKNOWN_REQUIRED_FIELD");
    expect(statusAfterBlock("LOGIN_REQUIRED")).toBe("LOGIN_REQUIRED");
    expect(statusAfterBlock("AUTH_REQUIRED")).toBe("AUTH_REQUIRED");
    expect(statusAfterBlock("CLOUDFLARE_CHALLENGE")).toBe("CLOUDFLARE_CHALLENGE");
    expect(statusAfterBlock("APPLICATION_FORM_NOT_FOUND")).toBe("FORM_NOT_FOUND");
    expect(statusAfterBlock("SECURITY_BLOCK")).toBe("REQUIRES_MANUAL_ACTION");
    expect(statusAfterBlock("verification")).toBe("SUBMISSION_UNVERIFIED");
    expect(statusAfterBlock(null)).toBe("REQUIRES_MANUAL_ACTION");
  });

  it("keeps submission and verification states visible", () => {
    expect(pipelineState("SUBMITTING")).toBe("SUBMITTING");
    expect(pipelineState("SUBMITTED")).toBe("SUBMITTED");
    expect(pipelineState("VERIFIED")).toBe("VERIFIED");
    expect(pipelineState("SUBMISSION_UNVERIFIED")).toBe("SUBMISSION_UNVERIFIED");
    expect(pipelineState("VERIFICATION_PENDING")).toBe("VERIFICATION_PENDING");

    expect(pipelineState("CAPTCHA_REQUIRED")).toBe("CAPTCHA_REQUIRED");
    expect(pipelineState("RATE_LIMITED")).toBe("RATE_LIMITED");
    expect(pipelineState("REQUIRES_MANUAL_ACTION")).toBe("REQUIRES_MANUAL_ACTION");
  });

  it("continues the existing lifecycle through blockers, submission, and verification", () => {
    expect(canTransition("READY_FOR_SUBMISSION", "CAPTCHA_REQUIRED")).toBe(true);
    expect(canTransition("READY_FOR_SUBMISSION", "RATE_LIMITED")).toBe(true);
    expect(canTransition("READY_FOR_SUBMISSION", "UNKNOWN_REQUIRED_FIELD")).toBe(true);
    expect(canTransition("READY_FOR_SUBMISSION", "LOGIN_REQUIRED")).toBe(true);
    expect(canTransition("READY_FOR_SUBMISSION", "AUTH_REQUIRED")).toBe(true);
    expect(canTransition("READY_FOR_SUBMISSION", "CLOUDFLARE_CHALLENGE")).toBe(true);
    expect(canTransition("READY_FOR_SUBMISSION", "FORM_NOT_FOUND")).toBe(true);
    expect(canTransition("CAPTCHA_REQUIRED", "READY_FOR_SUBMISSION")).toBe(true);
    expect(canTransition("RATE_LIMITED", "READY_FOR_SUBMISSION")).toBe(true);
    expect(isRetryableState("RATE_LIMITED")).toBe(true);
    expect(isRetryableState("CAPTCHA_REQUIRED")).toBe(false);
    expect(canTransition("SUBMITTING", "SUBMITTED")).toBe(true);
    expect(canTransition("SUBMITTING", "SUBMISSION_UNVERIFIED")).toBe(true);
    expect(canTransition("SUBMITTED", "VERIFICATION_PENDING")).toBe(true);
    expect(canTransition("SUBMISSION_UNVERIFIED", "VERIFICATION_PENDING")).toBe(false);
    expect(canTransition("SUBMISSION_UNVERIFIED", "SUBMITTED")).toBe(false);
    expect(isSuccessfulSubmissionState("SUBMISSION_UNVERIFIED")).toBe(false);
    expect(isSuccessfulSubmissionState("SUBMITTED")).toBe(true);
    expect(isSuccessfulSubmissionState("VERIFIED")).toBe(true);
  });

  it("keeps terminal and legacy states compatible", () => {
    expect(isTerminalApplicationState("REJECTED")).toBe(true);
    expect(isTerminalApplicationState("WITHDRAWN")).toBe(true);
    expect(isTerminalApplicationState("VERIFIED")).toBe(true);
    expect(isTerminalApplicationState("SUBMITTED")).toBe(false);
    expect(canTransition("REJECTED", "READY_FOR_SUBMISSION")).toBe(false);
    expect(canTransition("WITHDRAWN", "SUBMITTING")).toBe(false);
    expect(canTransition("REQUIRES_MANUAL_ACTION", "SUBMITTED")).toBe(false);
    expect(canTransition("REQUIRES_MANUAL_ACTION", "SUBMITTING")).toBe(true);
    expect(canTransition("REQUIRES_MANUAL_ACTION", "READY_FOR_REVIEW")).toBe(true);
    expect(canTransition("REQUIRES_MANUAL_ACTION", "CAPTCHA_REQUIRED")).toBe(false);
    expect(isBlockerState("CAPTCHA_REQUIRED")).toBe(true);
    expect(isBlockerState("REQUIRES_MANUAL_ACTION")).toBe(false);
    expect(pipelineState("APPROVED")).toBe("APPROVED");
    expect(pipelineState("READY_FOR_SUBMISSION")).toBe("READY");
    
    // Milestone H Additions
    expect(isTerminalApplicationState("REJECTED_BY_EMPLOYER")).toBe(true);
    expect(isTerminalApplicationState("OFFER")).toBe(true);
    expect(canTransition("REJECTED_BY_EMPLOYER", "READY_FOR_SUBMISSION")).toBe(false);
    expect(canTransition("OFFER", "SUBMITTED")).toBe(false);
  });

  it("allows automatic submission only through the existing safety gates", () => {
    expect(automaticSubmissionAllowed()).toBe(false);
    expect(automaticSubmissionAllowed({
      automationEnabled: true,
      liveSubmit: true,
      mode: "AUTO_SUBMIT",
      pageUrl: "https://job-boards.greenhouse.io/gitlab/jobs/1",
      status: "READY_FOR_SUBMISSION",
      packageReady: true,
    })).toBe(false);
    expect(automaticSubmissionAllowed({
      automationEnabled: true,
      liveSubmit: true,
      mode: "AUTO_SUBMIT",
      pageUrl: "http://127.0.0.1:3000/apply",
      status: "READY_FOR_SUBMISSION",
      packageReady: true,
    })).toBe(true);
    expect(automaticSubmissionAllowed({
      automationEnabled: true,
      liveSubmit: true,
      mode: "AUTO_SUBMIT",
      pageUrl: "http://127.0.0.1:3000/apply",
      status: "CAPTCHA_REQUIRED",
      packageReady: true,
    })).toBe(false);
    expect(automaticSubmissionAllowed({
      automationEnabled: false,
      liveSubmit: true,
      mode: "AUTO_SUBMIT",
      pageUrl: "http://127.0.0.1:3000/apply",
      status: "READY_FOR_SUBMISSION",
    })).toBe(false);
  });
});
