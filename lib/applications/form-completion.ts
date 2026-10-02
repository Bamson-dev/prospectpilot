import {
  beginAutomation,
  crashAutomation,
  createEngineState,
  fieldIdentity,
  recordDiscovery,
  recordFill,
  recordUpload,
  recordValidation,
  resumeAfterCrash,
  stopForBlocker,
  type DetectedField,
  type EngineState,
} from "@/lib/applications/automation-engine";
import type { ApplicationStatus } from "@/lib/applications/types";

export type CompletionField = DetectedField & {
  liveValue?: string | null;
  attachedFile?: string | null;
  checked?: boolean;
  options?: string[];
};

export type CompletionPage = {
  url: string;
  title?: string | null;
  platform: string;
  fields: CompletionField[];
  blocker?: string | null;
  validationErrors?: string[];
  cvValid?: boolean;
  letterValid?: boolean;
  letterSupported?: boolean;
  cvFileName?: string | null;
  letterFileName?: string | null;
  blockerAfterFills?: string | null;
};

const SENSITIVE = /WORK_AUTHORIZATION|SPONSORSHIP|VISA|LEGAL|DEMOGRAPHIC|GENDER|ETHNICITY|VETERAN|DISABILITY|SALARY|YEARS|PRONOUN|AGE/;
const MARKETING = /newsletter|marketing opt|promotional email|product updates/i;

export function matchOption(options: string[], answer: string | null | undefined) {
  const wanted = norm(answer);
  if (!wanted) return null;
  const exact = options.filter((option) => norm(option) === wanted);
  if (exact.length === 1) return exact[0];
  return null;
}

export function textFillPlan(current: string | null | undefined, intended: string | null | undefined) {
  const next = intended?.trim() ?? "";
  if (!next) return "leave" as const;
  if (norm(current) === norm(next)) return "skip" as const;
  return "fill" as const;
}

export function checkboxAction(input: { classification: string; label?: string | null; required?: boolean; checked?: boolean }) {
  const label = input.label ?? "";
  if (MARKETING.test(label) || MARKETING.test(input.classification)) return "leave" as const;
  if (SENSITIVE.test(input.classification)) return "unresolved" as const;
  const consent = input.classification === "TERMS_CONSENT" || input.classification === "PRIVACY_CONSENT" || /agree to the terms|terms and conditions|privacy policy/i.test(label);
  if (consent && input.required) return input.checked ? "skip" as const : "check" as const;
  return "leave" as const;
}

export function uploadDecision(input: { classification: string; attachedFile?: string | null; expectedFile?: string | null; valid: boolean; supported: boolean }) {
  if (input.classification !== "RESUME" && input.classification !== "COVER_LETTER") return "ignore" as const;
  if (!input.supported) return "unsupported" as const;
  if (!input.valid) return "invalid" as const;
  if (input.attachedFile && input.expectedFile && norm(input.attachedFile) === norm(input.expectedFile)) return "skip" as const;
  return "upload" as const;
}

export function fieldNeedsAction(field: CompletionField, documents: { cvFileName?: string | null; letterFileName?: string | null; cvValid: boolean; letterValid: boolean; letterSupported: boolean }) {
  const type = (field.type ?? "").toLowerCase();
  if (type === "checkbox") {
    const action = checkboxAction(field);
    if (action === "leave" && field.required && !field.checked) return "unresolved" as const;
    return action;
  }
  if (type === "file") {
    const cover = field.classification === "COVER_LETTER";
    return uploadDecision({
      classification: cover ? "COVER_LETTER" : "RESUME",
      attachedFile: field.attachedFile,
      expectedFile: cover ? documents.letterFileName : documents.cvFileName,
      valid: cover ? documents.letterValid : documents.cvValid,
      supported: cover ? documents.letterSupported : true,
    });
  }
  if (field.resolution !== "ANSWERED" || !field.answer || SENSITIVE.test(field.classification)) return "unresolved" as const;
  if (type === "select" || type === "radio") return matchOption(field.options ?? [], field.answer) ? "select" as const : "unresolved" as const;
  const plan = textFillPlan(field.liveValue, field.answer);
  if (plan === "leave" && field.required) return "unresolved" as const;
  return plan;
}

export function confirmFill(intended: string, readBack: string) {
  return norm(intended) === norm(readBack);
}

export function visibleValidationProblem(text: string) {
  const sample = text.toLowerCase();
  if (/invalid email|enter a valid email/.test(sample)) return "invalid email";
  if (/invalid phone|enter a valid phone/.test(sample)) return "invalid phone";
  if (/invalid url/.test(sample)) return "invalid url";
  if (/this field is required|please complete this field/.test(sample)) return "required";
  if (/invalid file|file type is not allowed|resume is required|cv is required/.test(sample)) return "missing file";
  return null;
}

export function newRequiredFields(previousKeys: string[], fields: CompletionField[]) {
  return fields.filter((field) => field.required && !previousKeys.includes(fieldIdentity(field)));
}

