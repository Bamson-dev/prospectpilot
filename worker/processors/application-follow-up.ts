import { prisma } from "@/lib/db";
import { completeJson } from "@/lib/ai/client";
import { GmailProvider } from "@/lib/email/gmail";
import { decryptSecret } from "@/lib/crypto";

export async function generateApplicationFollowUpDrafts() {
  const followUps = await prisma.applicationFollowUp.findMany({
    where: { 
      status: "DRAFT",
      runAt: { lte: new Date() }
    },
    include: {
      application: {
        include: { vacancy: true, candidate: { include: { facts: true } } }
      }
    }
  });

  for (const followUp of followUps) {
    // Verify application is still active (no replies yet)
    const repliesCount = await prisma.employerReply.count({
      where: { applicationId: followUp.applicationId }
    });

    if (repliesCount > 0) {
      await prisma.applicationFollowUp.update({
        where: { id: followUp.id },
        data: { status: "CANCELLED" } // Cancel follow-up if employer replied
      });
      continue;
    }

    const candidateFacts = followUp.application.candidate.facts.map(f => f.text);
    const candidateName = `${followUp.application.candidate.firstName} ${followUp.application.candidate.lastName}`;
    const vacancyTitle = followUp.application.vacancy.title;
    const companyName = followUp.application.vacancy.companyName;

    const prompt = `You are a recruitment assistant drafting a follow-up email for a candidate named ${candidateName}.
They applied for the "${vacancyTitle}" position at "${companyName}".
It has been several days with no response.

Draft a short, professional, and natural follow-up email asking about the status of the application.
DO NOT use boilerplate like "Just following up on my previous email" or "I am writing to...".
Keep it very brief (1-3 sentences maximum).

Candidate Facts (Use sparingly if needed, DO NOT INVENT):
${candidateFacts.map(f => `- ${f}`).join("\n")}

Return JSON format:
{
  "draft": "..."
}`;

    const response = await completeJson([
      { role: "system", content: "You strictly output valid JSON matching the requested schema." },
      { role: "user", content: prompt }
    ]);

    try {
      const data = JSON.parse(response.content) as { draft: string };
      if (data.draft) {
        await prisma.applicationFollowUp.update({
          where: { id: followUp.id },
          data: { 
            draft: data.draft,
            status: "PENDING_APPROVAL" 
          }
        });
      }
    } catch {
      // ignore parse error, retry later
    }
  }
}

export async function processApprovedApplicationFollowUps() {
  if (process.env.GMAIL_SEND_ENABLED !== "true") {
    return;
  }

  const followUp = await prisma.$transaction(async (tx) => {
    const r = await tx.applicationFollowUp.findFirst({
      where: { status: "APPROVED" },
      include: {
        application: {
          include: {
            vacancy: true,
            candidate: true,
            organization: {
              include: {
                emailAccounts: {
                  where: { provider: "GMAIL", status: "ACTIVE" }
                }
              }
            }
          }
        }
      }
    });

    if (!r) return null;

    return await tx.applicationFollowUp.update({
      where: { id: r.id },
      data: { status: "SENDING" },
      include: {
        application: {
          include: {
            vacancy: true,
            candidate: true,
            organization: {
              include: {
                emailAccounts: {
                  where: { provider: "GMAIL", status: "ACTIVE" }
                }
              }
            }
          }
        }
      }
    });
  });

  if (!followUp) return;

  const emailAccount = followUp.application.organization.emailAccounts[0];
  if (!emailAccount || !emailAccount.refreshTokenEncrypted) {
    await prisma.applicationFollowUp.update({
      where: { id: followUp.id },
      data: { status: "FAILED" }
    });
    return;
  }

  try {
    const provider = new GmailProvider(decryptSecret(emailAccount.refreshTokenEncrypted));
    
    if (!followUp.channel || !followUp.channel.includes("@")) {
      throw new Error("Invalid recipient email for follow up.");
    }

    const result = await provider.sendEmail({
      to: followUp.channel,
      from: emailAccount.fromEmail,
      fromName: `${followUp.application.candidate.firstName} ${followUp.application.candidate.lastName}`,
      subject: `Application Follow-up: ${followUp.application.vacancy.title}`,
      text: followUp.draft,
    });

    await prisma.$transaction([
      prisma.applicationFollowUp.update({
        where: { id: followUp.id },
        data: { status: "SENT" }
      }),
      prisma.emailAccount.update({
        where: { id: emailAccount.id },
        data: { lastSendAt: new Date() }
      }),
      prisma.applicationEvent.create({
        data: {
          applicationId: followUp.applicationId,
          type: "EMPLOYER_REPLY_SENT" as any, // Repurposed for outbound emails to employers
          detail: `Sent follow-up to ${followUp.channel} (Message ID: ${result.providerMessageId})`
        }
      })
    ]);
  } catch (error) {
    await prisma.applicationFollowUp.update({
      where: { id: followUp.id },
      data: { status: "FAILED" }
    });
  }
}
