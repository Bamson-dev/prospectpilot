import { canTransition, isRetryableState, statusAfterBlock } from "@/lib/applications/state";
import type { ApplicationStatus } from "@/lib/applications/types";
import { nextPackageVersion } from "@/lib/applications/package-version";

export const CHECKPOINTS = [
  "BROWSER_STARTED",
  "FORM_DISCOVERY",
  "FIELD_CLASSIFICATION",
  "ANSWER_RESOLUTION",
  "FORM_FILLING",
  "DOCUMENT_UPLOAD",
  "FORM_VALIDATION",
] as const;

export type Checkpoint = (typeof CHECKPOINTS)[number];

export type RunExecutionStatus = "QUEUED" | "RUNNING" | "PAUSED" | "WAITING" | "COMPLETED" | "FAILED" | "BLOCKED";

export type FieldProgress = "DETECTED" | "CLASSIFIED" | "RESOLVED" | "UNRESOLVED" | "FILLED" | "VALIDATED" | "FAILED";

export type UploadProgress = "NOT_STARTED" | "UPLOADING" | "UPLOADED" | "VALIDATED" | "FAILED";

export type DetectedField = {
  label?: string | null;
  name?: string | null;
  id?: string | null;
  type?: string | null;
  required?: boolean;
  autocomplete?: string | null;
  nearby?: string | null;
  classification: string;
  confidence: number;
  answer?: string | null;
  answerSource?: string | null;
  resolution?: "ANSWERED" | "REVIEW_REQUIRED" | "UNSUPPORTED";
};

export type StoredField = {
  fieldKey: string;
  label: string;
  name: string;
  elementId: string;
  fieldType: string;
  required: boolean;
  classification: string;
  confidence: number;
  answer: string | null;
  answerSource: string | null;
  resolution: FieldProgress;
  filled: boolean;
  validated: boolean;
};

export type AutomationRunRecord = {
  id: string;
  applicationId: string;
  packageId: string;
  packageVersion: number;
  status: RunExecutionStatus;
  attempt: number;
  currentStep: Checkpoint;
  currentUrl: string | null;
  idempotencyKey: string;
  heartbeatAt: number;
  blocker: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  nextRetryAt: number | null;
  cvUpload: UploadProgress;
  coverUpload: UploadProgress;
  cvId: string | null;
  coverLetterId: string | null;
};

export type AutomationLock = { runId: string; acquiredAt: number; heartbeatAt: number };

export type EngineState = {
  applicationId: string;
  applicationStatus: ApplicationStatus;
  packageId: string;
  packageVersion: number;
  cvId: string | null;
  coverLetterId: string | null;
  submitted: boolean;
  runs: AutomationRunRecord[];
  fields: StoredField[];
  events: string[];
  lock: AutomationLock | null;
  sessions: number;
};

const PERMANENT = new Set(["CAPTCHA_REQUIRED", "UNKNOWN_REQUIRED_FIELD", "LOGIN_REQUIRED", "AUTH_REQUIRED", "CLOUDFLARE_CHALLENGE", "FORM_NOT_FOUND", "SOURCE_INVALID"]);
const TRANSIENT = new Set(["RATE_LIMITED", "HTTP_429", "BROWSER_CRASH", "BROWSER_TIMEOUT", "PAGE_LOAD_TIMEOUT", "EMPLOYER_SERVER_ERROR", "NETWORK"]);

export function automationStaleMs() {
  return 120_000;
}

export function fieldIdentity(field: { name?: string | null; id?: string | null; label?: string | null; autocomplete?: string | null; type?: string | null; nearby?: string | null }) {
  const name = norm(field.name);
  const id = norm(field.id);
  const label = norm(field.label);
  const autocomplete = norm(field.autocomplete);
  const type = norm(field.type);
  const nearby = norm(field.nearby).slice(0, 80);
  if (name || id) return [name, id, label, autocomplete, type].filter(Boolean).join("|");
  return `semantic:${[label, autocomplete, type, nearby].filter(Boolean).join("|")}`;
}

