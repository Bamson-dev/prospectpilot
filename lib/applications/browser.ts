import type { Page } from "playwright";
import { adapterFor } from "@/lib/applications/adapters";
import { classificationReport, inspectFields, mapCandidateToFields, type RawField } from "@/lib/applications/form-map";
import { detectPlatform } from "@/lib/applications/platforms";
import { classifyObservedBarrier, employerServerError, unexpectedRedirect } from "@/lib/applications/security";
import { submissionAllowed } from "@/lib/applications/submission-gate";
import { verificationFromPage } from "@/lib/applications/browser-plan";
import { checkboxAction, matchOption, textFillPlan, uploadDecision, visibleValidationProblem } from "@/lib/applications/form-completion";

export type PreparationAudit = {
  url: string;
  platform: string;
  timestamp: string;
  fieldsDetected: number;
  fieldsMapped: string[];
  questionsDetected: string[];
  unanswered: string[];
  manualReason: string | null;
  finalState: "READY_FOR_HUMAN_SUBMISSION" | "REQUIRES_MANUAL_ACTION" | "SUBMITTED";
  submitted: boolean;
  metrics: ReturnType<typeof classificationReport>;
};

export async function readFormFields(page: Page): Promise<RawField[]> {
  return page.locator("input, textarea, select").evaluateAll((elements) => elements.map((element) => {
    const input = element as HTMLInputElement;
    const label = input.labels?.[0]?.textContent ?? "";
    const select = element as HTMLSelectElement;
    return {
      label,
      name: input.getAttribute("name"),
      id: input.id,
      placeholder: input.getAttribute("placeholder"),
      ariaLabel: input.getAttribute("aria-label"),
      autocomplete: input.getAttribute("autocomplete"),
      section: (() => {
        const legend = input.closest("fieldset")?.querySelector("legend")?.textContent ?? "";
        if (legend.trim()) return legend.trim().slice(0, 120);
        let node: Element | null = input;
        while (node) {
          let previous = node.previousElementSibling;
          while (previous) {
            if (/^H[1-3]$/.test(previous.tagName)) return (previous.textContent ?? "").trim().slice(0, 120);
            previous = previous.previousElementSibling;
          }
          node = node.parentElement;
        }
        return "";
      })(),
      type: input.getAttribute("type") || element.tagName.toLowerCase(),
      required: input.required || input.getAttribute("aria-required") === "true",
      nearby: input.parentElement?.textContent?.slice(0, 160) ?? "",
      options: element.tagName === "SELECT" ? [...select.options].map((option) => option.text).slice(0, 30) : [],
      value: input.type === "file" ? input.files?.[0]?.name ?? "" : input.type === "checkbox" || input.type === "radio" ? (input.checked ? input.value || "on" : "") : element.tagName === "SELECT" ? select.selectedOptions[0]?.text ?? "" : input.value,
    };
  }));
}

