import type { Page } from "playwright";
import { mapField, type FieldHint } from "@/lib/applications/fields";
import { verificationFromPage } from "@/lib/applications/browser-plan";

export async function readFormFields(page: Page): Promise<FieldHint[]> {
  return page.locator("input, textarea, select").evaluateAll((elements) => elements.map((element) => {
    const input = element as HTMLInputElement;
    const label = input.labels?.[0]?.textContent ?? "";
    return {
      label,
      name: input.getAttribute("name"),
      placeholder: input.getAttribute("placeholder"),
      ariaLabel: input.getAttribute("aria-label"),
      type: input.getAttribute("type"),
      nearby: input.parentElement?.textContent?.slice(0, 120) ?? "",
    };
  }));
}

export async function fillApplicationPage(page: Page, values: Record<string, string>, options: { submit: boolean; cvPath?: string }) {
  const body = await page.locator("body").innerText().catch(() => "");
  const blocked = /captcha|cloudflare|verify you are human|access denied/i.test(body);
  if (blocked) return { filled: false, submitted: false, status: "REQUIRES_MANUAL_ACTION" as const, reason: "captcha" };
  const fields = await readFormFields(page);
  const unknownRequired = fields.filter((field) => /required/i.test(`${field.label ?? ""} ${field.nearby ?? ""}`) && !mapField(field));
  if (unknownRequired.length > 0) {
    return { filled: false, submitted: false, status: "REQUIRES_MANUAL_ACTION" as const, reason: "unknown required field" };
  }
  for (const field of fields) {
    const key = mapField(field);
    if (!key || !field.name) continue;
    if (key === "resume" && options.cvPath) {
      await page.locator(`[name="${css(field.name)}"]`).setInputFiles(options.cvPath);
      continue;
    }
    const value = values[key];
    if (!value || field.type === "file") continue;
    await page.locator(`[name="${css(field.name)}"]`).fill(value);
  }
  if (!options.submit) return { filled: true, submitted: false, status: "READY_FOR_REVIEW" as const, reason: "pause before submit" };
  const submit = page.locator("button[type='submit'], input[type='submit']").first();
  if (await submit.count() === 0) return { filled: true, submitted: false, status: "VERIFICATION_REQUIRED" as const, reason: "no submit control" };
  await submit.click();
  const after = await page.locator("body").innerText();
  const verdict = verificationFromPage(after);
  return { filled: true, submitted: verdict.verified, status: verdict.status, reason: verdict.verified ? "confirmed" : "unconfirmed" };
}

function css(value: string) {
  return value.replace(/["\\]/g, "");
}
