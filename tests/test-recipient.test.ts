import { describe, expect, it } from "vitest";
import { recipientAllowed, testRecipientLock } from "@/lib/email/test-recipient";

describe("test recipient lock", () => {
  it("is inactive when the variable is unset or blank", () => {
    expect(testRecipientLock({})).toEqual({ active: false });
    expect(testRecipientLock({ OUTREACH_TEST_RECIPIENT: "   " })).toEqual({ active: false });
    expect(recipientAllowed("anyone@example.com", { active: false })).toBe(true);
  });

  it("locks to one lowercase address", () => {
    const lock = testRecipientLock({ OUTREACH_TEST_RECIPIENT: " Owner@Example.com " });
    expect(lock).toEqual({ active: true, email: "owner@example.com" });
    expect(recipientAllowed("OWNER@example.com", lock)).toBe(true);
    expect(recipientAllowed("other@example.com", lock)).toBe(false);
  });

  it("blocks every address when the value is not a single valid email", () => {
    for (const value of ["nope", "a@b.co, c@d.co", "a@b.co;c@d.co", "@x.com"]) {
      const lock = testRecipientLock({ OUTREACH_TEST_RECIPIENT: value });
      expect(lock).toEqual({ active: true, email: null });
      expect(recipientAllowed("a@b.co", lock)).toBe(false);
    }
  });
});
