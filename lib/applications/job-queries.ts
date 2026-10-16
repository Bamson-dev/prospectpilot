// Builds the vacancy search queries for one discovery run.
// Roles the candidate entered always win. Career lane titles are only a fallback when none are set.
export function explicitTargetRoles(roles: readonly string[] | null | undefined, max = 12): string[] {
  const seen = new Set<string>();
  for (const role of roles ?? []) {
    const value = role.toLowerCase().replace(/\s+/g, " ").trim();
    if (value.length >= 3 && value.length <= 80) seen.add(value);
    if (seen.size >= max) break;
  }
  return [...seen];
}

const GENERIC_WORDS = new Set(["manager", "senior", "junior", "lead", "head", "associate", "director", "specialist", "executive", "officer", "with", "and", "the", "for", "remote", "hybrid"]);

// A title matches when it contains every subject word of the query, so "marketing manager"
// no longer accepts "Renewals Manager". Words like manager or senior are not subject words.
export function titleMatchesQuery(title: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/[^a-z0-9+#]+/).filter((token) => token.length > 3);
  if (tokens.length === 0) return true;
  const subject = tokens.filter((token) => !GENERIC_WORDS.has(token));
  const needed = subject.length > 0 ? subject : tokens;
  const lower = title.toLowerCase();
  return needed.every((token) => lower.includes(token));
}
