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
