"use server";

import { redirect } from "next/navigation";
import type { CareerProfileKind, EvidenceChange, EvidenceVerification, FactCategory, FactSourceType } from "@prisma/client";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { ensureCandidate } from "@/lib/applications/service";
import {
  CAREER_PROFILES,
  EVIDENCE_TYPES,
  confirmEvidence,
  explicitProjectTechnologies,
  historyDetail,
  parseEvidenceImport,
  planEvidenceWrite,
  rejectEvidence,
  storageFor,
  toEvidenceRecord,
  type EvidenceDraft,
  type EvidenceType,
} from "@/lib/applications/evidence-management";

function back(error?: string, notice?: string): never {
  const params = new URLSearchParams();
  if (error) params.set("error", error.slice(0, 240));
  if (notice) params.set("notice", notice.slice(0, 240));
  redirect(`/jobs/candidate/evidence?${params.toString()}`);
}

async function candidateForOrg() {
  const { organization } = await requireOrganization("MEMBER");
  return ensureCandidate(organization.id);
}

async function recordsFor(candidateId: string) {
  const facts = await prisma.candidateFact.findMany({ where: { candidateId } });
  return facts.map((fact) => toEvidenceRecord(fact));
}

async function recordChange(candidateId: string, factId: string | null, action: EvidenceChange, claim: string) {
  await prisma.candidateFactEvent.create({
    data: { candidateId, factId, action, detail: historyDetail(action, claim) },
  });
}

function draftFromForm(formData: FormData): EvidenceDraft | { error: string } {
  const type = String(formData.get("type") ?? "");
  if (!(EVIDENCE_TYPES as readonly string[]).includes(type)) return { error: "Unknown evidence type." };
  const verification = String(formData.get("verification") ?? "UNVERIFIED");
  if (verification !== "VERIFIED" && verification !== "REVIEW_REQUIRED" && verification !== "UNVERIFIED") {
    return { error: "Choose verified, review required, or unverified. Imports use confirm and reject." };
  }
  const profiles = formData.getAll("profiles").map(String).filter((profile): profile is (typeof CAREER_PROFILES)[number] => (CAREER_PROFILES as readonly string[]).includes(profile));
  return {
    claim: String(formData.get("claim") ?? ""),
    type: type as EvidenceType,
    source: String(formData.get("source") ?? ""),
    origin: "CANDIDATE_ENTERED",
    verification,
    profiles,
    duration: String(formData.get("duration") ?? "") || null,
  };
}

function factData(draft: EvidenceDraft) {
  const stored = storageFor(draft.type);
  const verified = draft.verification === "VERIFIED";
  return {
    fact: draft.claim,
    source: draft.source,
    sourceType: "CANDIDATE_ENTERED" as FactSourceType,
    category: stored.category as FactCategory,
    subcategory: stored.subcategory,
    verified,
    verification: draft.verification as EvidenceVerification,
    duration: draft.duration,
    profiles: draft.profiles as CareerProfileKind[],
    technologies: stored.category === "TECHNOLOGY" ? [draft.claim] : [],
    confidence: verified ? 100 : 20,
  };
}

export async function saveEvidence(formData: FormData) {
  const candidate = await candidateForOrg();
  const draft = draftFromForm(formData);
  if ("error" in draft) back(draft.error);
  const records = await recordsFor(candidate.id);
  const plan = planEvidenceWrite(records, draft);
  if (plan.action === "reject") back(plan.reason);
  if (plan.action === "conflict") {
    await recordChange(candidate.id, plan.existingId, "UPDATED", plan.reason);
    back(plan.reason);
  }
  if (plan.action === "create") {
    const created = await prisma.candidateFact.create({ data: { candidateId: candidate.id, ...factData(plan.draft) } });
    await recordChange(candidate.id, created.id, "CREATED", plan.draft.claim);
    back(undefined, "Evidence saved.");
  }
  await prisma.candidateFact.update({ where: { id: plan.existingId }, data: factData(plan.draft) });
  await recordChange(candidate.id, plan.existingId, plan.replaced ? "REPLACED" : "UPDATED", plan.draft.claim);
  if (plan.verificationChanged) await recordChange(candidate.id, plan.existingId, "VERIFICATION_CHANGED", plan.draft.claim);
  if (plan.profilesChanged) await recordChange(candidate.id, plan.existingId, "PROFILE_ASSIGNMENT_CHANGED", plan.draft.claim);
  back(undefined, "Evidence updated.");
}

