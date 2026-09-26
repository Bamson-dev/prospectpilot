"use server";

import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { AppError, errorMessage } from "@/lib/errors";
import { queueJob, recordActivity } from "@/lib/jobs";

async function ownedMessage(id: string, organizationId: string) {
  const message = await prisma.outreachMessage.findFirst({ where: { id, organizationId } });
  if (!message) throw new AppError("Message not found.");
  return message;
}

export async function approveOutreach(formData: FormData) {
  const { organization } = await requireOrganization();
  const id = String(formData.get("id"));
  try {
    const message = await ownedMessage(id, organization.id);
    const subject = String(formData.get("subject") ?? message.subject).trim().slice(0, 160);
    const body = String(formData.get("body") ?? message.body).trim().slice(0, 4000);
    if (!subject || !body) throw new AppError("Subject and body are required.");
    await prisma.outreachMessage.update({ where: { id }, data: { subject, body, state: "APPROVED" } });
    await prisma.prospect.update({ where: { id: message.prospectId }, data: { qualificationStatus: "APPROVED", outreachState: "QUEUED" } });
    await queueJob({
      organizationId: organization.id,
      campaignId: message.campaignId,
      prospectId: message.prospectId,
      queue: "outreach",
      name: "outreach.send",
      payload: { messageId: id },
    });
    await recordActivity({ organizationId: organization.id, campaignId: message.campaignId, prospectId: message.prospectId, action: "outreach.approved" });
  } catch (error) {
    redirect(`/outreach?error=${encodeURIComponent(errorMessage(error))}`);
  }
  redirect("/outreach?notice=Approved+and+queued.+It+will+not+send+until+the+worker+and+email+provider+are+available.");
}

export async function rejectOutreach(formData: FormData) {
  const { organization } = await requireOrganization();
  const id = String(formData.get("id"));
  const message = await prisma.outreachMessage.findFirst({ where: { id, organizationId: organization.id } });
  if (!message) redirect("/outreach?error=Message+not+found.");
  await prisma.outreachMessage.update({ where: { id }, data: { state: "FAILED", error: "Rejected by a reviewer." } });
  await prisma.prospect.update({ where: { id: message.prospectId }, data: { qualificationStatus: "REJECTED", outreachState: "FAILED" } });
  await recordActivity({ organizationId: organization.id, prospectId: message.prospectId, action: "outreach.rejected" });
  redirect("/outreach?notice=Prospect+rejected.");
}

export async function skipOutreach(formData: FormData) {
  const { organization } = await requireOrganization();
  const id = String(formData.get("id"));
  const message = await prisma.outreachMessage.findFirst({ where: { id, organizationId: organization.id } });
  if (!message) redirect("/outreach?error=Message+not+found.");
  await prisma.outreachMessage.update({ where: { id }, data: { state: "DRAFT" } });
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
