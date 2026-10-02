import { describe, expect, it } from "vitest";
import { beginAutomation } from "@/lib/applications/automation-engine";
import {
  completePreparedForm,
  continuePreparedForm,
  resumePreparedForm,
  type CompletionField,
  type CompletionPage,
} from "@/lib/applications/form-completion";

function field(partial: Partial<CompletionField> & Pick<CompletionField, "classification">): CompletionField {
  return {
    label: partial.label ?? partial.name ?? "Field",
    name: partial.name ?? partial.label ?? "field",
    id: partial.id ?? partial.name ?? "field",
    type: partial.type ?? "text",
    required: partial.required ?? false,
    confidence: partial.confidence ?? 0.95,
    answer: partial.answer ?? null,
    answerSource: partial.answerSource ?? (partial.answer ? "verified-profile" : null),
    resolution: partial.resolution ?? (partial.answer ? "ANSWERED" : "REVIEW_REQUIRED"),
    options: partial.options,
    liveValue: partial.liveValue,
    attachedFile: partial.attachedFile,
    checked: partial.checked,
    classification: partial.classification,
  };
}

function sampleForm(): CompletionField[] {
  return [
    field({ name: "first_name", label: "First Name", classification: "FULL_NAME", required: true, answer: "Bamidele" }),
    field({ name: "last_name", label: "Last Name", classification: "FULL_NAME", required: true, answer: "Matthew" }),
    field({ name: "email", label: "Email Address", type: "email", classification: "EMAIL", required: true, answer: "bamz@example.com" }),
    field({ name: "phone", label: "Phone Number", type: "tel", classification: "PHONE", required: false, answer: "+15551234" }),
    field({ name: "linkedin", label: "LinkedIn URL", type: "url", classification: "PROFILE", required: false, answer: "https://linkedin.com/in/bamz" }),
    field({ name: "work_setting", label: "Work Preference", type: "select", classification: "CUSTOM_QUESTION", required: true, answer: "Remote", options: ["Remote", "Hybrid", "Onsite"] }),
    field({ name: "experience_years", label: "Years of Experience", type: "radio", classification: "CUSTOM_QUESTION", required: true, answer: "5+ years", options: ["1-2 years", "3-4 years", "5+ years"] }),
    field({ name: "terms", label: "I accept terms and conditions", type: "checkbox", classification: "TERMS_CONSENT", required: true, resolution: "REVIEW_REQUIRED", answer: null }),
    field({ name: "resume", label: "Attach Resume/CV", type: "file", classification: "RESUME", required: true, answer: "cv.pdf" }),
    field({ name: "cover_letter", label: "Attach Cover Letter", type: "file", classification: "COVER_LETTER", required: false, answer: "cover_letter.pdf" }),
  ];
}

function pageFixture(fields: CompletionField[], extra: Partial<CompletionPage> = {}): CompletionPage {
  return {
    url: "https://job-boards.greenhouse.io/acme/jobs/123",
    platform: "GREENHOUSE",
    title: "Software Engineer Application",
    fields,
    letterSupported: true,
    ...extra,
  };
}

