export const FOLLOW_UP_CLAIM_STALE_MS = 60_000;

export function followUpRecoveryDecision(input: {
  state: string;
  messageId: string | null;
  updatedAtMs: number;
  nowMs: number;
  staleMs?: number;
}) {
  const staleMs = input.staleMs ?? FOLLOW_UP_CLAIM_STALE_MS;
  if (input.state === "SCHEDULED") return "claim" as const;
  if (input.state === "QUEUED" && !input.messageId) {
    return input.nowMs - input.updatedAtMs >= staleMs ? "reclaim" as const : "in-progress" as const;
  }
  return "skip" as const;
}
