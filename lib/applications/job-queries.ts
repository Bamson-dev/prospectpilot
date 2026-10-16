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
