export type ThroughputSample = {
  discovered: number;
  analyzed: number;
  packages: number;
  submitted: number;
  failed: number;
  manual: number;
  elapsedMs: number;
};

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
