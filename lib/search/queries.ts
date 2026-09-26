export function buildDiscoveryQueries(input: {
  industry?: string | null;
  city?: string | null;
  country?: string | null;
  searchTerms: string;
}) {
  const place = [input.city, input.country].filter(Boolean).join(", ");
  const industry = input.industry?.trim();
  const terms = input.searchTerms
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
  const queries = new Set<string>();
  if (terms.length === 0 && industry) terms.push(industry);
  for (const term of terms) {
    queries.add([term, place].filter(Boolean).join(" "));
    if (industry && term.toLowerCase() !== industry.toLowerCase()) {
      queries.add([term, industry, place].filter(Boolean).join(" "));
    }
  }
  return [...queries].filter((query) => query.length > 1).slice(0, 8);
}
