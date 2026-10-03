import { describe, expect, it } from "vitest";
import { FormattingValidator } from "@/lib/applications/validators";
import { preparationDecision } from "@/lib/applications/package-version";
import { canTransition } from "@/lib/applications/state";
import { preparationReadinessLine } from "@/lib/applications/security";
import {
  browserPreparationView,
  buildFieldReview,
  currentDocument,
  humanActionInstruction,
  latestManualMarker,
  manualReviewRecord,
  packageApproval,
  presentSensitiveField,
  qualificationDecision,
  verifiedEvidence,
} from "@/lib/applications/manual-review";

const captchaTimings = { blocker: "CAPTCHA_REQUIRED", browserPlatform: "GREENHOUSE", browserFields: 23, fieldsDetected: 23, fieldsClassified: 23, requiredFields: 2, fieldsReviewRequired: 2 };

describe("manual review workflow", () => {
  it("shows the stored blocker and the same readiness line", () => {
    const view = browserPreparationView(captchaTimings, null);
    expect(view.blocker).toBe("CAPTCHA_REQUIRED");
    expect(view.readiness).toBe(preparationReadinessLine("CAPTCHA_REQUIRED"));
    expect(view.agrees).toBe(true);
    expect(view.stopped).toBe(true);
    expect(view.submitted).toBe(false);
    expect(view.submittedAt).toBe("Empty");
    expect(humanActionInstruction("CAPTCHA_REQUIRED")?.instruction).toContain("Complete the employer CAPTCHA manually");
    expect(humanActionInstruction("RATE_LIMITED")?.instruction).toBe("Employer rate limit encountered. Retry later.");
    expect(humanActionInstruction("RATE_LIMITED")?.readiness).toBe(preparationReadinessLine("RATE_LIMITED"));
  });

  it("selects the current documents and unresolved sensitive fields", () => {
    const documents = [
      { kind: "CV", version: 1, fileName: "old.docx" },
      { kind: "CV", version: 2, fileName: "Bamidele-Matthew-Software-Engineer-GitLab.docx" },
      { kind: "COVER_LETTER", version: 2, fileName: "Bamidele-Matthew-Cover-Letter-GitLab.pdf" },
      { kind: "COVER_LETTER", version: 1, fileName: "old.pdf" },
    ];
    expect(currentDocument(documents, "CV")?.fileName).toBe("Bamidele-Matthew-Software-Engineer-GitLab.docx");
    expect(currentDocument(documents, "CV")?.version).toBe(2);
    expect(currentDocument(documents, "COVER_LETTER")?.version).toBe(2);
    const fields = buildFieldReview({ answers: [], workAuthorization: null, sponsorship: null });
    expect(fields.sensitive.map((field) => field.label)).toEqual(["Work authorization", "Sponsorship"]);
    expect(fields.sensitive.every((field) => field.reviewState === "REVIEW_REQUIRED" && field.answer === null)).toBe(true);
    expect(presentSensitiveField("WORK_AUTHORIZATION", { answer: "Citizen", source: "MODEL_GUESS" })).toEqual({ reviewState: "REVIEW_REQUIRED", answer: null, source: null });
    expect(presentSensitiveField("SPONSORSHIP", { answer: "No", source: "inferred" }).answer).toBeNull();
  });

  it("approves and rejects a package without submitting", () => {
    const approved = packageApproval({ status: "REQUIRES_MANUAL_ACTION", decision: "APPROVED", reason: "", packageVersion: 2, blocker: "CAPTCHA_REQUIRED" });
    expect(approved).toMatchObject({ status: "REQUIRES_MANUAL_ACTION", submits: false, event: "APPROVED" });
    if ("detail" in approved) expect(approved.detail).toContain("Not submitted");
    const rejected = packageApproval({ status: "REQUIRES_MANUAL_ACTION", decision: "REJECTED", reason: "Wrong profile", packageVersion: 2, blocker: "CAPTCHA_REQUIRED" });
    expect(rejected).toMatchObject({ status: "REJECTED", submits: false, event: "REJECTED" });
    if ("detail" in rejected) expect(rejected.detail).toContain("Wrong profile");
    expect(packageApproval({ status: "REQUIRES_MANUAL_ACTION", decision: "REJECTED", reason: "  ", packageVersion: 1, blocker: null })).toEqual({ error: "A rejection reason is required." });
    expect(canTransition("REQUIRES_MANUAL_ACTION", "SUBMITTED")).toBe(false);
    expect(canTransition("REQUIRES_MANUAL_ACTION", "SUBMITTING")).toBe(true);
    expect(canTransition("REQUIRES_MANUAL_ACTION", "REJECTED")).toBe(true);
  });

  it("audits manual review without storing secrets or creating a submission", () => {
    const started = manualReviewRecord({ marker: "MANUAL_REVIEW_STARTED", status: "REQUIRES_MANUAL_ACTION", packageVersion: 1, blocker: "CAPTCHA_REQUIRED" });
    expect(started).toMatchObject({ status: "REQUIRES_MANUAL_ACTION", submittedAt: null, event: "MANUAL_ACTION_REQUIRED" });
    if ("detail" in started) {
      expect(started.detail).toContain("MANUAL_REVIEW_STARTED");
      expect(started.detail).toContain("version 1");
      expect(started.detail).toContain("CAPTCHA_REQUIRED");
    }
    const completed = manualReviewRecord({ marker: "MANUAL_REVIEW_COMPLETED", status: "REQUIRES_MANUAL_ACTION", packageVersion: 1, blocker: "CAPTCHA_REQUIRED", reason: "Filled the form in the employer tab" });
    expect(completed).toMatchObject({ status: "REQUIRES_MANUAL_ACTION", submittedAt: null });
    expect(manualReviewRecord({ marker: "MANUAL_REVIEW_COMPLETED", status: "SUBMITTED", packageVersion: 1, blocker: null })).toEqual({ error: "Manual review cannot create a submission." });
    const secret = manualReviewRecord({ marker: "MANUAL_ACTION_NOT_COMPLETED", status: "REQUIRES_MANUAL_ACTION", packageVersion: 1, blocker: "CAPTCHA_REQUIRED", reason: "g-recaptcha-response=abc cookie: session" });
    if ("detail" in secret) expect(secret.detail).toBe("redacted");
    expect(latestManualMarker([
      { type: "MANUAL_ACTION_REQUIRED", detail: "MANUAL_REVIEW_COMPLETED; previous REQUIRES_MANUAL_ACTION; new REQUIRES_MANUAL_ACTION" },
      { type: "CAPTCHA_DETECTED", detail: "CAPTCHA detected" },
    ])).toBe("MANUAL_REVIEW_COMPLETED");
  });

  it("keeps qualification, documents, and duplicate protection intact", () => {
    const analysis = { qualification: "APPLY", explanation: { state: "APPLY", opportunity: { reason: "The career lane matches verified evidence.", primaryProfile: "SOFTWARE_ENGINEER", secondaryProfiles: ["PRODUCT_ENGINEER"] } } };
    expect(qualificationDecision(analysis, "CAPTCHA_REQUIRED").decision).toBe("APPLY");
    expect(qualificationDecision(analysis, "RATE_LIMITED").decision).toBe("APPLY");
    expect(verifiedEvidence([
      { fact: "PromptEarn founder and CMO experience", verified: true, sourceType: "CANDIDATE_ENTERED" },
      { fact: "Generated CV sentence", verified: false, sourceType: "SYSTEM_GENERATED" },
    ])).toEqual([{ claim: "PromptEarn founder and CMO experience", source: "CANDIDATE_ENTERED", verification: "VERIFIED" }]);
    expect(preparationDecision(true, false)).toBe("REUSE");
    expect(FormattingValidator("Summary\nExperience\nSkills").ok).toBe(true);
    expect(FormattingValidator("Summary only").ok).toBe(false);
    expect(browserPreparationView({ blocker: "CAPTCHA_REQUIRED", browserFields: 23 }, null).fieldsDetected).toBe(23);
  });
});
