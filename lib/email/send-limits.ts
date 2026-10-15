// Daily safety caps for the sending worker. The defaults match the values that were previously
// hardcoded. Raise them only after checking the sender account's provider limits.
function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

export function accountDailyLimit(env: Record<string, string | undefined> = process.env) {
  return positiveInt(env.OUTREACH_ACCOUNT_DAILY_LIMIT, 40);
}

export function systemDailyLimit(env: Record<string, string | undefined> = process.env) {
  return positiveInt(env.OUTREACH_SYSTEM_DAILY_LIMIT, 200);
}

// Messages that already left or are leaving today count toward the caps. A message in SENDING has
// reserved its slot even though sentAt is not written until the provider answers.
export function sentTodayWhere(start: Date) {
  return {
    OR: [
      { sentAt: { gte: start } },
      { state: "SENDING" as const, updatedAt: { gte: start } },
    ],
  };
}
