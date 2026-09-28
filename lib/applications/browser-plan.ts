import type { JobProviderName } from "@/lib/applications/providers";
import type { ApplicationMode } from "@/lib/applications/types";

export type BrowserStep =
  | "open"
  | "detect-fields"
  | "fill-personal"
  | "upload-cv"
  | "upload-cover-letter"
  | "fill-questions"
  | "pause"
  | "submit"
  | "verify"
  | "manual";

export type BrowserPlan = {
  provider: JobProviderName;
  steps: BrowserStep[];
  submit: boolean;
  reason?: string;
};

export function planApplication(input: {
  provider: JobProviderName;
  mode: ApplicationMode;
  automationEnabled: boolean;
  captcha: boolean;
  unknownRequired: number;
}) : BrowserPlan {
  if (input.captcha) {
    return { provider: input.provider, steps: ["open", "manual"], submit: false, reason: "captcha" };
  }
  if (!input.automationEnabled || input.mode === "MANUAL") {
    return { provider: input.provider, steps: ["open", "detect-fields", "pause"], submit: false, reason: "manual mode" };
  }
  const base: BrowserStep[] = ["open", "detect-fields", "fill-personal", "upload-cv", "upload-cover-letter", "fill-questions"];
  if (input.unknownRequired > 0) {
    return { provider: input.provider, steps: [...base, "manual"], submit: false, reason: "unknown required field" };
  }
  if (input.mode === "AUTO_SUBMIT") {
    return { provider: input.provider, steps: [...base, "submit", "verify"], submit: true };
  }
  return { provider: input.provider, steps: [...base, "pause"], submit: false, reason: "pause before submit" };
}

export function verificationFromPage(text: string) {
  const lower = text.toLowerCase();
  if (/application (has been |was )?submitted|thank you for applying|we have received your application|application received/.test(lower)) {
    return { verified: true, status: "SUBMITTED" as const };
  }
  if (/captcha|cloudflare|verify you are human|access denied/.test(lower)) {
    return { verified: false, status: "REQUIRES_MANUAL_ACTION" as const };
  }
  return { verified: false, status: "VERIFICATION_REQUIRED" as const };
}
