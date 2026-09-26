export type ProviderFailureKind = "quota" | "rate_limit" | "auth" | "policy" | "restricted" | "transient" | "unknown";

export function classifyProviderFailure(status: number, body: string): ProviderFailureKind {
  const text = body.toLowerCase();
  if (status === 401 || status === 403 || /unauthori[sz]ed|invalid api key|auth/.test(text)) {
    if (/restrict|suspend|disabled/.test(text)) return "restricted";
    return "auth";
  }
  if (status === 429 || /rate limit|too many requests/.test(text)) return "rate_limit";
  if (/quota|daily limit|sending limit/.test(text)) return "quota";
  if (/policy|spam|blocked|compliance/.test(text)) return "policy";
  if (/restrict|suspend/.test(text)) return "restricted";
  if (status >= 500 || status === 408) return "transient";
  return "unknown";
}

export function providerFailureMessage(kind: ProviderFailureKind) {
  switch (kind) {
    case "quota":
      return "The email provider reported that its quota is exhausted. Sending stopped.";
    case "rate_limit":
      return "The email provider rate limited this account. Sending stopped.";
    case "auth":
      return "The email provider rejected the credentials. Sending stopped.";
    case "policy":
      return "The email provider reported a policy violation. Sending stopped.";
    case "restricted":
      return "The email provider restricted this account. Sending stopped.";
    case "transient":
      return "The email provider had a temporary error.";
    default:
      return "The email provider rejected the message.";
  }
}

export function isPermanentProviderFailure(kind: ProviderFailureKind) {
  return kind !== "transient" && kind !== "unknown";
}