export async function fillApplicationPage(
  page: Page,
  values: Record<string, string>,
  options: { submit?: boolean; mode?: "PREPARE_ONLY" | "CONFIRMED_SUBMIT"; confirmationPhrase?: string; cvPath?: string; coverPath?: string; fill?: boolean; statusCode?: number },
) {
  const started = page.url();
  const body = await page.locator("body").innerText().catch(() => "");
  const html = await page.content().catch(() => "");
  const raw = await readFormFields(page).catch(() => []);
  if (employerServerError(undefined, body)) {
    return finish(page.url(), detectPlatform({ url: page.url() }), [], [], "EMPLOYER_SERVER_ERROR", false);
  }
  const security = classifyObservedBarrier({ text: `${body}\n${html}`, fieldTypes: raw.map((field) => field.type), statusCode: options.statusCode })
    ?? (unexpectedRedirect(started, page.url()) ? "LOGIN_REQUIRED" as const : null);
  const inspected = inspectFields(raw);
  const mapped = mapCandidateToFields(inspected, values);
  const adapter = adapterFor(page.url());
  const manual = security ?? adapter.requiresManualAction({ text: body, fieldTypes: raw.map((field) => field.type), mapped })
    ?? (mapped.some((item) => item.status === "UNSUPPORTED") ? "unknown-required-field" : null);
  const defer = manual === "unknown-required-field" || manual === "required-field-needs-review";
  if (manual && !defer) return finish(page.url(), adapter.name, inspected, mapped, manual, false);
  if (options.fill !== false) {
    const sortedInspected = [...inspected].sort((a, b) => taxonomyFillPriority(a.taxonomy) - taxonomyFillPriority(b.taxonomy));
    for (const field of sortedInspected) {
      const answer = mapped.find((item) => item.name === (field.name || field.id || field.question));
      const selector = field.name ? `[name="${css(field.name)}"]` : field.id ? `[id="${css(field.id)}"]` : "";
      if (!selector) continue;
      const control = page.locator(selector).first();
      if (field.type === "checkbox") {
        const action = checkboxAction({ classification: field.taxonomy, label: field.label, required: field.required, checked: Boolean(fieldLive(raw, field)) });
        if (action === "check") await control.check({ timeout: 5000 });
        continue;
      }
      if (field.type === "file") {
        const cover = field.taxonomy === "COVER_LETTER" || answer?.classification === "COVER_LETTER";
        const decision = uploadDecision({
          classification: cover ? "COVER_LETTER" : "RESUME",
          attachedFile: fieldLive(raw, field),
          expectedFile: (cover ? options.coverPath : options.cvPath)?.split(/[/\\]/).pop() ?? null,
          valid: true,
          supported: cover ? Boolean(options.coverPath) : Boolean(options.cvPath),
        });
        const path = cover ? options.coverPath : options.cvPath;
        if (decision === "upload" && path) await control.setInputFiles(path);
        continue;
      }
      if (!answer || answer.status !== "ANSWERED" || !answer.value) continue;
      if (field.type === "select" || field.type === "radio") {
        const option = matchOption(field.options, answer.value);
        if (!option) continue;
        if (field.type === "select") {
          await control.selectOption({ label: option }, { timeout: 5000 });
          continue;
        }
        const group = page.locator(`input[type="radio"][name="${css(field.name)}"]`);
        const count = await group.count();
        for (let index = 0; index < count; index += 1) {
          const label = await group.nth(index).evaluate((element) => {
            const input = element as HTMLInputElement;
            return (input.labels?.[0]?.textContent ?? input.value ?? "").trim();
          });
          if (label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === option.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()) {
            await group.nth(index).check({ timeout: 5000 });
            break;
          }
        }
        continue;
      }
      const current = await control.inputValue().catch(() => "");
      if (textFillPlan(current, answer.value) !== "fill") continue;
      await control.fill(answer.value, { timeout: 5000 });
      const confirmed = await control.inputValue().catch(() => "");
      if (confirmed.trim().toLowerCase() !== answer.value.trim().toLowerCase() && field.required) {
        return finish(page.url(), adapter.name, inspected, mapped, "FORM_VALIDATION_FAILED", true);
      }
    }
  }
  const afterBody = await page.locator("body").innerText().catch(() => "");
  const afterHtml = await page.content().catch(() => "");
  const afterBarrier = classifyObservedBarrier({ text: `${afterBody}\n${afterHtml}`, fieldTypes: raw.map((field) => field.type), statusCode: options.statusCode });
  if (afterBarrier) return finish(page.url(), adapter.name, inspected, mapped, afterBarrier, true);
  const validationProblem = visibleValidationProblem(afterBody);
  if (validationProblem) return finish(page.url(), adapter.name, inspected, mapped, validationProblem, true);
  if (manual) return finish(page.url(), adapter.name, inspected, mapped, manual, true);
  const allowed = options.mode === "CONFIRMED_SUBMIT" && submissionAllowed({
    phrase: options.confirmationPhrase ?? "",
    pageUrl: page.url(),
    liveFlag: process.env.APPLICATION_LIVE_SUBMIT === "true",
  });
  if (!allowed) return finish(page.url(), detectPlatform({ url: page.url() }), inspected, mapped, null, true);
  const submit = page.locator("button[type='submit'], input[type='submit']").first();
  if (await submit.count() === 0) return finish(page.url(), adapter.name, inspected, mapped, "no submit control", true);
  await submit.click();
  const after = await page.locator("body").innerText();
  const verdict = verificationFromPage(after);
  return {
    filled: true,
    submitted: verdict.verified,
    status: verdict.verified ? "SUBMITTED" as const : verdict.status,
    reason: verdict.verified ? "confirmed" : "unconfirmed",
    audit: audit(page.url(), adapter.name, inspected, mapped, verdict.verified ? null : "unconfirmed", verdict.verified ? "SUBMITTED" : "REQUIRES_MANUAL_ACTION", verdict.verified),
    resolvedFields: fieldSnapshot(inspected, mapped),
  };
}

