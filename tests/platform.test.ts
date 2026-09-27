import { describe, expect, it } from "vitest";
import { cleanCompanyName, isSocialHost, registrableHost, websiteFromUrl } from "@/lib/domains";
import { extractJsonObject } from "@/lib/ai/schemas";
import { companyAnalysisSchema } from "@/lib/ai/schemas";
import { parseFollowUpSteps } from "@/lib/follow-ups";
import { redact } from "@/lib/logger";
import { isBlockedIp } from "@/lib/network";
import { classifyProviderFailure, isPermanentProviderFailure } from "@/lib/provider-errors";
import { describeGoogleDenial, IPV4_FAMILY } from "@/lib/search/ipv4";
import { buildDiscoveryQueries } from "@/lib/search/queries";
import { googleNeedsBrowser, rejectAllConsent } from "@/lib/search/consent";
import { parseGoogleResults } from "@/lib/search/parse-google";
import { extractPage } from "@/lib/research/extract";
import { healthDecision } from "@/lib/health";
import { aiConfigured } from "@/lib/ai/service";
import { credentialStatus, integrationLabel } from "@/lib/integrations/status";
import { belongsToOrganization } from "@/lib/ownership";
import { ResendProvider } from "@/lib/email/resend";
import { outreachSendingEnabled } from "@/lib/email/send-gate";
import { QUEUE_NAMES } from "@/lib/queues";
import { roleAtLeast } from "@/lib/roles";
import { isSuppressionRequest } from "@/lib/suppression";
import { sanitizeOutbound } from "@/lib/email/types";

describe("domains", () => {
  it("normalizes a company website and skips social hosts", () => {
    expect(registrableHost("https://www.Example.com/about")).toBe("example.com");
    expect(websiteFromUrl("https://www.example.com/about")?.domain).toBe("example.com");
    expect(websiteFromUrl("https://facebook.com/acme")).toBeNull();
    expect(isSocialHost("instagram.com")).toBe(true);
    expect(cleanCompanyName("Acme Realty | Home")).toBe("Acme Realty");
  });
});

describe("google results", () => {
  it("parses result links and ignores google hosts", () => {
    const html = `
      <a href="/url?q=https://northwind.example/&amp;sa=U">Northwind Realty</a>
      <div class="VwiC3b">Estate agency in Johannesburg</div>
      <a href="https://www.google.com/search?q=x">Google</a>
    `;
    const hits = parseGoogleResults(html, 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.url).toContain("northwind.example");
    expect(hits[0]?.title).toBe("Northwind Realty");
  });

  it("selects the essential-only Google consent form", () => {
    const html = `<form action="https://consent.google.com/save" method="POST"><input name="set_eom" value="true"><input name="continue" value="https://www.google.com/search?q=acme"><input type="submit" value="Reject all"></form>`;
    const form = rejectAllConsent(html);
    expect(form?.action).toBe("https://consent.google.com/save");
    expect(form?.body).toContain("set_eom=true");
    expect(googleNeedsBrowser("Please click enablejs SG_REL")).toBe(true);
  });
});

describe("queries and follow-ups", () => {
  it("builds a bounded query list", () => {
    const queries = buildDiscoveryQueries({
      industry: "Real estate",
      city: "Johannesburg",
      country: "South Africa",
      searchTerms: "estate agencies",
    });
    expect(queries[0]).toContain("Johannesburg");
    expect(queries.length).toBeLessThanOrEqual(8);
  });

  it("keeps only valid follow-up days", () => {
    expect(parseFollowUpSteps([{ dayOffset: 3 }, { dayOffset: 0 }, { dayOffset: 14 }])).toEqual([
      { dayOffset: 3 },
      { dayOffset: 14 },
    ]);
  });
});

