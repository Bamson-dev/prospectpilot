import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
const reserve = vi.fn();
const findUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    outreachMessage: { findUnique: (...a: unknown[]) => findUnique(...a), count: async () => 0, updateMany: async () => ({ count: 1 }) },
    suppression: { findUnique: async () => null },
    prospect: { update: async () => ({}), findUnique: async () => null },
    emailAccount: { update: async () => ({}) },
    followUp: { create: async () => ({}) },
  },
}));
vi.mock("@/lib/jobs", () => ({ queueJob: vi.fn(), recordActivity: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: () => "refresh" }));
vi.mock("@/lib/session", () => ({ signUnsubscribeToken: async () => "tok" }));
vi.mock("@/lib/email/gmail", () => ({ GmailProvider: class { sendEmail = sendEmail; } }));
vi.mock("@/lib/email/resend", () => ({ ResendProvider: class { sendEmail = sendEmail; } }));
vi.mock("@/lib/email/send-reservation", () => ({ defaultDomainDailyLimit: () => 2, reserveRecipientSend: (...a: unknown[]) => reserve(...a) }));
vi.mock("@/lib/sales/intelligence", () => ({ assertSafeOutboundCopy: () => undefined }));

const verification = { companyNumber: "10876199", companyName: "X LIMITED", companyStatus: "active", companyType: "ltd", checkedAt: new Date().toISOString(), domainConfirmed: true, confirmedDomain: "example.co.uk", domainEvidence: "Website footer shows the company number" };

function message(country: string, salesIntelligence: unknown) {
  return {
    id: "m1", organizationId: "o1", campaignId: "c1", prospectId: "p1", state: "APPROVED", subject: "Hello", body: "Body text",
    contact: { id: "k1", email: "info@example.co.uk", suppressed: false, source: "website" },
    prospect: { companyName: "X Limited", country, sourceUrl: "https://example.co.uk/about", salesIntelligence },
    campaign: { id: "c1", country, status: "ACTIVE", dailyOutreachLimit: 25, autoFollowUp: false, followUpSteps: [], emailAccount: { id: "a1", provider: "GMAIL", status: "ACTIVE", fromEmail: "from@example.test", fromName: "A", refreshTokenEncrypted: "enc" } },
  };
}

describe("outreach compliance gates", () => {
  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue({ providerMessageId: "pm1" });
    reserve.mockReset().mockResolvedValue("claimed");
    findUnique.mockReset();
    vi.stubEnv("OUTREACH_SEND_ENABLED", "true");
    vi.stubEnv("OUTREACH_SENDER_LEGAL_NAME", "Sender Ltd");
    vi.stubEnv("OUTREACH_SENDER_ADDRESS", "1 High Street, London");
    vi.stubEnv("OUTREACH_REPLY_EMAIL", "hello@sender.test");
    vi.stubEnv("OUTREACH_PROSPECTING_PROVIDERS", "GMAIL");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("blocks a UK recipient that has no Companies House verification", async () => {
    findUnique.mockResolvedValue(message("United Kingdom", null));
    const { processOutreach } = await import("@/worker/processors/outreach");
    await expect(processOutreach("m1")).rejects.toThrow("Companies House");
    expect(reserve).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("blocks sending when the sender identity is incomplete", async () => {
    vi.stubEnv("OUTREACH_SENDER_ADDRESS", "");
    findUnique.mockResolvedValue(message("United Kingdom", { companyVerification: verification }));
    const { processOutreach } = await import("@/worker/processors/outreach");
    await expect(processOutreach("m1")).rejects.toThrow("Sender identity");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("blocks a scraped contact when the provider is not allowed to carry prospecting mail", async () => {
    vi.stubEnv("OUTREACH_PROSPECTING_PROVIDERS", "");
    findUnique.mockResolvedValue(message("United Kingdom", { companyVerification: verification }));
    const { processOutreach } = await import("@/worker/processors/outreach");
    await expect(processOutreach("m1")).rejects.toThrow("policy");
    expect(reserve).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("blocks a UK recipient whose domain does not match the verified company", async () => {
    const m = message("United Kingdom", { companyVerification: { ...verification, confirmedDomain: "other.co.uk" } });
    findUnique.mockResolvedValue(m);
    const { processOutreach } = await import("@/worker/processors/outreach");
    await expect(processOutreach("m1")).rejects.toThrow("does not match");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses unapproved messages and suppressed contacts before any send", async () => {
    const { processOutreach } = await import("@/worker/processors/outreach");
    findUnique.mockResolvedValue({ ...message("United Kingdom", { companyVerification: verification }), state: "PENDING_APPROVAL" });
    await expect(processOutreach("m1")).rejects.toThrow("not approved");
    const s = message("United Kingdom", { companyVerification: verification });
    findUnique.mockResolvedValue({ ...s, contact: { ...s.contact, suppressed: true } });
    await expect(processOutreach("m1")).rejects.toThrow("suppressed");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not send when the recipient was already reserved by another message", async () => {
    reserve.mockResolvedValue("duplicate-recipient");
    findUnique.mockResolvedValue(message("United Kingdom", { companyVerification: verification }));
    const { processOutreach } = await import("@/worker/processors/outreach");
    await expect(processOutreach("m1")).rejects.toThrow("already contacted");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends a verified UK company with a full footer and one-click header", async () => {
    findUnique.mockResolvedValue(message("United Kingdom", { companyVerification: verification }));
    const { processOutreach } = await import("@/worker/processors/outreach");
    await processOutreach("m1");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0][0] as { text: string; html: string; listUnsubscribeUrl: string };
    for (const part of ["Sender Ltd", "1 High Street, London", "hello@sender.test", "example.co.uk", "unsubscribe?token=tok"]) expect(sent.text).toContain(part);
    expect(sent.html).toContain("Unsubscribe");
    expect(sent.listUnsubscribeUrl).toContain("/unsubscribe/one-click?token=tok");
  });
});
