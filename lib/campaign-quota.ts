export const QUOTA_RESERVATION_STALE_MS = 15 * 60 * 1000;

export type ResearchReservation = {
  prospectId: string;
  fetchMethod: string;
  createdAtMs: number;
};

export function countsTowardResearchQuota(record: ResearchReservation, nowMs: number, staleMs = QUOTA_RESERVATION_STALE_MS) {
  if (record.fetchMethod === "pending" && nowMs - record.createdAtMs >= staleMs) return false;
  return true;
}

export function researchQuotaDecision(records: ResearchReservation[], limit: number, nowMs: number) {
  const used = records.filter((record) => countsTowardResearchQuota(record, nowMs)).length;
  return used < limit ? "allow" as const : "stop" as const;
}

export function reserveAgainstCap(records: ResearchReservation[], prospectIds: string[], limit: number, nowMs: number) {
  const next = [...records];
  const accepted: string[] = [];
  for (const prospectId of prospectIds) {
    if (researchQuotaDecision(next, limit, nowMs) === "stop") break;
    next.push({ prospectId, fetchMethod: "pending", createdAtMs: nowMs });
    accepted.push(prospectId);
  }
  return { accepted, records: next };
}

export function releasePendingReservation(fetchMethod: string) {
  return fetchMethod === "pending" ? "release" as const : "keep" as const;
}

export function takeDailySlots(used: number, limit: number, requested: number) {
  const accepted = Math.max(0, Math.min(requested, limit - used));
  return { accepted, usedAfter: used + accepted };
}
