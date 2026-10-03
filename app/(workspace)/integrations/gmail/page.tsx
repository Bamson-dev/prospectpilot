import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { gmailAuthUrl, GMAIL_STATE_PURPOSE } from "@/lib/email/gmail";
import { SignJWT } from "jose";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export default async function GmailIntegrationPage() {
  const { organization } = await requireOrganization();

  const emailAccounts = await prisma.emailAccount.findMany({
    where: { organizationId: organization.id, provider: "GMAIL" },
    take: 1
  });

  const isConfigured = !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REDIRECT_URI);
  const isConnected = emailAccounts.length > 0;

  let connectUrl = "";
  if (isConfigured && !isConnected) {
    const secret = process.env.AUTH_SECRET;
    if (secret) {
      try {
        const state = await new SignJWT({ purpose: GMAIL_STATE_PURPOSE, organizationId: organization.id })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(new TextEncoder().encode(secret));
        connectUrl = gmailAuthUrl(state);
      } catch {
        // ignore
      }
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Gmail Integration" detail="Connect your Gmail account to allow ProspectPilot to monitor employer replies and draft responses." />

      <Panel className="mt-8">
        <div className="flex flex-row justify-between items-start mb-4 border-b border-line pb-4">
          <div>
            <h2 className="text-xl font-display">Google Workspace / Gmail</h2>
            <p className="text-sm text-muted">OAuth Connection</p>
          </div>
          <Pill>
            {isConnected ? "CONNECTED" : isConfigured ? "NOT CONNECTED" : "NOT CONFIGURED"}
          </Pill>
        </div>
        
        <div className="text-sm text-muted space-y-4 mb-6">
          <p>When connected, ProspectPilot will:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Monitor incoming emails for employer replies.</li>
            <li>Automatically classify emails as interviews, rejections, or requests for information.</li>
            <li>Draft context-aware replies for your review.</li>
          </ul>
          {isConnected && emailAccounts[0] && (
            <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-900 rounded border border-line">
              <h3 className="font-medium text-ink mb-2">Connection Status</h3>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-muted block">Account</span>
                  <span className="font-medium">{emailAccounts[0].fromEmail}</span>
                </div>
                <div>
                  <span className="text-muted block">Status</span>
                  <span className={`font-medium ${emailAccounts[0].status === "ACTIVE" ? "text-green-600" : "text-red-600"}`}>
                    {emailAccounts[0].status}
                  </span>
                </div>
                <div>
                  <span className="text-muted block">Last Sync</span>
                  <span className="font-medium">
                    {emailAccounts[0].lastSyncAt ? new Date(emailAccounts[0].lastSyncAt).toLocaleString() : "Never"}
                  </span>
                </div>
                <div>
                  <span className="text-muted block">Last Send</span>
                  <span className="font-medium">
                    {emailAccounts[0].lastSendAt ? new Date(emailAccounts[0].lastSendAt).toLocaleString() : "Never"}
                  </span>
                </div>
              </div>
            </div>
          )}
          <p className="font-medium text-wine mt-4">
            ProspectPilot will NEVER send emails automatically without your explicit approval.
          </p>
        </div>
        
        <div className="pt-6 border-t border-line flex justify-between items-center">
          {!isConfigured ? (
            <p className="text-sm text-wine">
              Please configure GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in your .env file to enable this feature.
            </p>
          ) : isConnected ? (
            <form action={async () => {
              "use server";
              await prisma.emailAccount.deleteMany({ where: { organizationId: organization.id, provider: "GMAIL" } });
              redirect("/integrations/gmail");
            }}>
              <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-[#5a3030] px-4 py-2 text-sm font-medium text-white hover:bg-[#5a3030]/90 border-0">
                Disconnect Gmail
              </button>
            </form>
          ) : (
            <a href={connectUrl} className="inline-flex h-9 items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink/90">
              Connect Gmail
            </a>
          )}
        </div>
      </Panel>
    </div>
  );
}
