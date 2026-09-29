export type ThroughputSample = {
  discovered: number;
  analyzed: number;
  packages: number;
  submitted: number;
  failed: number;
  manual: number;
  elapsedMs: number;
};

export type StageTimings = {
  discoveryMs: number;
  analysisMs: number;
  fitMs: number;
  cvMs: number;
  coverLetterMs: number;
  questionsMs: number;
  packageMs: number;
  totalMs: number;
  queueWaitMs: number;
  deepseekCalls: number;
  retryCount: number;
  manualReview: boolean;
  failureReason: string | null;
};

export function emptyTimings(totalMs = 0): StageTimings {
  return {
    discoveryMs: 0,
    analysisMs: 0,
    fitMs: 0,
    cvMs: 0,
    coverLetterMs: 0,
    questionsMs: 0,
    packageMs: 0,
    totalMs,
    queueWaitMs: 0,
    deepseekCalls: 0,
    retryCount: 0,
    manualReview: false,
    failureReason: null,
  };
}

export function packageReadiness(input: { claimsOk: boolean; contactReady: boolean; unresolvedQuestions: boolean; documentError: boolean }) {
  if (input.claimsOk && input.contactReady && !input.unresolvedQuestions && !input.documentError) return "READY_FOR_REVIEW" as const;
  return "REQUIRES_REVIEW" as const;
}

export function throughputReport(sample: ThroughputSample) {
  const hours = sample.elapsedMs > 0 ? sample.elapsedMs / 3_600_000 : 0;
  const perHour = (count: number) => hours > 0 ? Math.round(count / hours) : 0;
  return {
    discoveredPerHour: perHour(sample.discovered),
    analyzedPerHour: perHour(sample.analyzed),
    packagesPerHour: perHour(sample.packages),
    submittedPerHour: perHour(sample.submitted),
    failedPerHour: perHour(sample.failed),
    manualReviewRate: sample.packages === 0 ? 0 : Math.round((sample.manual / sample.packages) * 100),
    benchmarked: false,
    note: "These figures are counts divided by the measured window. A zero window means the rate was not measured. This is not a 500-application day.",
  };
}