describe("Milestone D Integration & Safety Tests", () => {
  it("executes complete end-to-end application form flow to READY_FOR_SUBMISSION", () => {
    const result = completePreparedForm({
      packageVersion: 1,
      cvId: "cv-v1",
      coverLetterId: "letter-v1",
      page: pageFixture(sampleForm()),
    });

    expect(result.applicationStatus).toBe("READY_FOR_SUBMISSION");
    expect(result.packageVersion).toBe(1);
    expect(result.submitted).toBe(false);
    expect(result.events).toContain("FORM_DISCOVERED");
    expect(result.events).toContain("FIELDS_DETECTED");
    expect(result.events).toContain("FIELDS_CLASSIFIED");
    expect(result.events).toContain("ANSWERS_RESOLVED");
    expect(result.events).toContain("FORM_FILL_STARTED");
    expect(result.events).toContain("DOCUMENT_UPLOADED");
    expect(result.events).toContain("FORM_VALIDATED");
    expect(result.events).not.toContain("SUBMITTED");
    expect(result.runs[0]?.status).toBe("COMPLETED");
    expect(result.runs[0]?.currentStep).toBe("FORM_VALIDATION");
    expect(result.runs[0]?.cvUpload).toBe("UPLOADED");
    expect(result.runs[0]?.coverUpload).toBe("UPLOADED");
  });

  it("handles crash recovery without package version bump or duplicate submission", () => {
    const crashRun = completePreparedForm({
      packageVersion: 3,
      cvId: "cv-v3",
      coverLetterId: "letter-v3",
      page: pageFixture(sampleForm()),
      crashAfterSafeFills: 2,
    });

    expect(crashRun.runs[0]?.errorCode).toBe("BROWSER_CRASH");
    expect(crashRun.packageVersion).toBe(3);
    expect(crashRun.submitted).toBe(false);

    const recovered = resumePreparedForm(
      crashRun,
      pageFixture(sampleForm().map((item, idx) => (idx < 2 ? { ...item, liveValue: item.answer } : item))),
      100_000
    );

    expect(recovered.packageVersion).toBe(3);
    expect(recovered.cvId).toBe("cv-v3");
    expect(recovered.coverLetterId).toBe("letter-v3");
    expect(recovered.applicationStatus).toBe("READY_FOR_SUBMISSION");
    expect(recovered.submitted).toBe(false);
    expect(recovered.runs).toHaveLength(2);
  });

  it("handles rate limit 429 cleanly and resumes on same package", () => {
    const rateLimited = completePreparedForm({
      packageVersion: 2,
      page: pageFixture(sampleForm(), { blocker: "RATE_LIMITED" }),
    });

    expect(rateLimited.applicationStatus).toBe("RATE_LIMITED");
    expect(rateLimited.submitted).toBe(false);
    expect(rateLimited.packageVersion).toBe(2);
    expect(rateLimited.runs[0]?.nextRetryAt).toBeGreaterThan(0);

    const retried = beginAutomation({ ...rateLimited, applicationStatus: "RATE_LIMITED" }, 200_000);
    expect(retried.started).toBe(true);

    const continued = continuePreparedForm(retried.state, retried.runId!, pageFixture(sampleForm()), 200_000);
    expect(continued.applicationStatus).toBe("READY_FOR_SUBMISSION");
    expect(continued.packageVersion).toBe(2);
    expect(continued.submitted).toBe(false);
  });

  it("handles CAPTCHA blocker cleanly without destroying filled progress", () => {
    const captchaRun = completePreparedForm({
      packageVersion: 1,
      page: pageFixture(sampleForm(), { blockerAfterFills: "CAPTCHA_REQUIRED" }),
    });

    expect(captchaRun.applicationStatus).toBe("CAPTCHA_REQUIRED");
    expect(captchaRun.submitted).toBe(false);
    expect(captchaRun.packageVersion).toBe(1);
    expect(captchaRun.fields.some((f) => f.filled)).toBe(true);
    expect(captchaRun.events).toContain("CAPTCHA_DETECTED");
  });

  it("blocks form when an unknown required field cannot be safely resolved", () => {
    const unknownRequired = sampleForm();
    unknownRequired.push(
      field({
        name: "security_clearance_code",
        label: "Security Clearance Level",
        type: "text",
        classification: "UNKNOWN",
        required: true,
        resolution: "REVIEW_REQUIRED",
        answer: null,
      })
    );

    const result = completePreparedForm({
      packageVersion: 1,
      page: pageFixture(unknownRequired),
    });

    expect(result.applicationStatus).toBe("UNKNOWN_REQUIRED_FIELD");
    expect(result.submitted).toBe(false);
    expect(result.packageVersion).toBe(1);
  });

  it("reuses existing document upload when document is already attached", () => {
    const attachedForm = sampleForm().map((item) =>
      item.type === "file" ? { ...item, attachedFile: item.answer } : item
    );

    const result = completePreparedForm({
      packageVersion: 4,
      cvId: "cv-v4",
      page: pageFixture(attachedForm),
    });

    expect(result.applicationStatus).toBe("READY_FOR_SUBMISSION");
    expect(result.packageVersion).toBe(4);
    expect(result.cvId).toBe("cv-v4");
  });
});
