export const BULK_PREPARE_LIMIT = 10;
export const DISCOVERY_BATCH_LIMIT = 20;
export const MANUAL_QUEUE_REASON = "Queued for manual review.";

export type FitDecision = "APPLY" | "REVIEW" | "NOT_A_FIT";

export function queueAdmission(input: { decision: FitDecision; manuallyQueued: boolean }) {
  if (input.decision === "APPLY") return "automatic" as const;
  if (input.decision === "REVIEW" && input.manuallyQueued) return "manual" as const;
  return "excluded" as const;
}

export function selectBulkPrepare(vacancyIds: string[], eligibleIds: ReadonlySet<string>) {
  const unique = [...new Set(vacancyIds.map((id) => id.trim()).filter(Boolean))];
  const eligible = unique.filter((id) => eligibleIds.has(id));
  const rejected = unique.filter((id) => !eligibleIds.has(id));
  if (eligible.length > BULK_PREPARE_LIMIT) {
    return { ok: false as const, reason: `Select at most ${BULK_PREPARE_LIMIT} vacancies.`, ids: [] as string[], rejected };
  }
  return { ok: true as const, reason: null, ids: eligible, rejected };
}

export function discoveryLimit(value: string | undefined) {
  if (value == null || value.trim() === "") return 40;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 40;
  return Math.min(DISCOVERY_BATCH_LIMIT, Math.max(1, Math.floor(parsed)));
}

export function storedFitDecision(analysis: unknown): FitDecision {
  const opportunity = readQueueOpportunity(analysis);
  if (opportunity.decision === "APPLY" || opportunity.decision === "REVIEW" || opportunity.decision === "NOT_A_FIT") return opportunity.decision;
  return "REVIEW";
}

export function readQueueOpportunity(analysis: unknown) {
  const explanation = explanationOf(analysis);
  const opportunity = explanation?.opportunity;
  const row = opportunity && typeof opportunity === "object" && !Array.isArray(opportunity) ? opportunity as Record<string, unknown> : {};
  const decision = row.decision === "APPLY" || row.decision === "REVIEW" || row.decision === "NOT_A_FIT"
    ? row.decision
    : explanation?.state === "APPLY" || explanation?.state === "QUALIFIED" || explanation?.state === "REVIEW" || explanation?.state === "NOT_A_FIT"
      ? explanation.state === "QUALIFIED" ? "APPLY" : explanation.state
      : null;
  return {
    decision,
    primaryProfile: typeof row.primaryProfile === "string" ? row.primaryProfile : null,
    secondaryProfiles: strings(row.secondaryProfiles),
    reason: typeof row.reason === "string" ? row.reason : "",
    blockers: strings(row.gaps),
  };
}

function explanationOf(analysis: unknown) {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return null;
  const explanation = (analysis as { explanation?: unknown; qualification?: unknown }).explanation;
  if (!explanation || typeof explanation !== "object" || Array.isArray(explanation)) {
    const qualification = (analysis as { qualification?: unknown }).qualification;
    if (qualification === "APPLY" || qualification === "REVIEW" || qualification === "NOT_A_FIT" || qualification === "QUALIFIED") {
      return { state: qualification, opportunity: null };
    }
    return null;
  }
  const row = explanation as { state?: unknown; opportunity?: unknown };
  return { state: row.state, opportunity: row.opportunity ?? null };
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