export function persistDetectedField(field: DetectedField): StoredField {
  const answered = field.resolution === "ANSWERED" && Boolean(field.answer?.trim());
  const sensitive = /WORK_AUTHORIZATION|SPONSORSHIP|VISA|LEGAL|DEMOGRAPHIC|GENDER|ETHNICITY|VETERAN|DISABILITY|SALARY|YEARS/i.test(field.classification);
  return {
    fieldKey: fieldIdentity(field),
    label: clip(field.label),
    name: clip(field.name),
    elementId: clip(field.id),
    fieldType: clip(field.type).toLowerCase(),
    required: Boolean(field.required),
    classification: field.classification,
    confidence: field.confidence,
    answer: answered && !sensitive ? field.answer?.trim() ?? null : null,
    answerSource: answered && !sensitive ? field.answerSource ?? null : null,
    resolution: answered && !sensitive ? "RESOLVED" : "UNRESOLVED",
    filled: false,
    validated: false,
  };
}

export function packageVersionAfter(current: number, reason: "content-change" | "browser-crash" | "rate-limit" | "captcha" | "timeout" | "retry" | "worker-crash") {
  if (reason === "content-change") return nextPackageVersion(current);
  return current;
}

export function admitRun(input: { active: Pick<AutomationRunRecord, "id" | "status" | "heartbeatAt"> | null; now: number; staleMs?: number }) {
  const staleMs = input.staleMs ?? automationStaleMs();
  if (!input.active) return { action: "start" as const };
  const live = input.active.status === "QUEUED" || input.active.status === "RUNNING";
  if (live && input.now - input.active.heartbeatAt < staleMs) return { action: "reuse" as const, runId: input.active.id };
  if (live) return { action: "recover" as const, runId: input.active.id };
  return { action: "start" as const };
}

export function acquireAutomationLock(lock: AutomationLock | null, runId: string, now: number, staleMs = automationStaleMs()) {
  if (lock && lock.runId !== runId && now - lock.heartbeatAt < staleMs) return { ok: false as const, lock };
  return { ok: true as const, lock: { runId, acquiredAt: lock?.runId === runId ? lock.acquiredAt : now, heartbeatAt: now } };
}

export function releaseAutomationLock(lock: AutomationLock | null, runId: string) {
  if (lock?.runId !== runId) return lock;
  return null;
}

export function retryPlan(input: { code: string; attempt: number; maxAttempts?: number; now: number; retryAfterMs?: number | null }) {
  const maxAttempts = input.maxAttempts ?? 3;
  if (PERMANENT.has(input.code) || !TRANSIENT.has(input.code) || input.attempt >= maxAttempts) {
    return { retry: false as const, status: PERMANENT.has(input.code) ? "BLOCKED" as const : "FAILED" as const, nextRetryAt: null as number | null };
  }
  const base = input.retryAfterMs && input.retryAfterMs > 0
    ? input.retryAfterMs
    : input.code === "RATE_LIMITED" || input.code === "HTTP_429" ? 60_000 : 15_000;
  const delay = Math.min(base * 2 ** Math.max(0, input.attempt - 1), 15 * 60_000);
  const jitter = (input.attempt * 997) % 5_000;
  return { retry: true as const, status: "WAITING" as const, nextRetryAt: input.now + delay + jitter };
}

export function nextCheckpoint(current: Checkpoint | null): Checkpoint {
  if (!current) return "BROWSER_STARTED";
  const index = CHECKPOINTS.indexOf(current);
  return CHECKPOINTS[Math.min(index + 1, CHECKPOINTS.length - 1)];
}

export function idempotencyKey(applicationId: string, packageId: string, attempt: number) {
  return `${applicationId}:${packageId}:${attempt}`;
}

