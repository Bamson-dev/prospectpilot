export function qualificationEvidence(input: {
  companyName: string;
  domain?: string | null;
  industry?: string | null;
  city?: string | null;
  country?: string | null;
  website?: string | null;
  fetchMethod: string;
  title?: string | null;
  description?: string | null;
  excerpt?: string | null;
  signals: unknown;
  sources: { sourceType: string; sourceUrl: string; query?: string | null }[];
}) {
  const kind = input.fetchMethod === "blocked" ? "blocked; this is not website research" : `page text fetched by ${input.fetchMethod}`;
  return [
    `Company: ${input.companyName}`,
    input.domain ? `Domain: ${input.domain}` : "",
    input.industry ? `Industry: ${input.industry}` : "",
    input.city || input.country ? `Location: ${[input.city, input.country].filter(Boolean).join(", ")}` : "",
    input.website ? `Website: ${input.website}` : "",
    `Research method: ${input.fetchMethod}`,
    `Evidence kind: ${kind}`,
    input.title ? `Title: ${input.title}` : "",
    input.description ? `Description: ${input.description}` : "",
    input.excerpt ? `Page text: ${input.excerpt.slice(0, 5000)}` : "",
    `Signals: ${JSON.stringify(input.signals).slice(0, 2000)}`,
    `Discovery query: ${input.sources.map((item) => item.query).filter(Boolean).join(" | ") || "none"}`,
    input.sources.length > 0 ? `Discovery sources: ${input.sources.map((item) => `${item.sourceType} ${item.sourceUrl}`).join(" | ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function shouldStoreQualificationDraft(state: string | null | undefined) {
  return state !== "DRAFT" && state !== "PENDING_APPROVAL";
}

export function analysisRetryDecision(attempt: number, message: string) {
  if (/not configured/.test(message)) return "stop" as const;
  if (attempt < 1) return "retry" as const;
  return "fail" as const;
}
