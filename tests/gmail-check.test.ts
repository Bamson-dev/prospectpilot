import { describe, expect, it, vi } from "vitest";
import { runGmailSendCheck, type GmailCheckMailer } from "@/lib/email/gmail-check";

function mailer(overrides: Partial<GmailCheckMailer> = {}): GmailCheckMailer & { sendEmail: ReturnType<typeof vi.fn> } {
  return {
    sendEmail: vi.fn(async () => ({ providerMessageId: "m1" })),
    confirmSent: vi.fn(async () => true),
    findSent: vi.fn(async () => "m1"),
    ...overrides,
  } as GmailCheckMailer & { sendEmail: ReturnType<typeof vi.fn> };
}

const account = { fromEmail: "owner@example.com", fromName: "Owner" };

describe("runGmailSendCheck", () => {
  it("passes when Gmail sends, labels SENT and finds the message in Sent", async () => {
    const m = mailer();
    expect(await runGmailSendCheck(m, account)).toEqual({ ok: true, messageId: "m1" });
  });

  it("only ever addresses the connected account itself", async () => {
    const m = mailer();
    await runGmailSendCheck(m, account);
    expect(m.sendEmail.mock.calls[0][0]).toMatchObject({ to: "owner@example.com", from: "owner@example.com" });
    expect(m.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("fails at send when Gmail refuses", async () => {
    const result = await runGmailSendCheck(mailer({ sendEmail: vi.fn(async () => { throw new Error("denied"); }) }), account);
    expect(result).toMatchObject({ ok: false, step: "send" });
  });

  it("fails when the message is not labelled SENT", async () => {
    expect(await runGmailSendCheck(mailer({ confirmSent: vi.fn(async () => false) }), account)).toMatchObject({ ok: false, step: "labelled_sent" });
  });

  it("fails when Sent search returns nothing or another message", async () => {
    expect(await runGmailSendCheck(mailer({ findSent: vi.fn(async () => null) }), account)).toMatchObject({ ok: false, step: "sent_search" });
    expect(await runGmailSendCheck(mailer({ findSent: vi.fn(async () => "other") }), account)).toMatchObject({ ok: false, step: "sent_search" });
  });

  it("does not send a second time when a later step fails", async () => {
    const m = mailer({ confirmSent: vi.fn(async () => false) });
    await runGmailSendCheck(m, account);
    expect(m.sendEmail).toHaveBeenCalledTimes(1);
  });
});