export function inspectionIdempotencyKey(applicationId: string, packageId: string, packageVersion: number) {
  return `inspect:${applicationId}:${packageId}:${packageVersion}`;
}

export function legacyAutomationHold(status: ApplicationStatus) {
  return status === "REQUIRES_MANUAL_ACTION" || status === "SUBMITTED" || status === "SUBMITTING" || status === "VERIFIED" || status === "REJECTED" || status === "WITHDRAWN";
}

export function createEngineState(input: {
  applicationId: string;
  applicationStatus: ApplicationStatus;
  packageId: string;
  packageVersion: number;
  cvId?: string | null;
  coverLetterId?: string | null;
}): EngineState {
  return {
    applicationId: input.applicationId,
    applicationStatus: input.applicationStatus,
    packageId: input.packageId,
    packageVersion: input.packageVersion,
    cvId: input.cvId ?? null,
    coverLetterId: input.coverLetterId ?? null,
    submitted: false,
    runs: [],
    fields: [],
    events: [],
    lock: null,
    sessions: 0,
  };
}

export function activeRun(state: EngineState) {
  return state.runs.find((run) => run.status === "QUEUED" || run.status === "RUNNING") ?? null;
}

export function beginAutomation(state: EngineState, now: number) {
  if (legacyAutomationHold(state.applicationStatus)) return { state, started: false as const, reason: "legacy-or-closed" };
  const decision = admitRun({ active: activeRun(state), now });
  if (decision.action === "reuse") return { state, started: false as const, reason: "active-run", runId: decision.runId };
  let next = state;
  if (decision.action === "recover" && decision.runId) {
    next = markRun(state, decision.runId, { status: "FAILED", errorCode: "STALE", errorMessage: "Automation heartbeat expired." });
    next = { ...next, events: [...next.events, "AUTOMATION_FAILED"] };
  }
  const attempt = next.runs.reduce((max, run) => Math.max(max, run.attempt), 0) + 1;
  const previous = [...next.runs].reverse().find((run) => run.packageId === next.packageId);
  const run: AutomationRunRecord = {
    id: `run-${attempt}`,
    applicationId: next.applicationId,
    packageId: next.packageId,
    packageVersion: next.packageVersion,
    status: "RUNNING",
    attempt,
    currentStep: previous?.currentStep ?? "BROWSER_STARTED",
    currentUrl: previous?.currentUrl ?? null,
    idempotencyKey: idempotencyKey(next.applicationId, next.packageId, attempt),
    heartbeatAt: now,
    blocker: null,
    errorCode: null,
    errorMessage: null,
    nextRetryAt: null,
    cvUpload: previous?.cvUpload === "UPLOADED" || previous?.cvUpload === "VALIDATED" ? previous.cvUpload : "NOT_STARTED",
    coverUpload: previous?.coverUpload === "UPLOADED" || previous?.coverUpload === "VALIDATED" ? previous.coverUpload : "NOT_STARTED",
    cvId: next.cvId,
    coverLetterId: next.coverLetterId,
  };
  const lock = acquireAutomationLock(next.lock, run.id, now);
  if (!lock.ok) return { state: next, started: false as const, reason: "locked" };
  return {
    state: {
      ...next,
      runs: [...next.runs, run],
      lock: lock.lock,
      sessions: next.sessions + 1,
      events: [...next.events, previous ? "AUTOMATION_RESUMED" : "AUTOMATION_STARTED"],
    },
    started: true as const,
    runId: run.id,
  };
}

export function recordDiscovery(state: EngineState, input: { runId: string; url: string; title?: string | null; platform: string; fields: DetectedField[]; now: number }) {
  const fields = input.fields.map(persistDetectedField);
  const unresolvedRequired = fields.some((field) => field.required && field.resolution === "UNRESOLVED" && field.classification === "UNKNOWN");
  let next = replaceFields(state, fields);
  next = markRun(next, input.runId, { currentStep: "FIELD_CLASSIFICATION", currentUrl: input.url, heartbeatAt: input.now });
  next = { ...next, events: [...next.events, "FORM_DISCOVERED", "FIELDS_DETECTED", "FIELDS_CLASSIFIED", "ANSWERS_RESOLVED"], sessions: next.sessions };
  if (unresolvedRequired) return stopForBlocker(next, input.runId, "UNKNOWN_REQUIRED_FIELD", input.now);
  return next;
}

