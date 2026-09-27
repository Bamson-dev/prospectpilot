const INDUSTRY_INTENTS: Record<string, string[]> = {
  "real estate": [
    "real estate agencies",
    "estate agents",
    "property management companies",
    "property developers",
    "real estate companies",
    "property consultants",
  ],
};

export function buildDiscoveryQueries(input: {
  industry?: string | null;
  city?: string | null;
  country?: string | null;
  searchTerms: string;
  excludedKeywords?: string | null;
  maxQueries?: number | null;
}) {
  const place = [input.city, input.country].filter(Boolean).join(", ");
  const industry = input.industry?.trim();
  const excluded = new Set(
    (input.excludedKeywords ?? "")
      .split(/\n|,/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  const seeds = new Set<string>();
  for (const term of input.searchTerms.split(/\n|,/).map((item) => item.trim()).filter(Boolean)) seeds.add(term);
  if (industry) {
    seeds.add(industry);
    const intent = Object.entries(INDUSTRY_INTENTS).find(([key]) => industry.toLowerCase().includes(key));
    for (const item of intent?.[1] ?? []) seeds.add(item);
  }
  const queries: string[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    if (excluded.has(seed.toLowerCase())) continue;
    const query = [seed, place].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const key = query.toLowerCase();
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
  }
  const cap = Math.min(Math.max(input.maxQueries ?? 6, 1), 12);
  return queries.slice(0, cap);
}