export async function removeEvidence(formData: FormData) {
  const candidate = await candidateForOrg();
  const id = String(formData.get("id") ?? "");
  const fact = await prisma.candidateFact.findFirst({ where: { id, candidateId: candidate.id } });
  if (!fact) back("Evidence was not found.");
  await prisma.candidateFact.delete({ where: { id: fact.id } });
  await recordChange(candidate.id, null, "REMOVED", fact.fact);
  back(undefined, "Evidence removed.");
}

export async function confirmEvidenceItem(formData: FormData) {
  const candidate = await candidateForOrg();
  const fact = await prisma.candidateFact.findFirst({ where: { id: String(formData.get("id") ?? ""), candidateId: candidate.id } });
  if (!fact) back("Evidence was not found.");
  const next = confirmEvidence(toEvidenceRecord(fact));
  if (!next) back("This evidence cannot be confirmed.");
  await prisma.candidateFact.update({ where: { id: fact.id }, data: { verification: next, verified: true, confidence: 100 } });
  await recordChange(candidate.id, fact.id, "VERIFICATION_CHANGED", fact.fact);
  back(undefined, "Evidence confirmed.");
}

export async function rejectEvidenceItem(formData: FormData) {
  const candidate = await candidateForOrg();
  const fact = await prisma.candidateFact.findFirst({ where: { id: String(formData.get("id") ?? ""), candidateId: candidate.id } });
  if (!fact) back("Evidence was not found.");
  const next = rejectEvidence(toEvidenceRecord(fact));
  if (!next) back("This evidence is already rejected.");
  await prisma.candidateFact.update({ where: { id: fact.id }, data: { verification: next, verified: false, confidence: 0 } });
  await recordChange(candidate.id, fact.id, "VERIFICATION_CHANGED", fact.fact);
  back(undefined, "Evidence rejected.");
}

export async function importEvidence(formData: FormData) {
  const candidate = await candidateForOrg();
  const parsed = parseEvidenceImport(String(formData.get("import") ?? ""));
  if (!parsed.items.length) back(parsed.errors[0] ?? "Nothing was imported.");
  let saved = 0;
  let conflicts = 0;
  for (const item of parsed.items) {
    const records = await recordsFor(candidate.id);
    const plan = planEvidenceWrite(records, item);
    if (plan.action === "conflict") {
      conflicts += 1;
      await recordChange(candidate.id, plan.existingId, "UPDATED", plan.reason);
      continue;
    }
    if (plan.action !== "create" && plan.action !== "update") continue;
    if (plan.action === "create") {
      const created = await prisma.candidateFact.create({ data: { candidateId: candidate.id, ...factData(plan.draft) } });
      await recordChange(candidate.id, created.id, "CREATED", plan.draft.claim);
    } else {
      await prisma.candidateFact.update({ where: { id: plan.existingId }, data: factData(plan.draft) });
      await recordChange(candidate.id, plan.existingId, "UPDATED", plan.draft.claim);
    }
    saved += 1;
  }
  const error = parsed.errors[0];
  back(error, `Imported ${saved} item${saved === 1 ? "" : "s"} for review.${conflicts ? ` ${conflicts} verified item${conflicts === 1 ? "" : "s"} left unchanged.` : ""}`);
}

export async function promoteProjectTechnologies(formData: FormData) {
  const candidate = await candidateForOrg();
  const project = await prisma.candidateProject.findFirst({ where: { id: String(formData.get("id") ?? ""), candidateId: candidate.id } });
  if (!project) back("Project was not found.");
  const names = explicitProjectTechnologies(project);
  if (!names.length) back("This project has no explicitly listed technologies to confirm.");
  let saved = 0;
  for (const name of names) {
    const records = await recordsFor(candidate.id);
    const plan = planEvidenceWrite(records, {
      claim: name,
      type: "TECHNOLOGY",
      source: project.name,
      origin: "CANDIDATE_ENTERED",
      verification: "VERIFIED",
      profiles: project.profiles,
      duration: null,
    });
    if (plan.action === "reject" || plan.action === "conflict") continue;
    if (plan.action === "create") {
      const created = await prisma.candidateFact.create({ data: { candidateId: candidate.id, ...factData(plan.draft) } });
      await recordChange(candidate.id, created.id, "CREATED", name);
    } else {
      await prisma.candidateFact.update({ where: { id: plan.existingId }, data: factData(plan.draft) });
      await recordChange(candidate.id, plan.existingId, "REPLACED", name);
    }
    saved += 1;
  }
  back(undefined, saved ? `${saved} project technolog${saved === 1 ? "y" : "ies"} saved as verified evidence.` : "No new technology evidence was saved.");
}
