"use server";

import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { canApproveOutreach, canDismissOutreach } from "@/lib/email/message-policy";
import { outreachSendingEnabled } from "@/lib/email/send-gate";
import { AppError, errorMessage } from "@/lib/errors";
import { queueJob, recordActivity } from "@/lib/jobs";

async function ownedMessage(id: string, organizationId: string) {
  const message = await prisma.outreachMessage.findFirst({
    where: { id, organizationId },
    include: { campaign: true },
  });
  if (!message) throw new AppError("Message not found.");
  return message;
}

export async function approveOutreach(formData: FormData) {
  const { organization } = await requireOrganization();
  const id = String(formData.get("id"));
  try {
    const message = await ownedMessage(id, organization.id);
    if (!canApproveOutreach(message.state)) throw new AppError("Only a message waiting for approval can be approved.");
    const sending = outreachSendingEnabled();
    if (sending && (!message.campaign || message.campaign.status === "PAUSED" || message.campaign.status === "ARCHIVED")) {
      throw new AppError("The campaign is not allowed to send.");
    }
    const contact = message.contactId
      ? await prisma.contact.findFirst({ where: { id: message.contactId, organizationId: organization.id } })
      : null;
    if (contact?.suppressed || (contact?.email && await prisma.suppression.findUnique({ where: { organizationId_email: { organizationId: organization.id, email: contact.email } } }))) {
      await prisma.outreachMessage.updateMany({
        where: { id, organizationId: organization.id, state: "PENDING_APPROVAL" },
        data: { state: "SUPPRESSED", error: "Suppressed before sending." },
      });
      throw new AppError("This contact is suppressed and cannot enter the outreach queue.");
    }
    const subject = String(formData.get("subject") ?? message.subject).trim().slice(0, 160);
    const body = String(formData.get("body") ?? message.body).trim().slice(0, 4000);
    if (!subject || !body) throw new AppError("Subject and body are required.");
    if (!contact?.email) throw new AppError("Add a contact email before this message can be approved.");
    const approval = await prisma.outreachMessage.updateMany({
      where: { id, organizationId: organization.id, state: "PENDING_APPROVAL" },
      data: { subject, body, state: "APPROVED" },
    });
    if (approval.count !== 1) throw new AppError("This message changed before it could be approved.");
    await prisma.prospect.update({
      where: { id: message.prospectId },
      data: { qualificationStatus: "APPROVED", outreachState: sending ? "QUEUED" : "APPROVED" },
    });
    if (sending) {
      await queueJob({
        organizationId: organization.id,
        campaignId: message.campaignId,
        prospectId: message.prospectId,
        queue: "outreach",
        name: "outreach.send",
        payload: { messageId: id },
      });
    }
    await recordActivity({
      organizationId: organization.id,
      campaignId: message.campaignId,
      prospectId: message.prospectId,
      action: "outreach.approved",
      detail: sending ? null : "Sending is turned off.",
    });
  } catch (error) {
    redirect(`/outreach?error=${encodeURIComponent(errorMessage(error))}`);
  }
  redirect(
    outreachSendingEnabled()
      ? "/outreach?notice=Approved+and+queued.+It+will+not+send+until+the+worker+and+email+provider+are+available."
      : "/outreach?notice=Approved.+Sending+is+turned+off,+so+no+email+was+queued.",
  );
}

export async function rejectOutreach(formData: FormData) {
  const { organization } = await requireOrganization();
  const id = String(formData.get("id"));
  const message = await prisma.outreachMessage.findFirst({ where: { id, organizationId: organization.id } });
  if (!message) redirect("/outreach?error=Message+not+found.");
  if (!canDismissOutreach(message.state)) redirect("/outreach?error=A+sent+message+cannot+be+rejected.");
  const dismissal = await prisma.outreachMessage.updateMany({ where: { id, organizationId: organization.id, state: message.state }, data: { state: "CANCELLED", error: "Rejected by a reviewer." } });
  if (dismissal.count !== 1) redirect("/outreach?error=This+message+changed+before+it+could+be+rejected.");
  await prisma.prospect.update({ where: { id: message.prospectId }, data: { qualificationStatus: "REJECTED", outreachState: "CANCELLED" } });
  await recordActivity({ organizationId: organization.id, prospectId: message.prospectId, action: "outreach.rejected" });
  redirect("/outreach?notice=Prospect+rejected.");
}

export async function skipOutreach(formData: FormData) {
  const { organization } = await requireOrganization();
  const id = String(formData.get("id"));
  const message = await prisma.outreachMessage.findFirst({ where: { id, organizationId: organization.id } });
  if (!message) redirect("/outreach?error=Message+not+found.");
  if (!canDismissOutreach(message.state)) redirect("/outreach?error=A+sent+message+cannot+be+skipped.");
  const dismissal = await prisma.outreachMessage.updateMany({ where: { id, organizationId: organization.id, state: message.state }, data: { state: "DRAFT" } });
  if (dismissal.count !== 1) redirect("/outreach?error=This+message+changed+before+it+could+be+skipped.");
  await prisma.prospect.update({ where: { id: message.prospectId }, data: { qualificationStatus: "SKIPPED", outreachState: "DRAFT" } });
  redirect("/outreach?notice=Skipped.");
}