export function recordFill(state: EngineState, input: { runId: string; fieldKeys: string[]; liveFilled?: string[]; now: number }) {
  const live = new Set(input.liveFilled ?? []);
  const fields = state.fields.map((field) => {
    if (!input.fieldKeys.includes(field.fieldKey) || field.resolution === "UNRESOLVED") return field;
    if (live.size > 0 && live.has(field.fieldKey)) return { ...field, resolution: "FILLED" as const, filled: true };
    return { ...field, resolution: "FILLED" as const, filled: true };
  });
  const next = markRun({ ...state, fields }, input.runId, { currentStep: "FORM_FILLING", heartbeatAt: input.now });
  return { ...next, events: next.events.includes("FORM_FILL_STARTED") ? next.events : [...next.events, "FORM_FILL_STARTED"] };
}

export function recordUpload(state: EngineState, input: { runId: string; cv: boolean; letter: boolean; now: number }) {
  const run = state.runs.find((item) => item.id === input.runId);
  const cvUpload: UploadProgress = !state.cvId ? "NOT_STARTED" : run?.cvUpload === "UPLOADED" || run?.cvUpload === "VALIDATED" ? run.cvUpload : input.cv ? "UPLOADED" : "NOT_STARTED";
  const coverUpload: UploadProgress = !state.coverLetterId ? "NOT_STARTED" : run?.coverUpload === "UPLOADED" || run?.coverUpload === "VALIDATED" ? run.coverUpload : input.letter ? "UPLOADED" : "NOT_STARTED";
  const next = markRun(state, input.runId, { currentStep: "DOCUMENT_UPLOAD", heartbeatAt: input.now, cvUpload, coverUpload });
  return { ...next, events: next.events.includes("DOCUMENT_UPLOADED") ? next.events : [...next.events, "DOCUMENT_UPLOADED"] };
}

export function recordValidation(state: EngineState, input: { runId: string; now: number; blocker?: string | null }) {
  if (input.blocker) return stopForBlocker(state, input.runId, input.blocker, input.now);
  const fields = state.fields.map((field) => field.filled || field.resolution === "RESOLVED" ? { ...field, resolution: "VALIDATED" as const, validated: true } : field);
  if (fields.some((field) => field.required && field.resolution === "UNRESOLVED" && field.classification === "UNKNOWN")) {
    return stopForBlocker({ ...state, fields }, input.runId, "UNKNOWN_REQUIRED_FIELD", input.now);
  }
  if (fields.some((field) => field.required && field.resolution === "UNRESOLVED")) {
    const paused = markRun({ ...state, fields }, input.runId, { status: "BLOCKED", blocker: "REVIEW_REQUIRED", heartbeatAt: input.now, completed: true });
    return { ...paused, submitted: false, lock: releaseAutomationLock(paused.lock, input.runId), events: [...paused.events, "FORM_VALIDATED"] };
  }
  let next = markRun({ ...state, fields }, input.runId, { status: "COMPLETED", currentStep: "FORM_VALIDATION", heartbeatAt: input.now, completed: true });
  const status = canTransition(next.applicationStatus, "READY_FOR_SUBMISSION") ? "READY_FOR_SUBMISSION" : next.applicationStatus;
  next = { ...next, applicationStatus: status, events: [...next.events, "FORM_VALIDATED"], lock: releaseAutomationLock(next.lock, input.runId), submitted: false };
  return next;
}