export function completePreparedForm(input: {
  applicationStatus?: ApplicationStatus;
  packageVersion?: number;
  cvId?: string | null;
  coverLetterId?: string | null;
  page: CompletionPage;
  now?: number;
  crashAfterSafeFills?: number;
  pauseAfterSafeFills?: number;
}) {
  const now = input.now ?? 1_000;
  const state = createEngineState({
    applicationId: "application",
    applicationStatus: input.applicationStatus ?? "APPROVED",
    packageId: "package",
    packageVersion: input.packageVersion ?? 2,
    cvId: input.cvId === undefined ? "cv-current" : input.cvId,
    coverLetterId: input.coverLetterId === undefined ? "letter-current" : input.coverLetterId,
  });
  const begun = beginAutomation(state, now);
  if (!begun.started || !begun.runId) return begun.state;
  return continuePreparedForm(begun.state, begun.runId, input.page, now, input.crashAfterSafeFills, input.pauseAfterSafeFills);
}

export function continuePreparedForm(state: EngineState, runId: string, page: CompletionPage, now: number, crashAfterSafeFills?: number, pauseAfterSafeFills?: number) {
  if (page.blocker) {
    const discovered = page.fields.length
      ? recordDiscovery(state, { runId, url: page.url, title: page.title, platform: page.platform, fields: page.fields, now })
      : state;
    return stopForBlocker(discovered, runId, page.blocker, now + 1);
  }
  let next = recordDiscovery(state, { runId, url: page.url, title: page.title, platform: page.platform, fields: page.fields, now });
  if (next.applicationStatus === "UNKNOWN_REQUIRED_FIELD" || next.runs.at(-1)?.status === "BLOCKED") return next;
  const documents = {
    cvFileName: page.cvFileName ?? "cv.pdf",
    letterFileName: page.letterFileName ?? "letter.pdf",
    cvValid: page.cvValid !== false,
    letterValid: page.letterValid !== false,
    letterSupported: page.letterSupported !== false,
  };
  const previousKeys = state.fields.map((field) => field.fieldKey);
  if (previousKeys.length && newRequiredFields(previousKeys, page.fields).some((field) => field.resolution !== "ANSWERED" || SENSITIVE.test(field.classification))) {
    return stopForBlocker(next, runId, "UNKNOWN_REQUIRED_FIELD", now + 1);
  }
  const actions = page.fields.map((field) => ({ field, action: fieldNeedsAction(field, documents), key: fieldIdentity(field) }));
  if (actions.some((item) => item.field.required && (item.action === "unresolved" || item.action === "invalid"))) {
    const code = actions.some((item) => item.action === "invalid") ? "DOCUMENT_VALIDATION_FAILED" : "UNKNOWN_REQUIRED_FIELD";
    return stopForBlocker(next, runId, code, now + 2);
  }
  next = {
    ...next,
    fields: next.fields.map((field) => {
      const action = actions.find((item) => item.key === field.fieldKey)?.action;
      if (action !== "check") return field;
      return { ...field, resolution: "RESOLVED" as const, answer: "accepted application terms", answerSource: "application-consent" };
    }),
  };
  const toFill = actions.filter((item) => item.action === "fill" || item.action === "select" || item.action === "check" || item.action === "upload").map((item) => item.key);
  const already = actions.filter((item) => item.action === "skip").map((item) => item.key);
  const limit = crashAfterSafeFills ?? pauseAfterSafeFills;
  const limited = limit == null ? toFill : toFill.slice(0, limit);
  next = recordFill(next, { runId, fieldKeys: [...limited, ...already], liveFilled: already, now: now + 3 });
  if (pauseAfterSafeFills != null && pauseAfterSafeFills < toFill.length) return next;
  if (crashAfterSafeFills != null && crashAfterSafeFills < toFill.length) return crashAutomation(next, runId, now + 4);
  if (page.blockerAfterFills) return stopForBlocker(next, runId, page.blockerAfterFills, now + 4);
  const uploadCv = actions.some((item) => (item.field.type ?? "").toLowerCase() === "file" && item.field.classification !== "COVER_LETTER" && (item.action === "upload" || item.action === "skip"));
  const uploadLetter = actions.some((item) => (item.field.type ?? "").toLowerCase() === "file" && item.field.classification === "COVER_LETTER" && (item.action === "upload" || item.action === "skip"));
  if (uploadCv || uploadLetter) next = recordUpload(next, { runId, cv: uploadCv, letter: uploadLetter, now: now + 5 });
  const problem = (page.validationErrors ?? []).map(visibleValidationProblem).find(Boolean) ?? null;
  if (problem) return stopForBlocker(next, runId, "FORM_VALIDATION_FAILED", now + 6);
  return recordValidation(next, { runId, now: now + 6 });
}

export function resumePreparedForm(state: EngineState, page: CompletionPage, now: number) {
  const resumed = resumeAfterCrash(state, now);
  if (!resumed.started || !resumed.runId) return resumed.state;
  return continuePreparedForm(resumed.state, resumed.runId, page, now + 1);
}

function norm(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
