function decode(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function googleBlocked(html: string) {
  return /unusual traffic|detected unusual traffic|recaptcha|\/sorry\//i.test(html);
}

export function googleNeedsBrowser(html: string) {
  return /enablejs|SG_REL|having trouble accessing Google Search/i.test(html);
}

export function rejectAllConsent(html: string) {
  const forms = html.match(/<form\b[^>]*action="https:\/\/consent\.google\.com\/save"[^>]*>[\s\S]*?<\/form>/gi) ?? [];
  const form = forms.find((item) => /Reject all/i.test(item) && /name="set_eom"\s+value="true"|value="true"\s+name="set_eom"/i.test(item));
  if (!form) return null;
  const params = new URLSearchParams();
  for (const input of form.match(/<input\b[^>]*>/gi) ?? []) {
    const name = /name="([^"]+)"/.exec(input)?.[1];
    const value = /value="([^"]*)"/.exec(input)?.[1] ?? "";
    if (name) params.set(name, decode(value));
  }
  if (!params.get("continue")?.startsWith("https://www.google.com/search")) return null;
  return { action: "https://consent.google.com/save", body: params.toString() };
}

export function allowedGoogleUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["www.google.com", "google.com", "consent.google.com"].includes(url.hostname);
  } catch {
    return false;
  }
}