export function stopForBlocker(state: EngineState, runId: string, code: string, now: number, retryAfterMs?: number | null) {
  const mapped = statusAfterBlock(code);
  const plan = retryPlan({ code: mapped === "REQUIRES_MANUAL_ACTION" ? code : mapped, attempt: state.runs.find((run) => run.id === runId)?.attempt ?? 1, now, retryAfterMs });
  const applicationStatus = canTransition(state.applicationStatus, mapped) ? mapped : state.applicationStatus;
  const next = markRun(state, runId, {
    status: plan.status,
    blocker: mapped,
    errorCode: mapped === "REQUIRES_MANUAL_ACTION" ? code : mapped,
    currentStep: state.runs.find((run) => run.id === runId)?.currentStep ?? "FORM_DISCOVERY",
    heartbeatAt: now,
    nextRetryAt: plan.nextRetryAt,
    completed: true,
  });
  const event = mapped === "CAPTCHA_REQUIRED" ? "CAPTCHA_DETECTED" : mapped === "RATE_LIMITED" ? "RATE_LIMITED" : "AUTOMATION_FAILED";
  return {
    ...next,
    applicationStatus,
    submitted: false,
    lock: releaseAutomationLock(next.lock, runId),
    events: [...next.events, event, ...(plan.retry ? ["AUTOMATION_RETRY_SCHEDULED"] : [])],
  };
}

export function crashAutomation(state: EngineState, runId: string, now: number) {
  const plan = retryPlan({ code: "BROWSER_CRASH", attempt: state.runs.find((run) => run.id === runId)?.attempt ?? 1, now });
  const next = markRun(state, runId, {
    status: plan.status === "WAITING" ? "FAILED" : "FAILED",
    errorCode: "BROWSER_CRASH",
    errorMessage: "Browser crashed before the checkpoint completed.",
    heartbeatAt: now,
    nextRetryAt: plan.nextRetryAt,
    completed: true,
  });
  return {
    ...next,
    packageVersion: packageVersionAfter(next.packageVersion, "browser-crash"),
    submitted: false,
    lock: releaseAutomationLock(next.lock, runId),
    events: [...next.events, "AUTOMATION_FAILED", ...(plan.retry ? ["AUTOMATION_RETRY_SCHEDULED"] : [])],
  };
}

export function resumeAfterCrash(state: EngineState, now: number) {
  const stale = state.runs.find((run) => (run.status === "RUNNING" || run.status === "QUEUED") && now - run.heartbeatAt >= automationStaleMs());
  const failed = stale ? markRun(state, stale.id, { status: "FAILED", errorCode: "STALE", errorMessage: "Worker heartbeat expired." }) : state;
  return beginAutomation({ ...failed, packageVersion: packageVersionAfter(failed.packageVersion, "worker-crash") }, now);
}

export function fillRemaining(state: EngineState, liveFilled: string[]) {
  return state.fields.filter((field) => field.resolution === "RESOLVED" && !field.filled && !liveFilled.includes(field.fieldKey)).map((field) => field.fieldKey);
}

export function blockerIsPermanent(code: string) {
  return PERMANENT.has(code) || (!TRANSIENT.has(code) && !isRetryableState(code === "HTTP_429" ? "RATE_LIMITED" : code as ApplicationStatus));
}

function markRun(state: EngineState, runId: string, patch: Partial<AutomationRunRecord> & { completed?: boolean }) {
  return {
    ...state,
    runs: state.runs.map((run) => run.id === runId ? { ...run, ...patch, heartbeatAt: patch.heartbeatAt ?? run.heartbeatAt } : run),
  };
}

function replaceFields(state: EngineState, fields: StoredField[]) {
  const previous = new Map(state.fields.map((field) => [field.fieldKey, field]));
  return {
    ...state,
    fields: fields.map((field) => {
      const saved = previous.get(field.fieldKey);
      if (!saved) return field;
      return { ...field, filled: saved.filled, validated: saved.validated, resolution: saved.filled ? "FILLED" : field.resolution };
    }),
  };
}

function norm(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clip(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
}
