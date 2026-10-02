import type { Page } from "playwright";
import { adapterFor } from "@/lib/applications/adapters";
import { classificationReport, inspectFields, mapCandidateToFields, type RawField } from "@/lib/applications/form-map";
import { detectPlatform } from "@/lib/applications/platforms";
import { classifyObservedBarrier, employerServerError, unexpectedRedirect } from "@/lib/applications/security";
import { submissionAllowed } from "@/lib/applications/submission-gate";
import { verificationFromPage } from "@/lib/applications/browser-plan";

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
    };
  }));
}

export async function fillApplicationPage(
  page: Page,
  values: Record<string, string>,
  options: { submit?: boolean; mode?: "PREPARE_ONLY" | "CONFIRMED_SUBMIT"; confirmationPhrase?: string; cvPath?: string; fill?: boolean; statusCode?: number },
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
  const manual = security ?? adapter.requiresManualAction({ text: body, fieldTypes: raw.map((field) => field.type), mapped });
  if (manual && manual !== "unknown-required-field") {
    return finish(page.url(), adapter.name, inspected, mapped, manual, false);
  }
  if (mapped.some((item) => item.status === "UNSUPPORTED")) {
    return finish(page.url(), adapter.name, inspected, mapped, "unknown-required-field", false);
  }
  if (options.fill !== false) {
    for (const field of inspected) {
      const answer = mapped.find((item) => item.name === (field.name || field.question));
      if (!answer || answer.status !== "ANSWERED" || !answer.value) continue;
      const selector = field.name ? `[name="${css(field.name)}"]` : field.id ? `[id="${css(field.id)}"]` : "";
      if (!selector) continue;
      if (answer.classification === "RESUME" && options.cvPath) {
        await page.locator(selector).setInputFiles(options.cvPath);
        continue;
      }
      if (field.type === "file") continue;
      await page.locator(selector).fill(answer.value);
    }
  }
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
