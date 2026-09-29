export function preparationDecision(hasExisting: boolean, reprepare: boolean) {
  if (!hasExisting) return "CREATE" as const;
  if (reprepare) return "REPREPARE" as const;
  return "REUSE" as const;
}

export function nextPackageVersion(current: number | null | undefined) {
  return Math.max(0, current ?? 0) + 1;
}

export function safeAuditDetail(detail: string) {
  if (/password|bearer\s+|authorization:\s*|api[_-]?key|token=/i.test(detail)) return "redacted";
  return detail.replace(/\s+/g, " ").trim().slice(0, 240);
}
