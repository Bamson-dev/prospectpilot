export type ApplicationBenchmark = {
  attempts: number;
  browserMs: number;
  cvMs: number;
  submissionMs: number;
  cpuPercent?: number;
  rssMb?: number;
};

export function sustainableDailyAttempts(sample: ApplicationBenchmark) {
  if (sample.attempts < 1) return { perHour: 0, perDay: 0, note: "No measured attempts." };
  const averageMs = (sample.browserMs + sample.cvMs + sample.submissionMs) / sample.attempts;
  if (averageMs <= 0) return { perHour: 0, perDay: 0, note: "Timing was not measured." };
  const perHour = Math.floor(3_600_000 / averageMs);
  return {
    perHour,
    perDay: perHour * 24,
    note: "Calculated from this sample only. It is not a guarantee of 500 completed applications.",
  };
}
