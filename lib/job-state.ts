export function shouldExecuteJob(state: string, attempts = 0, maxAttempts = Number.POSITIVE_INFINITY) {
  return (state === "QUEUED" || state === "DELAYED" || state === "FAILED") && attempts < maxAttempts;
}

export const ACTIVE_JOB_STALE_MS = 45_000;
export const JOB_HEARTBEAT_MS = 15_000;

export function heartbeatRunDecision(independentAlive: boolean) {
  return independentAlive ? "run" as const : "retry" as const;
}

export function jobDeliveryDecision(input: {
  state: string;
  attempts: number;
  maxAttempts: number;
  startedAtMs: number | null;
  nowMs: number;
}) {
  if (input.state === "COMPLETED" || input.state === "CANCELLED") return "skip" as const;
  if (input.state === "ACTIVE") {
    const age = input.startedAtMs == null ? ACTIVE_JOB_STALE_MS : input.nowMs - input.startedAtMs;
    if (age < ACTIVE_JOB_STALE_MS) return "busy" as const;
    if (input.attempts >= input.maxAttempts) return "exhausted" as const;
    return "reclaim" as const;
  }
  if (shouldExecuteJob(input.state, input.attempts, input.maxAttempts)) return "run" as const;
  return "skip" as const;
}

export function retryQueueJobId(jobId: string, attempts: number) {
  return `${jobId}:retry:${attempts}`;
}

export function claimAfterIndependentHeartbeats(input: {
  claimedAtMs: number;
  nowMs: number;
  heartbeats: boolean;
  heartbeatMs?: number;
}) {
  const heartbeatMs = input.heartbeatMs ?? JOB_HEARTBEAT_MS;
  const elapsed = Math.max(0, input.nowMs - input.claimedAtMs);
  const beats = input.heartbeats ? Math.floor(elapsed / heartbeatMs) : 0;
  return jobDeliveryDecision({
    state: "ACTIVE",
    attempts: 1,
    maxAttempts: 3,
    startedAtMs: input.claimedAtMs + beats * heartbeatMs,
    nowMs: input.nowMs,
  });
}

const PERMANENT_JOB_ERROR = /not configured|stopped|blocked|denied|private network|not a public|quota|rate limit|limit has been reached|turned off|policy|restricted|credentials|did not return|malformed|no company results|not approved/i;

export function isPermanentJobError(message: string) {
  return PERMANENT_JOB_ERROR.test(message);
}
