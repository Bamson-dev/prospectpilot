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

// Used before an application email goes out. The vacancy title must match a role the candidate configured.
// No configured roles means nothing matches. Short roles such as "cto" match whole words only.
export function titleMatchesTargetRoles(title: string, roles: readonly string[] | null | undefined): boolean {
  const wanted = explicitTargetRoles(roles);
  if (wanted.length === 0) return false;
  const lower = title.toLowerCase();
  return wanted.some((role) => {
    const tokens = role.split(/[^a-z0-9+#]+/).filter((token) => token.length >= 2);
    const subject = tokens.filter((token) => !GENERIC_WORDS.has(token));
    const needed = subject.length > 0 ? subject : tokens;
    if (needed.length === 0) return false;
    return needed.every((token) => (token.length <= 3 ? new RegExp(`(^|[^a-z0-9])${token.replace(/[+#]/g, "\\$&")}([^a-z0-9]|$)`).test(lower) : lower.includes(token)));
  });
}