function finish(url: string, platform: string, inspected: ReturnType<typeof inspectFields>, mapped: ReturnType<typeof mapCandidateToFields>, manual: string | null, filled: boolean) {
  const blocked = Boolean(manual);
  return {
    filled,
    submitted: false,
    status: blocked ? "REQUIRES_MANUAL_ACTION" as const : "READY_FOR_HUMAN_SUBMISSION" as const,
    reason: manual ?? "pause before submit",
    audit: audit(url, platform, inspected, mapped, manual, blocked ? "REQUIRES_MANUAL_ACTION" : "READY_FOR_HUMAN_SUBMISSION", false),
    resolvedFields: fieldSnapshot(inspected, mapped),
  };
}

function fieldSnapshot(inspected: ReturnType<typeof inspectFields>, mapped: ReturnType<typeof mapCandidateToFields>) {
  return inspected.map((field, index) => ({
    label: field.label,
    name: field.name,
    id: field.id,
    type: field.type,
    required: field.required,
    autocomplete: field.ariaLabel,
    nearby: field.question,
    classification: mapped[index]?.taxonomy ?? field.taxonomy,
    confidence: mapped[index]?.confidence ?? field.confidence,
    answer: mapped[index]?.value ?? null,
    answerSource: mapped[index]?.source ?? null,
    resolution: mapped[index]?.status,
  }));
}

function audit(url: string, platform: string, inspected: ReturnType<typeof inspectFields>, mapped: ReturnType<typeof mapCandidateToFields>, manual: string | null, finalState: PreparationAudit["finalState"], submitted: boolean): PreparationAudit {
  return {
    url,
    platform,
    timestamp: new Date().toISOString(),
    fieldsDetected: inspected.length,
    fieldsMapped: mapped.filter((item) => item.status === "ANSWERED").map((item) => item.classification),
    questionsDetected: inspected.filter((field) => field.classification === "CUSTOM_QUESTION" || field.question.endsWith("?")).map((field) => field.question),
    unanswered: mapped.filter((item) => item.status !== "ANSWERED").map((item) => item.reason ?? item.classification),
    manualReason: manual,
    finalState,
    submitted,
    metrics: classificationReport(inspected, mapped),
  };
}

function css(value: string) {
  return value.replace(/["\\]/g, "");
}

function fieldLive(raw: RawField[], field: { name: string; id: string }) {
  return raw.find((item) => (field.name && item.name === field.name) || (field.id && item.id === field.id))?.value ?? "";
}

function taxonomyFillPriority(taxonomy: string): number {
  const t = (taxonomy || "").toUpperCase();
  if (t.includes("NAME") || t.includes("FIRST") || t.includes("LAST") || t === "IDENTITY") return 1;
  if (t.includes("EMAIL") || t.includes("PHONE") || t.includes("CONTACT")) return 2;
  if (t.includes("LOCATION") || t.includes("ADDRESS") || t.includes("CITY") || t.includes("ZIP")) return 3;
  if (t.includes("LINKEDIN") || t.includes("GITHUB") || t.includes("WEBSITE") || t.includes("PORTFOLIO") || t === "PROFILE") return 4;
  if (t.includes("EMPLOYMENT") || t.includes("COMPANY") || t.includes("TITLE") || t === "EXPERIENCE") return 5;
  if (t.includes("EDUCATION") || t.includes("DEGREE") || t.includes("SCHOOL")) return 6;
  if (t.includes("SKILL") || t.includes("TECHNOLOGY")) return 7;
  if (t.includes("QUESTION") || t === "CUSTOM_QUESTION") return 8;
  if (t === "RESUME" || t === "COVER_LETTER" || t === "DOCUMENT") return 9;
  return 10;
}