export async function approveFollowUp(formData: FormData) {
  const { organization } = await requireOrganization();
  const id = String(formData.get("id"));
  const followUp = await prisma.followUp.findFirst({ where: { id, organizationId: organization.id } });
  if (!followUp) redirect("/follow-ups?error=Follow-up+not+found.");
  const runAt = new Date(Date.now() + followUp.dayOffset * 24 * 60 * 60 * 1000);
  await prisma.followUp.update({ where: { id }, data: { state: "SCHEDULED", runAt, subject: String(formData.get("subject") ?? followUp.subject).slice(0, 160), body: String(formData.get("body") ?? followUp.body).slice(0, 4000) } });
  redirect("/follow-ups?notice=Follow-up+scheduled.");
}

export async function queueSuggestedReply(formData: FormData) {
  const { organization } = await requireOrganization();
  const replyId = String(formData.get("replyId"));
  const reply = await prisma.reply.findFirst({ where: { id: replyId, organizationId: organization.id }, include: { conversation: true } });
  if (!reply?.suggestedBody || !reply.suggestedSubject) redirect(`/inbox/${reply?.conversationId ?? ""}?error=There+is+no+suggested+reply+yet.`);
  const contact = reply.contactId ? await prisma.contact.findFirst({ where: { id: reply.contactId, organizationId: organization.id } }) : null;
  const message = await prisma.outreachMessage.create({
    data: {
      organizationId: organization.id,
      prospectId: reply.prospectId,
      contactId: contact?.id,
      conversationId: reply.conversationId,
      subject: String(formData.get("subject") ?? reply.suggestedSubject).slice(0, 160),
      body: String(formData.get("body") ?? reply.suggestedBody).slice(0, 4000),
      state: "PENDING_APPROVAL",
    },
  });
  await recordActivity({ organizationId: organization.id, prospectId: reply.prospectId, action: "reply.drafted", detail: message.id });
  redirect(`/outreach?notice=Suggested+reply+is+waiting+for+approval.`);
}

export async function saveOutreachDraft(formData: FormData) {
  const { organization, user } = await requireOrganization();
  const prospectId = String(formData.get("prospectId") ?? "");
  const prospect = await prisma.prospect.findFirst({ where: { id: prospectId, organizationId: organization.id }, include: { contacts: { where: { isPrimary: true }, take: 1 } } });
  if (!prospect) redirect("/outreach?error=Prospect+not+found.");
  const subject = String(formData.get("subject") ?? "").trim().slice(0, 160);
  const body = String(formData.get("body") ?? "").trim().slice(0, 4000);
  if (!subject || !body) redirect(`/prospects/${prospectId}?section=outreach&error=Subject+and+body+are+required.`);
  const contact = prospect.contacts[0] ?? null;
  if (contact?.email) {
    const suppressed = contact.suppressed || await prisma.suppression.findUnique({ where: { organizationId_email: { organizationId: organization.id, email: contact.email } } });
    if (suppressed) redirect(`/prospects/${prospectId}?section=outreach&error=That+contact+is+suppressed.+The+draft+was+not+queued.`);
  }
  const message = await prisma.outreachMessage.create({
    data: {
      organizationId: organization.id,
      campaignId: prospect.campaignId,
      prospectId: prospect.id,
      contactId: contact?.id,
      subject,
      body,
      state: "DRAFT",
    },
  });
  await prisma.prospect.update({ where: { id: prospect.id }, data: { outreachState: "DRAFT" } });
  await recordActivity({ organizationId: organization.id, campaignId: prospect.campaignId, prospectId: prospect.id, contactId: contact?.id, userId: user.id, action: "email.drafted", detail: message.id });
  redirect(`/outreach?status=DRAFT&notice=Draft+saved.+It+will+not+send+until+someone+approves+it.`);
}

export async function submitDraftForApproval(formData: FormData) {
  const { organization, user } = await requireOrganization();
  const id = String(formData.get("id"));
  const message = await prisma.outreachMessage.findFirst({ where: { id, organizationId: organization.id }, include: { contact: true } });
  if (!message || message.state !== "DRAFT") redirect("/outreach?error=Only+a+saved+draft+can+be+submitted.");
  if (message.contact?.suppressed) redirect("/outreach?error=That+contact+is+suppressed.");
  const subject = String(formData.get("subject") ?? message.subject).trim().slice(0, 160);
  const body = String(formData.get("body") ?? message.body).trim().slice(0, 4000);
  await prisma.outreachMessage.update({ where: { id }, data: { subject, body, state: "PENDING_APPROVAL" } });
  await prisma.prospect.update({ where: { id: message.prospectId }, data: { outreachState: "PENDING_APPROVAL" } });
  await recordActivity({ organizationId: organization.id, prospectId: message.prospectId, userId: user.id, action: "email.submitted", detail: id });
  redirect("/outreach?status=PENDING_APPROVAL&notice=Draft+is+waiting+for+approval.+Nothing+has+been+sent.");
}

export async function syncInbox() {
  const { organization } = await requireOrganization();
  try {
    await queueJob({ organizationId: organization.id, queue: "inbox-sync", name: "inbox.sync" });
  } catch (error) {
    redirect(`/inbox?error=${encodeURIComponent(errorMessage(error))}`);
  }
  redirect("/inbox?notice=Inbox+sync+queued.");
}

export async function saveResendSender(formData: FormData) {
  const { organization } = await requireOrganization("ADMIN");
  const fromEmail = String(formData.get("fromEmail") ?? "").trim().toLowerCase();
  const fromName = String(formData.get("fromName") ?? "").trim().slice(0, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) redirect("/integrations?error=Enter+a+valid+sender+email.");
  await prisma.emailAccount.create({
    data: { organizationId: organization.id, provider: "RESEND", fromEmail, fromName: fromName || null },
  });
  redirect("/integrations?notice=Resend+sender+saved.+The+API+key+stays+in+the+server+environment.");
}
