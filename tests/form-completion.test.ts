import { describe, expect, it } from "vitest";
import { beginAutomation, packageVersionAfter } from "@/lib/applications/automation-engine";
import { fieldsFromHtml, inspectFields, mapCandidateToFields } from "@/lib/applications/form-map";
import {
  checkboxAction,
  completePreparedForm,
  confirmFill,
  continuePreparedForm,
  matchOption,
  resumePreparedForm,
  textFillPlan,
  type CompletionField,
  type CompletionPage,
} from "@/lib/applications/form-completion";
import { detectPlatform } from "@/lib/applications/platforms";

const values = { firstName: "Bamidele", lastName: "Matthew", email: "person@example.com", phone: "+15551212", linkedin: "https://www.linkedin.com/in/example" };

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

function page(fields: CompletionField[], extra: Partial<CompletionPage> = {}): CompletionPage {
  return {
    url: extra.url ?? "https://job-boards.greenhouse.io/example/jobs/1",
    platform: extra.platform ?? "GREENHOUSE",
    title: "Application",
    fields,
    ...extra,
  };
}

function safeFields(): CompletionField[] {
  return [
    field({ name: "first_name", label: "First name", classification: "FULL_NAME", required: true, answer: "Bamidele" }),
    field({ name: "email", label: "Email", type: "email", classification: "EMAIL", required: true, answer: "person@example.com" }),
    field({ name: "resume", label: "Resume", type: "file", classification: "RESUME", required: true, answer: "cv.pdf" }),
  ];
}

