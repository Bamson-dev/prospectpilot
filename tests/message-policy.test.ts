import { describe, expect, it } from "vitest";
import { alreadyContactedRecipient, providerEventSuppresses } from "@/lib/email/message-policy";

describe("send safety policy", () => {
  it("suppresses the recipient after a bounce or complaint only", () => {
    expect(providerEventSuppresses("email.bounced")).toBe(true);
    expect(providerEventSuppresses("email.complained")).toBe(true);
    expect(providerEventSuppresses("email.delivered")).toBe(false);
    expect(providerEventSuppresses("email.opened")).toBe(false);
  });

  it("blocks a second message to an address that another message already reached", () => {
    expect(alreadyContactedRecipient(["SENT"])).toBe(true);
    expect(alreadyContactedRecipient(["DRAFT", "SENDING"])).toBe(true);
    expect(alreadyContactedRecipient(["REPLIED"])).toBe(true);
  });

  it("allows a first send when other messages never left the system", () => {
    expect(alreadyContactedRecipient([])).toBe(false);
    expect(alreadyContactedRecipient(["DRAFT", "PENDING_APPROVAL", "FAILED", "CANCELLED", "SUPPRESSED"])).toBe(false);
  });
});
