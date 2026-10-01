export type SecurityReason =
  | "captcha"
  | "cloudflare"
  | "authentication"
  | "account-creation"
  | "verification"
  | "access-denied"
  | "rate-limit"
  | "unexpected-redirect"
  | "unknown-required-field";

export type PreparationBlocker =
  | "CAPTCHA_REQUIRED"
  | "CLOUDFLARE_CHALLENGE"
  | "LOGIN_REQUIRED"
  | "UNRESOLVED_REQUIRED_FIELD"
  | "APPLICATION_FORM_NOT_FOUND"
  | "SOURCE_INVALID"
  | "PAGE_LOAD_TIMEOUT"
  | "BROWSER_TIMEOUT"
  | "EMPLOYER_SERVER_ERROR"
  | "SECURITY_BLOCK";

export function employerServerError(statusCode: number | undefined, text: string) {
  if (typeof statusCode === "number" && statusCode >= 500 && statusCode <= 599) return true;
  const sample = text.replace(/\s+/g, " ").trim().slice(0, 400).toLowerCase();
  return /\berror 50[0-9]\b|\bservice unavailable\b|\bbad gateway\b|\bgateway time-?out\b/.test(sample);
}

export function classifyNavigationError(message: string): PreparationBlocker {
  const text = message.toLowerCase();
  if (/failed to launch|browser has been closed|executable doesn't exist/.test(text)) return "BROWSER_TIMEOUT";
  if (/waiting for locator|waiting for selector|strict mode violation/.test(text)) return "APPLICATION_FORM_NOT_FOUND";
  if (/page\.goto: timeout|navigating to|timeout \d+ms exceeded/.test(text)) return "PAGE_LOAD_TIMEOUT";
  return "PAGE_LOAD_TIMEOUT";
}

export function preparationBlocker(reason: string | null | undefined): PreparationBlocker | null {
  if (!reason || reason === "pause before submit") return null;
  if (reason === "captcha") return "CAPTCHA_REQUIRED";
  if (reason === "cloudflare") return "CLOUDFLARE_CHALLENGE";
  if (reason === "authentication" || reason === "account-creation" || reason === "unexpected-redirect") return "LOGIN_REQUIRED";
  if (reason === "unknown-required-field" || reason === "required-field-needs-review") return "UNRESOLVED_REQUIRED_FIELD";
  if (reason === "rate-limit" || reason === "access-denied" || reason === "verification") return "SECURITY_BLOCK";
  const known: PreparationBlocker[] = ["CAPTCHA_REQUIRED", "CLOUDFLARE_CHALLENGE", "LOGIN_REQUIRED", "UNRESOLVED_REQUIRED_FIELD", "APPLICATION_FORM_NOT_FOUND", "SOURCE_INVALID", "PAGE_LOAD_TIMEOUT", "BROWSER_TIMEOUT", "EMPLOYER_SERVER_ERROR", "SECURITY_BLOCK"];
  return known.find((item) => item === reason) ?? "SECURITY_BLOCK";
}

export function detectSecurityBarrier(input: { text: string; fieldTypes?: Array<string | null | undefined>; statusCode?: number }) {
  const text = input.text.toLowerCase();
  if (input.statusCode === 429 || /too many requests|rate limit/.test(text)) return "rate-limit" as const;
  if (/cloudflare|cf-browser-verification|checking your browser|just a moment|attention required/.test(text)) return "cloudflare" as const;
  if (/captcha|recaptcha|hcaptcha|verify you are human/.test(text)) return "captcha" as const;
  if (/access denied|403 forbidden/.test(text)) return "access-denied" as const;
  if (/create an account|sign up to apply|register to apply/.test(text)) return "account-creation" as const;
  if ((input.fieldTypes ?? []).some((type) => (type ?? "").toLowerCase() === "password")) return "authentication" as const;
  if (/sign in to apply|log in to apply|login to apply|sign-in required|sign in|log in|sso\b|oauth|employer portal|session required|account required to apply/.test(text)) {
    return "authentication" as const;
  }
  if (/verification code|check your email to continue|two-factor|2fa/.test(text)) return "verification" as const;
  return null;
}

export function unexpectedRedirect(requestedUrl: string, finalUrl: string) {
  const requested = hostname(requestedUrl);
  const finalHost = hostname(finalUrl);
  if (!requested || !finalHost || requested === finalHost) return false;
  if (/login|auth|sso|accounts\.google|okta/.test(finalHost)) return true;
  return false;
}

function hostname(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}
