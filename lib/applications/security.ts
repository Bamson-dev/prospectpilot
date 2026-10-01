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
  | "BOT_VERIFICATION"
  | "LOGIN_REQUIRED"
  | "ACCESS_DENIED"
  | "AUTH_REQUIRED"
  | "RATE_LIMITED"
  | "HTTP_403"
  | "HTTP_429"
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
  if (reason === "access-denied") return "ACCESS_DENIED";
  if (reason === "rate-limit") return "RATE_LIMITED";
  if (reason === "verification") return "AUTH_REQUIRED";
  if (reason === "bot-verification") return "BOT_VERIFICATION";
  const known: PreparationBlocker[] = ["CAPTCHA_REQUIRED", "CLOUDFLARE_CHALLENGE", "BOT_VERIFICATION", "LOGIN_REQUIRED", "ACCESS_DENIED", "AUTH_REQUIRED", "RATE_LIMITED", "HTTP_403", "HTTP_429", "UNRESOLVED_REQUIRED_FIELD", "APPLICATION_FORM_NOT_FOUND", "SOURCE_INVALID", "PAGE_LOAD_TIMEOUT", "BROWSER_TIMEOUT", "EMPLOYER_SERVER_ERROR", "SECURITY_BLOCK"];
  return known.find((item) => item === reason) ?? "SECURITY_BLOCK";
}

export function classifyObservedBarrier(input: { text?: string; fieldTypes?: Array<string | null | undefined>; statusCode?: number }): PreparationBlocker | null {
  const text = input.text ?? "";
  if (typeof input.statusCode === "number" && input.statusCode >= 500 && input.statusCode <= 599) return "EMPLOYER_SERVER_ERROR";
  const security = detectSecurityBarrier({ text, fieldTypes: input.fieldTypes, statusCode: input.statusCode === 429 || input.statusCode === 403 ? undefined : input.statusCode });
  if (security === "captcha") return "CAPTCHA_REQUIRED";
  if (security === "cloudflare") return "CLOUDFLARE_CHALLENGE";
  if (input.statusCode === 429 || security === "rate-limit") return input.statusCode === 429 ? "HTTP_429" : "RATE_LIMITED";
  if (input.statusCode === 403) return "HTTP_403";
  if (security === "access-denied") return "ACCESS_DENIED";
  if (security === "authentication" || security === "account-creation") return "LOGIN_REQUIRED";
  if (/unusual traffic|automated requests|bot detection|are you a robot/.test(text.toLowerCase())) return "BOT_VERIFICATION";
  if (security === "verification") return "AUTH_REQUIRED";
  return null;
}

export function preparationReadinessLine(blocker: string | null | undefined) {
  if (blocker === "CAPTCHA_REQUIRED") return "CAPTCHA requires manual action";
  if (blocker === "CLOUDFLARE_CHALLENGE") return "Cloudflare challenge requires manual action";
  if (blocker === "BOT_VERIFICATION") return "Bot verification requires manual action";
  if (blocker === "LOGIN_REQUIRED" || blocker === "AUTH_REQUIRED") return "Login requires manual action";
  if (blocker === "ACCESS_DENIED" || blocker === "HTTP_403") return "Access denied requires manual action";
  if (blocker === "RATE_LIMITED" || blocker === "HTTP_429") return "Rate limit requires manual action";
  if (blocker === "SECURITY_BLOCK") return "Security barrier requires manual action";
  if (blocker === "EMPLOYER_SERVER_ERROR") return "Employer application page returned a server error";
  if (blocker === "PAGE_LOAD_TIMEOUT" || blocker === "BROWSER_TIMEOUT") return "The employer page did not finish loading";
  if (blocker === "APPLICATION_FORM_NOT_FOUND") return "The application form was not found";
  return null;
}

export function detectSecurityBarrier(input: { text: string; fieldTypes?: Array<string | null | undefined>; statusCode?: number }) {
  const text = input.text.toLowerCase();
  if (input.statusCode === 429 || /too many requests|rate limit/.test(text)) return "rate-limit" as const;
  if (/cloudflare|cf-browser-verification|checking your browser|just a moment|attention required/.test(text)) return "cloudflare" as const;
  if (/captcha|recaptcha|hcaptcha|verify you are human/.test(text)) return "captcha" as const;
  if (/access denied|403 forbidden/.test(text)) return "access-denied" as const;
  if (/create an account|sign up to apply|register to apply/.test(text)) return "account-creation" as const;
  if ((input.fieldTypes ?? []).some((type) => (type ?? "").toLowerCase() === "password")) return "authentication" as const;
  if (/sign in to apply|log in to apply|login to apply|sign-in required|sso login|oauth login|employer portal|session required|account required to apply/.test(text)) {
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