describe("security helpers", () => {
  it("blocks private and metadata addresses", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("10.1.1.1")).toBe(true);
    expect(isBlockedIp("192.168.0.8")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("172.16.0.4")).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("207.180.248.233")).toBe(true);
  });

  it("redacts secrets and detects suppression", () => {
    expect(redact({ api_key: "hidden", name: "Ada" })).toEqual({ api_key: "[redacted]", name: "Ada" });
    expect(isSuppressionRequest("Please unsubscribe me")).toBe(true);
    expect(isSuppressionRequest("Can we meet Tuesday?")).toBe(false);
  });

  it("stops on provider restrictions", () => {
    expect(classifyProviderFailure(429, "rate limit")).toBe("rate_limit");
    expect(isPermanentProviderFailure("quota")).toBe(true);
    expect(isPermanentProviderFailure("transient")).toBe(false);
    expect(() => sanitizeOutbound({ to: "not-an-email", from: "a@b.co", subject: "Hi", text: "Hello" })).toThrow();
  });

  it("ranks roles on the server", () => {
    expect(roleAtLeast("ADMIN", "MEMBER")).toBe(true);
    expect(roleAtLeast("MEMBER", "ADMIN")).toBe(false);
  });
});

describe("research and ai parsing", () => {
  it("extracts observable page signals without inventing a person", () => {
    const page = extractPage(
      `<html><head><title>Acme</title><meta name="description" content="Book a viewing"></head><body><h1>Sales</h1><a href="mailto:info@acme.example">Email</a><script src="https://js.stripe.com/v3"></script><form></form></body></html>`,
      "https://acme.example",
    );
    expect(page.title).toBe("Acme");
    expect(page.signals.emails).toContain("info@acme.example");
    expect(page.signals.technology).toContain("Stripe");
    expect(page.signals.forms).toBe(1);
  });

  it("parses fenced model json", () => {
    const parsed = companyAnalysisSchema.parse(
      extractJsonObject(`\`\`\`json
      {"summary":"Public site offers viewings.","painPoints":["Booking is a form"],"opportunityScore":61,"opportunityReason":"A form is the only path.","recommendedService":"Booking workflow","personalizationAngle":"The viewing form","suggestedOpening":"The viewing form is the only next step.","software":{"score":60,"interpretation":"Manual form","confidence":55,"evidence":["form"]},"advertising":{"score":20,"interpretation":"No ad pixel observed","confidence":40,"evidence":["no pixel"]},"automation":{"score":50,"interpretation":"Manual enquiry","confidence":45,"evidence":["form"]}}
      \`\`\``),
    );
    expect(parsed.opportunityScore).toBe(61);
  });
});

function restore(key: string, value: string | undefined) {
  if (value == null) delete process.env[key];
  else process.env[key] = value;
}

