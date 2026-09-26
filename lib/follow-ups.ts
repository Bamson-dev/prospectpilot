export type FollowUpStep = { dayOffset: number };

export function parseFollowUpSteps(value: unknown): FollowUpStep[] {
  if (!Array.isArray(value)) return defaultFollowUpSteps();
  const steps = value
    .map((item) => {
      if (!item || typeof item !== "object" || !("dayOffset" in item)) return null;
      const dayOffset = Number((item as { dayOffset: unknown }).dayOffset);
      if (!Number.isInteger(dayOffset) || dayOffset < 1 || dayOffset > 90) return null;
      return { dayOffset };
    })
    .filter((item): item is FollowUpStep => item !== null);
  return steps.length > 0 ? steps.slice(0, 6) : defaultFollowUpSteps();
}

export function defaultFollowUpSteps(): FollowUpStep[] {
  return [{ dayOffset: 3 }, { dayOffset: 7 }, { dayOffset: 14 }];
}

export function stepsFromText(value: string) {
  const days = value
    .split(/[,\s]+/)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 90);
  return days.length > 0 ? days.map((dayOffset) => ({ dayOffset })) : defaultFollowUpSteps();
}
