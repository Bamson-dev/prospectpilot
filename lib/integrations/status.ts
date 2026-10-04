export type IntegrationState = "connected" | "not_configured" | "needs_authentication" | "error" | "disabled";

export type CredentialFlags = {
  googleSearch: IntegrationState;
  deepseek: IntegrationState;
  resend: IntegrationState;
  gmail: IntegrationState;
};

export function credentialStatus(accounts: Array<{ provider: "RESEND" | "GMAIL"; status: string }> = []): CredentialFlags {
  const gmailAccount = accounts.find((account) => account.provider === "GMAIL");
  const resendAccount = accounts.find((account) => account.provider === "RESEND");
  const gmailReady = Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REDIRECT_URI);
  return {
    googleSearch: process.env.GOOGLE_CSE_ENABLED === "true"
      ? (String(process.env.GOOGLE_CSE_API_KEY || "") && String(process.env.GOOGLE_CSE_CX || "") ? "connected" : "not_configured")
      : "disabled",
    deepseek: String(process.env.DEEPSEEK_API_KEY || "").trim() ? "connected" : "not_configured",
    resend: !String(process.env.RESEND_API_KEY || "").trim()
      ? "not_configured"
      : resendAccount?.status === "ERROR" || resendAccount?.status === "RESTRICTED"
        ? "error"
        : "connected",
    gmail: !gmailReady
      ? "not_configured"
      : gmailAccount?.status === "ERROR" || gmailAccount?.status === "RESTRICTED"
        ? "error"
        : gmailAccount
          ? "connected"
          : "needs_authentication",
  };
}

export function integrationLabel(state: IntegrationState) {
  if (state === "connected") return "Connected";
  if (state === "needs_authentication") return "Needs authentication";
  if (state === "error") return "Error";
  if (state === "disabled") return "Disabled";
  return "Not configured";
}