describe("product layers", () => {
  it("reports unconfigured providers and refuses to call them", async () => {
    const saved = {
      deepseek: process.env.DEEPSEEK_API_KEY,
      resend: process.env.RESEND_API_KEY,
      google: process.env.GOOGLE_CSE_API_KEY,
      gmail: process.env.GMAIL_CLIENT_ID,
    };
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.RESEND_API_KEY;
    delete process.env.GOOGLE_CSE_API_KEY;
    delete process.env.GMAIL_CLIENT_ID;
    const status = credentialStatus();
    expect(status.deepseek).toBe("not_configured");
    expect(status.googleSearch).toBe("not_configured");
    expect(integrationLabel(status.resend)).toBe("Not configured");
    expect(aiConfigured()).toBe(false);
    await expect(new ResendProvider().getDeliveryStatus("msg")).rejects.toThrow(/not configured/i);
    restore("DEEPSEEK_API_KEY", saved.deepseek);
    restore("RESEND_API_KEY", saved.resend);
    restore("GOOGLE_CSE_API_KEY", saved.google);
    restore("GMAIL_CLIENT_ID", saved.gmail);
  });

  it("keeps a record inside its organization", () => {
    expect(belongsToOrganization({ organizationId: "org-a" }, "org-a")).toBe(true);
    expect(belongsToOrganization({ organizationId: "org-a" }, "org-b")).toBe(false);
    expect(belongsToOrganization(null, "org-a")).toBe(false);
  });

  it("marks the health check down when the database is down", () => {
    expect(healthDecision("up", "up", false).status).toBe(200);
    expect(healthDecision("down", "up", false).body.database).toBe("down");
    expect(healthDecision("up", "down", true).status).toBe(503);
  });

  it("registers the worker queues", () => {
    expect(QUEUE_NAMES).toContain("discovery");
    expect(QUEUE_NAMES).toContain("outreach");
  });

  it("keeps real email sending off unless it is explicitly enabled", () => {
    const saved = process.env.OUTREACH_SEND_ENABLED;
    delete process.env.OUTREACH_SEND_ENABLED;
    expect(outreachSendingEnabled()).toBe(false);
    process.env.OUTREACH_SEND_ENABLED = "false";
    expect(outreachSendingEnabled()).toBe(false);
    process.env.OUTREACH_SEND_ENABLED = "true";
    expect(outreachSendingEnabled()).toBe(true);
    restore("OUTREACH_SEND_ENABLED", saved);
  });

  it("reports configured providers from present credentials without calling them", () => {
    const saved = {
      deepseek: process.env.DEEPSEEK_API_KEY,
      resend: process.env.RESEND_API_KEY,
      googleKey: process.env.GOOGLE_CSE_API_KEY,
      googleCx: process.env.GOOGLE_CSE_CX,
      gmailId: process.env.GMAIL_CLIENT_ID,
      gmailSecret: process.env.GMAIL_CLIENT_SECRET,
      gmailRedirect: process.env.GMAIL_REDIRECT_URI,
    };
    process.env.DEEPSEEK_API_KEY = "test-deepseek";
    process.env.RESEND_API_KEY = "test-resend";
    process.env.GOOGLE_CSE_API_KEY = "test-google";
    process.env.GOOGLE_CSE_CX = "test-cx";
    process.env.GMAIL_CLIENT_ID = "test-gmail-id";
    process.env.GMAIL_CLIENT_SECRET = "test-gmail-secret";
    process.env.GMAIL_REDIRECT_URI = "https://leadpilot.live/api/integrations/gmail/callback";
    const status = credentialStatus();
    expect(status.deepseek).toBe("connected");
    expect(status.resend).toBe("connected");
    expect(status.googleSearch).toBe("connected");
    expect(status.gmail).toBe("needs_authentication");
    expect(aiConfigured()).toBe(true);
    restore("DEEPSEEK_API_KEY", saved.deepseek);
    restore("RESEND_API_KEY", saved.resend);
    restore("GOOGLE_CSE_API_KEY", saved.googleKey);
    restore("GOOGLE_CSE_CX", saved.googleCx);
    restore("GMAIL_CLIENT_ID", saved.gmailId);
    restore("GMAIL_CLIENT_SECRET", saved.gmailSecret);
    restore("GMAIL_REDIRECT_URI", saved.gmailRedirect);
  });

  it("classifies a Google IP denial without keeping the key", () => {
    expect(IPV4_FAMILY).toBe(4);
    const described = describeGoogleDenial(
      JSON.stringify({
        error: {
          status: "PERMISSION_DENIED",
          message: "The provided API key has an IP address restriction. The originating IP address of the call (203.0.113.5) violates this restriction.",
          errors: [{ reason: "forbidden", message: "blocked for AIzaSyTESTKEYshouldNotRemain" }],
        },
      }),
    );
    expect(described.startsWith("API key restriction")).toBe(true);
    expect(described).toContain("203.0.113.5");
    expect(described).not.toContain("AIza");
  });

  it("keeps a city discovery query small", () => {
    const queries = buildDiscoveryQueries({
      industry: "Real Estate",
      city: "Johannesburg",
      country: "South Africa",
      searchTerms: "real estate agencies",
    });
    expect(queries.length).toBeLessThanOrEqual(2);
    expect(queries[0]).toContain("Johannesburg");
    expect(queries[0]).toContain("South Africa");
  });
});
