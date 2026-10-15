// Controlled-test lock. While OUTREACH_TEST_RECIPIENT is set, the outreach pipeline sends to that one
// address and to nobody else. A value that is not a valid email address blocks every send, so a typo
// cannot open sending to everyone. When the variable is unset or blank, behaviour is unchanged.
export type TestRecipientLock = { active: false } | { active: true; email: string | null };

export function testRecipientLock(env: Record<string, string | undefined> = process.env): TestRecipientLock {
  const raw = (env.OUTREACH_TEST_RECIPIENT ?? "").trim().toLowerCase();
  if (raw === "") return { active: false };
  const valid = raw.length <= 254 && /^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$/.test(raw);
  return { active: true, email: valid ? raw : null };
}

export function recipientAllowed(email: string, lock: TestRecipientLock) {
  if (!lock.active) return true;
  return lock.email !== null && email.trim().toLowerCase() === lock.email;
}