describe("form completion", () => {
  it("discovers the form and stores the checkpoint", () => {
    const result = completePreparedForm({ page: page(safeFields()) });
    const run = result.runs.at(-1);
    expect(run?.currentUrl).toContain("greenhouse.io");
    expect(result.fields).toHaveLength(3);
    expect(run?.currentStep).toBe("FORM_VALIDATION");
    expect(result.sessions).toBe(1);
    expect(result.submitted).toBe(false);
  });

  it("persists classification, confidence, and required state", () => {
    const result = completePreparedForm({ page: page(safeFields()) });
    const email = result.fields.find((item) => item.name === "email");
    expect(email?.classification).toBe("EMAIL");
    expect(email?.confidence).toBe(0.95);
    expect(email?.required).toBe(true);
    expect(email?.validated).toBe(true);
  });

  it("resolves verified contact data and leaves sensitive data unanswered", () => {
    const result = completePreparedForm({
      page: page([
        field({ name: "email", label: "Email", classification: "EMAIL", required: true, answer: "person@example.com" }),
        field({ name: "sponsorship", label: "Do you need sponsorship?", classification: "SPONSORSHIP", required: true, answer: "No", resolution: "ANSWERED" }),
      ]),
    });
    const sponsorship = result.fields.find((item) => item.name === "sponsorship");
    expect(result.fields.find((item) => item.name === "email")?.answer).toBe("person@example.com");
    expect(sponsorship?.answer).toBeNull();
    expect(sponsorship?.resolution).toBe("UNRESOLVED");
    expect(result.applicationStatus).toBe("UNKNOWN_REQUIRED_FIELD");
    expect(result.submitted).toBe(false);
  });

  it("fills text, skips a correct value, and detects a failed confirmation", () => {
    expect(textFillPlan("", "Bamidele")).toBe("fill");
    expect(textFillPlan("Bamidele", "Bamidele")).toBe("skip");
    expect(confirmFill("Bamidele", "Someone else")).toBe(false);
    const result = completePreparedForm({
      page: page([
        field({ name: "first_name", classification: "FULL_NAME", required: true, answer: "Bamidele", liveValue: "Bamidele" }),
        field({ name: "email", type: "email", classification: "EMAIL", required: true, answer: "person@example.com" }),
      ]),
    });
    expect(result.fields.every((item) => item.filled)).toBe(true);
    expect(result.applicationStatus).toBe("READY_FOR_SUBMISSION");
  });

  it("selects an exact option and refuses an ambiguous one", () => {
    expect(matchOption(["Yes", "No"], "yes")).toBe("Yes");
    expect(matchOption(["Senior Engineer", "Staff Engineer"], "Engineer")).toBeNull();
    const selected = completePreparedForm({
      page: page([field({ name: "work_setting", type: "select", classification: "CUSTOM_QUESTION", required: true, answer: "Remote", options: ["Remote", "Hybrid"] })]),
    });
    expect(selected.fields[0]?.filled).toBe(true);
    const ambiguous = completePreparedForm({
      page: page([field({ name: "title", type: "select", classification: "CUSTOM_QUESTION", required: true, answer: "Engineer", options: ["Senior Engineer", "Staff Engineer"] })]),
    });
    expect(ambiguous.applicationStatus).toBe("UNKNOWN_REQUIRED_FIELD");
    expect(ambiguous.fields[0]?.filled).toBe(false);
  });

  it("selects a supported radio answer and refuses an unsupported one", () => {
    const selected = completePreparedForm({
      page: page([field({ name: "office", type: "radio", classification: "CUSTOM_QUESTION", required: true, answer: "London", options: ["London", "Berlin"] })]),
    });
    expect(selected.fields[0]?.filled).toBe(true);
    const refused = completePreparedForm({
      page: page([field({ name: "clearance", type: "radio", classification: "CUSTOM_QUESTION", required: true, resolution: "REVIEW_REQUIRED", answer: null, options: ["Secret", "None"] })]),
    });
    expect(refused.applicationStatus).toBe("UNKNOWN_REQUIRED_FIELD");
    expect(refused.fields[0]?.answer).toBeNull();
  });

  it("checks required terms and leaves marketing opt-in alone", () => {
    expect(checkboxAction({ classification: "TERMS_CONSENT", label: "I agree to the terms", required: true })).toBe("check");
    expect(checkboxAction({ classification: "CUSTOM_QUESTION", label: "Email me product updates", required: false })).toBe("leave");
    const result = completePreparedForm({
      page: page([
        field({ name: "email", type: "email", classification: "EMAIL", required: true, answer: "person@example.com" }),
        field({ name: "terms", type: "checkbox", classification: "TERMS_CONSENT", required: true, resolution: "REVIEW_REQUIRED", answer: null }),
        field({ name: "marketing", type: "checkbox", classification: "CUSTOM_QUESTION", label: "Email me product updates", required: false, resolution: "REVIEW_REQUIRED", answer: null }),
      ]),
    });
    expect(result.fields.find((item) => item.name === "terms")?.filled).toBe(true);
    expect(result.fields.find((item) => item.name === "marketing")?.filled).toBe(false);
    expect(result.applicationStatus).toBe("READY_FOR_SUBMISSION");
  });

  it("uses a verified custom answer and rejects an unsupported claim", () => {
    const answered = completePreparedForm({
      page: page([field({ name: "project", type: "textarea", classification: "CUSTOM_QUESTION", required: true, answer: "I built ProspectPilot with TypeScript.", answerSource: "verified-project" })]),
    });
    expect(answered.fields[0]?.answer).toContain("ProspectPilot");
    expect(answered.applicationStatus).toBe("READY_FOR_SUBMISSION");
    const unsupported = completePreparedForm({
      page: page([field({ name: "years", label: "Years in a formal director role", type: "textarea", classification: "CUSTOM_QUESTION", required: true, resolution: "REVIEW_REQUIRED", answer: null })]),
    });
    expect(unsupported.fields[0]?.answer).toBeNull();
    expect(unsupported.applicationStatus).toBe("UNKNOWN_REQUIRED_FIELD");
  });

  it("uploads the current CV and cover letter without a new package version", () => {
    const result = completePreparedForm({
      packageVersion: 2,
      cvId: "cv-v2",
      coverLetterId: "letter-v2",
      page: page([
        field({ name: "email", type: "email", classification: "EMAIL", required: true, answer: "person@example.com" }),
        field({ name: "resume", type: "file", classification: "RESUME", required: true, answer: "cv.pdf" }),
        field({ name: "cover", type: "file", classification: "COVER_LETTER", required: false, answer: "letter.pdf" }),
      ], { letterSupported: true }),
    });
    expect(result.packageVersion).toBe(2);
    expect(result.cvId).toBe("cv-v2");
    expect(result.coverLetterId).toBe("letter-v2");
    expect(result.runs[0]?.cvUpload).toBe("UPLOADED");
    expect(result.runs[0]?.coverUpload).toBe("UPLOADED");
    expect(result.applicationStatus).toBe("READY_FOR_SUBMISSION");
    const reused = completePreparedForm({
      packageVersion: 2,
      cvId: "cv-v2",
      page: page([
        field({ name: "email", type: "email", classification: "EMAIL", required: true, answer: "person@example.com" }),
        field({ name: "resume", type: "file", classification: "RESUME", required: true, answer: "cv.pdf", attachedFile: "cv.pdf" }),
      ]),
    });
    expect(reused.packageVersion).toBe(2);
    expect(reused.cvId).toBe("cv-v2");
    expect(reused.runs).toHaveLength(1);
  });

  it("blocks an invalid document and a validation error", () => {
    const invalid = completePreparedForm({
      packageVersion: 2,
      page: page([
        field({ name: "email", type: "email", classification: "EMAIL", required: true, answer: "person@example.com" }),
        field({ name: "resume", type: "file", classification: "RESUME", required: true, answer: "cv.pdf" }),
      ], { cvValid: false }),
    });
    expect(invalid.runs.at(-1)?.errorCode).toBe("DOCUMENT_VALIDATION_FAILED");
    expect(invalid.packageVersion).toBe(2);
    expect(invalid.applicationStatus).not.toBe("READY_FOR_SUBMISSION");
    const validation = completePreparedForm({
      page: page(safeFields(), { validationErrors: ["Enter a valid email"] }),
    });
    expect(validation.runs.at(-1)?.errorCode).toBe("FORM_VALIDATION_FAILED");
    expect(validation.submitted).toBe(false);
    expect(["SUBMITTING", "SUBMITTED", "VERIFIED"]).not.toContain(validation.applicationStatus);
  });

  it("reaches ready only when required fields and the CV are valid", () => {
    const result = completePreparedForm({ page: page(safeFields()) });
    expect(result.applicationStatus).toBe("READY_FOR_SUBMISSION");
    expect(result.submitted).toBe(false);
    expect(result.events).not.toContain("SUBMITTED");
    const missing = completePreparedForm({
      page: page([field({ name: "email", type: "email", classification: "EMAIL", required: true, resolution: "REVIEW_REQUIRED", answer: null })]),
    });
    expect(missing.applicationStatus).toBe("UNKNOWN_REQUIRED_FIELD");
  });

  it("keeps captcha, rate limit, login, auth, cloudflare, and a missing form as blockers", () => {
    for (const blocker of ["CAPTCHA_REQUIRED", "LOGIN_REQUIRED", "AUTH_REQUIRED", "CLOUDFLARE_CHALLENGE", "FORM_NOT_FOUND"]) {
      const result = completePreparedForm({ page: page(blocker === "FORM_NOT_FOUND" ? [] : safeFields(), { blocker }) });
      expect(result.applicationStatus).toBe(blocker);
      expect(result.submitted).toBe(false);
      expect(result.packageVersion).toBe(2);
    }
    const limited = completePreparedForm({ page: page(safeFields(), { blocker: "RATE_LIMITED" }) });
    expect(limited.applicationStatus).toBe("RATE_LIMITED");
    expect(limited.runs[0]?.nextRetryAt).toBeTruthy();
    expect(limited.packageVersion).toBe(packageVersionAfter(2, "rate-limit"));
    const retried = beginAutomation({ ...limited, applicationStatus: "RATE_LIMITED" }, 80_000);
    expect(retried.started).toBe(true);
    const continued = continuePreparedForm(retried.state, retried.runId!, page(safeFields()), 80_000);
    expect(continued.packageVersion).toBe(2);
    expect(continued.cvId).toBe("cv-current");
    expect(continued.applicationStatus).toBe("READY_FOR_SUBMISSION");
  });

  it("preserves progress when captcha appears after fields are filled", () => {
    const result = completePreparedForm({ page: page(safeFields(), { blockerAfterFills: "CAPTCHA_REQUIRED" }) });
    expect(result.applicationStatus).toBe("CAPTCHA_REQUIRED");
    expect(result.fields.filter((item) => item.filled).length).toBeGreaterThan(0);
    expect(result.runs[0]?.currentUrl).toContain("greenhouse.io");
    expect(result.sessions).toBe(1);
    expect(result.submitted).toBe(false);
    expect(result.packageVersion).toBe(2);
  });

  it("resumes a crashed browser and a dead worker on the same package", () => {
    const crashed = completePreparedForm({ packageVersion: 2, cvId: "cv-v2", coverLetterId: "letter-v2", page: page(safeFields()), crashAfterSafeFills: 1 });
    expect(crashed.runs[0]?.errorCode).toBe("BROWSER_CRASH");
    expect(crashed.packageVersion).toBe(2);
    expect(crashed.fields.filter((item) => item.filled)).toHaveLength(1);
    const recovered = resumePreparedForm(crashed, page(safeFields().map((item, index) => index === 0 ? { ...item, liveValue: item.answer } : item)), 200_000);
    expect(recovered.applicationId).toBe("application");
    expect(recovered.packageId).toBe("package");
    expect(recovered.packageVersion).toBe(2);
    expect(recovered.cvId).toBe("cv-v2");
    expect(recovered.coverLetterId).toBe("letter-v2");
    expect(recovered.runs).toHaveLength(2);
    expect(recovered.applicationStatus).toBe("READY_FOR_SUBMISSION");
    expect(recovered.submitted).toBe(false);
    const paused = completePreparedForm({ packageVersion: 2, cvId: "cv-v2", page: page(safeFields()), pauseAfterSafeFills: 1 });
    const restarted = resumePreparedForm(paused, page(safeFields().map((item, index) => index === 0 ? { ...item, liveValue: item.answer } : item)), paused.runs[0]!.heartbeatAt + 180_000);
    expect(restarted.packageVersion).toBe(2);
    expect(restarted.cvId).toBe("cv-v2");
    expect(restarted.applicationStatus).toBe("READY_FOR_SUBMISSION");
    expect(restarted.submitted).toBe(false);
  });

  it("treats a newly appeared required field as unresolved", () => {
    const done = completePreparedForm({ page: page(safeFields()) });
    const started = beginAutomation(done, 50_000);
    const extra = field({ name: "visa", label: "Visa status", classification: "UNKNOWN", required: true, resolution: "REVIEW_REQUIRED", answer: null, confidence: 0.2 });
    const changed = continuePreparedForm(started.state, started.runId!, page([...safeFields(), extra]), 50_000);
    expect(changed.applicationStatus).toBe("UNKNOWN_REQUIRED_FIELD");
    expect(changed.packageVersion).toBe(2);
    expect(changed.submitted).toBe(false);
  });

  it("does not start automation for a legacy manual application", () => {
    const result = completePreparedForm({ applicationStatus: "REQUIRES_MANUAL_ACTION", page: page(safeFields()) });
    expect(result.applicationStatus).toBe("REQUIRES_MANUAL_ACTION");
    expect(result.runs).toHaveLength(0);
    expect(result.packageVersion).toBe(2);
  });

  it("runs the greenhouse and lever fixtures through discovery and ready", () => {
    for (const url of ["https://job-boards.greenhouse.io/gitlab/jobs/1", "https://jobs.lever.co/spotify/abc/apply"]) {
      const html = `<form><label for="first_name">First name</label><input id="first_name" name="first_name" required><label for="email">Email</label><input id="email" name="email" type="email" required><label for="resume">Resume</label><input id="resume" name="resume" type="file" required></form>`;
      const inspected = inspectFields(fieldsFromHtml(html));
      const mapped = mapCandidateToFields(inspected, values);
      const fields = inspected.map((item, index) => field({
        label: item.label,
        name: item.name,
        id: item.id,
        type: item.type,
        required: item.required,
        classification: mapped[index]?.taxonomy ?? item.taxonomy,
        confidence: mapped[index]?.confidence ?? item.confidence,
        answer: item.type === "file" ? "cv.pdf" : mapped[index]?.value,
        resolution: item.type === "file" ? "ANSWERED" : mapped[index]?.status,
        options: item.options,
      }));
      const result = completePreparedForm({ page: page(fields, { url, platform: detectPlatform({ url }) }) });
      expect(detectPlatform({ url })).toMatch(/GREENHOUSE|LEVER/);
      expect(result.fields.length).toBeGreaterThan(0);
      expect(result.runs.at(-1)?.currentUrl).toBe(url);
      expect(result.applicationStatus).toBe("READY_FOR_SUBMISSION");
      expect(result.submitted).toBe(false);
      expect(result.packageVersion).toBe(2);
    }
  });
});
