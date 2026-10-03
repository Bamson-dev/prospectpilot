import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { GmailProvider } from "@/lib/email/gmail";
import { decryptSecret } from "@/lib/crypto";

export async function processApprovedEmployerReplies() {
  if (process.env.GMAIL_SEND_ENABLED !== "true") {
    return;
  }

  // Find one approved reply at a time to ensure idempotency and limit concurrency
  const reply = await prisma.$transaction(async (tx) => {
    const r = await tx.employerReply.findFirst({
      where: { draftStatus: "APPROVED", suggestedDraft: { not: null } },
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

    // Optimistically lock it to SENDING so other workers don't grab it
    return await tx.employerReply.update({
      where: { id: r.id },
      data: { draftStatus: "SENDING" },
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

  if (!reply) return;

  const emailAccount = reply.application.organization.emailAccounts[0];
  if (!emailAccount || !emailAccount.refreshTokenEncrypted) {
    await prisma.employerReply.update({
      where: { id: reply.id },
      data: { draftStatus: "FAILED" }
    });
    return;
  }

  try {
    const provider = new GmailProvider(decryptSecret(emailAccount.refreshTokenEncrypted));
    const result = await provider.sendEmail({
      to: reply.fromEmail,
      from: emailAccount.fromEmail,
      fromName: `${reply.application.candidate.firstName} ${reply.application.candidate.lastName}`,
      subject: `Re: ${reply.subject || reply.application.vacancy.title}`,
      text: reply.suggestedDraft!,
    });

    await prisma.$transaction([
      prisma.employerReply.update({
        where: { id: reply.id },
        data: { draftStatus: "SENT" }
      }),
      prisma.emailAccount.update({
        where: { id: emailAccount.id },
        data: { lastSendAt: new Date() }
      }),
      prisma.applicationEvent.create({
        data: {
          applicationId: reply.applicationId,
          type: "EMPLOYER_REPLY_SENT" as any,
          detail: `Sent reply to ${reply.fromEmail} (Message ID: ${result.providerMessageId})`
        }
      })
    ]);
  } catch (error) {
    // If sending fails, we revert to APPROVED (or FAILED depending on retry policy).
    // Let's mark as FAILED to require manual intervention rather than infinite retry loop.
    await prisma.employerReply.update({
      where: { id: reply.id },
      data: { draftStatus: "FAILED" }
    });
  }
}
