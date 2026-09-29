import { notFound } from "next/navigation";
import { decideApplication, enqueueApplicationPreparation, recordSubmissionConfirmation } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { validateCvFacts } from "@/lib/applications/claims";
import { applicationPreview } from "@/lib/applications/preview";
import { applicationReadinessReport } from "@/lib/applications/application-readiness";
import { pipelineState } from "@/lib/applications/state";
import type { CandidateRecord } from "@/lib/applications/types";
import { assessWriting } from "@/lib/applications/writing-quality";
import { validateCoverLetterForVacancy } from "@/lib/applications/document-check";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Application review" };

export default async function ApplicationReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { organization } = await requireOrganization();
  const { id } = await params;
  const query = await searchParams;
  const application = await prisma.jobApplication.findFirst({
    where: { id, organizationId: organization.id },
    include: {
      vacancy: { include: { requirements: true, fit: true } },
      package: true,
      answers: true,
      events: { orderBy: { createdAt: "desc" }, take: 30 },
      followUps: true,
      candidate: { include: { facts: true, projects: true, experiences: true } },
    },
  });
  if (!application) notFound();
  const documents = await prisma.generatedDocument.findMany({
    where: { organizationId: organization.id, vacancyId: application.vacancyId, archived: false },
    orderBy: { createdAt: "desc" },
  });
  const analysis = readAnalysis(application.vacancy.fit?.analysis);
  const cv = documents.find((document) => document.kind === "CV");
  const letter = documents.find((document) => document.kind === "COVER_LETTER");
  const candidateRecord = toCandidateRecord(application.candidate);
  const cvCheck = cv ? validateCvFacts(cv.text, candidateRecord, [application.vacancy.companyName, application.vacancy.title]) : { status: "NOT_GENERATED" as const, issues: [] };
  const letterWriting = letter ? assessWriting({ text: letter.text, jobDescription: application.vacancy.description }) : { status: "NOT_GENERATED" as const };
  const letterSpecificity = letter ? validateCoverLetterForVacancy({ text: letter.text, companyName: application.vacancy.companyName, title: application.vacancy.title }) : null;
  const letterValidation = !letter ? "NOT_GENERATED" : letterWriting.status === "REVIEW_REQUIRED" || letterSpecificity?.ok === false ? "REVIEW_REQUIRED" : "PASS";
  const storedAnswers = readResolvedAnswers(application.package?.timings, application.answers);
  const report = applicationReadinessReport({
    candidateName: application.candidate.fullName,
    jobTitle: application.vacancy.title,
    cvReady: Boolean(cv),
    coverLetterReady: Boolean(letter),
    contactReady: !application.candidate.email.endsWith("@invalid.test"),
    workAuthorization: application.candidate.workAuthorization,
    sponsorship: application.candidate.sponsorship,
    salary: application.answers.find((answer) => answer.kind === "SALARY")?.answer ?? null,
    salaryAsked: application.answers.some((answer) => answer.kind === "SALARY"),
    educationKnown: false,
    reviewQuestions: application.answers.filter((answer) => answer.status !== "ANSWERED").length,
    writing: letter ? assessWriting({ text: letter.text, jobDescription: application.vacancy.description }).status : "REVIEW_REQUIRED",
    facts: application.package?.warnings.some((warning) => /unsupported/i.test(warning)) ? "FAIL" : "PASS",
  });
  const preview = applicationPreview({
    company: application.vacancy.companyName,
    role: application.vacancy.title,
    resumeFileName: cv?.fileName ?? null,
    coverLetterFileName: letter?.fileName ?? null,
    captcha: false,
    authentication: false,
    fields: [
      fieldLine("Work authorization", application.candidate.workAuthorization),
      fieldLine("Sponsorship", application.candidate.sponsorship),
      ...application.answers.map((answer) => ({
        name: answer.question,
        classification: "CUSTOM_QUESTION" as const,
        taxonomy: "CUSTOM_QUESTION" as const,
        confidence: 1,
        required: answer.status !== "ANSWERED",
        status: answer.status === "ANSWERED" ? "ANSWERED" as const : "REVIEW_REQUIRED" as const,
        value: answer.answer,
        source: answer.status === "ANSWERED" ? "candidate" : null,
        reason: answer.status === "ANSWERED" ? null : "needs review",
      })),
    ],
  });
  return (
    <div>
      <PageHeader title={application.vacancy.title} detail={`${application.vacancy.companyName} · ${application.status}`} />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Job</h2>
        <p className="mt-2 text-sm">{application.vacancy.companyName} · {application.vacancy.title}</p>
        <p className="text-sm text-muted">{application.vacancy.location || "Location not listed"} · {application.vacancy.remoteType || "Remote policy not listed"} · {application.vacancy.employmentType || "Employment type not listed"}</p>
        <p className="text-sm text-muted">{salary(application.vacancy.salaryMin, application.vacancy.salaryMax, application.vacancy.salaryCurrency)}</p>
        <p className="mt-2 text-sm">Source {application.source}. <a className="text-tide" href={application.applicationUrl} target="_blank" rel="noreferrer">Open application URL</a></p>
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Readiness</h2>
        <p className="mt-2 text-sm">CV {report.cv}. Cover letter {report.coverLetter}. Contact {report.contact}. Work authorization {report.workAuthorization}. Salary {report.salary}.</p>
        <p className="text-sm">Writing {report.writing}. Facts {report.facts}. Questions {report.requiredQuestions} review-required. Security {report.security}. CAPTCHA {report.captcha}.</p>
        <p className="mt-2 text-sm">Decision {report.decision}. Pipeline {pipelineState(application.status)}. Package version {application.package?.version ?? 1}. Approval is separate from this status, and neither approval nor browser preparation submits the application.</p>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {report.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Application preview</h2>
        <pre className="mt-2 whitespace-pre-wrap text-sm">{preview.text}</pre>
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Fit</h2>
        <p className="mt-2 text-sm">Profile {application.profile}. Recommendation {application.vacancy.fit?.recommendation ?? "—"}.</p>
        <List title="Matched requirements" items={analysis?.requiredMatches} />
        <List title="Required gaps" items={analysis?.requiredGaps} />
        <List title="Preferred matches" items={analysis?.preferredMatches} />
        <List title="Preferred gaps" items={analysis?.preferredGaps} />
        <List title="Uncertain" items={analysis?.uncertain} />
        <List title="Blockers" items={analysis?.blockers} />
        <List title="Missing candidate information" items={analysis?.missingInformation} />
        {analysis?.evidence?.length ? analysis.evidence.map((item) => <p key={item.requirement} className="mt-2 text-sm">{item.requirement}: {item.fact}</p>) : null}
        {analysis?.selections?.length ? analysis.selections.map((item) => <p key={`${item.requirement}-${item.match}`} className="mt-2 text-sm">Requirement: {item.requirement}. Classification: {item.match}. Evidence: {item.evidence || "None"}. Reason: {item.reason || "No reason stored."}</p>) : null}
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">CV</h2>
        <p className="mt-2 text-sm">Status {cv ? "Stored" : "Missing"}. Version {cv?.version ?? "—"}. Validation {cv ? cvCheck.status : "NOT_GENERATED"}.</p>
        {documents.filter((document) => document.kind === "CV").map((document) => <p key={document.id} className="mt-2 text-sm">Version {document.version} · {document.createdAt.toISOString()} · {document.version === latestVersion(documents, "CV", document.fileType) ? pipelineState(application.status) : "SUPERSEDED"} · <a className="text-tide" href={`/api/jobs/documents/${document.id}`}>{document.fileName}</a></p>)}
        {!cv ? <p className="mt-2 text-sm text-muted">No CV stored. A placeholder email blocks document generation.</p> : null}
        {cvCheck.issues.map((issue) => <p key={`${issue.kind}-${issue.value}`} className="mt-2 text-sm">REVIEW REQUIRED · unsupported {issue.kind}: {issue.value}</p>)}
        {cv ? <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-sm">{cv.text.slice(0, 1200)}</pre> : null}
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Cover letter</h2>
        <p className="mt-2 text-sm">Status {letter ? "Stored" : "Missing"}. Version {letter?.version ?? "—"}. Validation {letterValidation}. {letterWriting.status === "REVIEW_REQUIRED" ? "Review reason: writing needs review." : ""}</p>
        {documents.filter((document) => document.kind === "COVER_LETTER").map((document) => <p key={document.id} className="mt-2 text-sm">Version {document.version} · {document.createdAt.toISOString()} · {document.version === latestVersion(documents, "COVER_LETTER", document.fileType) ? pipelineState(application.status) : "SUPERSEDED"} · <a className="text-tide" href={`/api/jobs/documents/${document.id}`}>{document.fileName}</a></p>)}
        {letter ? <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-sm">{letter.text.slice(0, 1200)}</pre> : <p className="mt-2 text-sm text-muted">No cover letter stored.</p>}
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Employer questions</h2>
        <p className="mt-2 text-sm">Answered {storedAnswers.filter((answer) => answer.reviewState === "ANSWERED").length}. Review required {storedAnswers.filter((answer) => answer.reviewState !== "ANSWERED").length}. Unresolved {storedAnswers.filter((answer) => !answer.answer).length}. Sensitive {storedAnswers.filter((answer) => /sensitive/i.test(answer.reason ?? "")).length}.</p>
        {storedAnswers.map((answer) => <p key={answer.question} className="mt-2 text-sm">{answer.question} · {answer.classification} · {answer.required ? "Required" : "Optional"} · {answer.reviewState} · {answer.source} · confidence {answer.confidence}{answer.answer ? ` · ${answer.answer.slice(0, 220)}` : ""}{answer.reason ? ` · ${answer.reason}` : ""}</p>)}
        <List title="Warnings" items={application.package?.warnings} />
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Approval</h2>
        <p className="mt-2 text-sm text-muted">Approve does not submit. Submission needs a separate confirmation, and this build still will not send the application.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={decideApplication}><input type="hidden" name="id" value={application.id} /><input type="hidden" name="decision" value="APPROVED" /><SubmitButton pendingLabel="Saving">Approve</SubmitButton></form>
          <form action={decideApplication}><input type="hidden" name="id" value={application.id} /><input type="hidden" name="decision" value="REJECTED" /><SubmitButton pendingLabel="Saving" variant="secondary">Reject</SubmitButton></form>
          <a className="inline-flex items-center rounded border border-line px-3 py-2 text-sm" href="/jobs/candidate">Edit</a>
          <form action={enqueueApplicationPreparation}><input type="hidden" name="vacancyId" value={application.vacancyId} /><input type="hidden" name="reprepare" value="on" /><SubmitButton pendingLabel="Queuing" variant="secondary">Regenerate CV</SubmitButton></form>
          <form action={enqueueApplicationPreparation}><input type="hidden" name="vacancyId" value={application.vacancyId} /><input type="hidden" name="reprepare" value="on" /><SubmitButton pendingLabel="Queuing" variant="secondary">Regenerate letter</SubmitButton></form>
        </div>
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Confirm submission</h2>
        <ul className="mt-2 list-disc pl-5 text-sm">
          <li>Company: {application.vacancy.companyName}</li>
          <li>Role: {application.vacancy.title}</li>
          <li>Application URL: {application.applicationUrl}</li>
          <li>Selected CV: {cv?.fileName ?? "No CV stored"}</li>
          <li>Cover letter: {letter?.fileName ?? "No cover letter stored"}</li>
          <li>Work authorization: {application.candidate.workAuthorization || "Unknown"}</li>
          <li>Sponsorship: {application.candidate.sponsorship || "Unknown"}</li>
          <li>Salary: {application.answers.find((answer) => answer.kind === "SALARY")?.answer || "Unknown"}</li>
        </ul>
        <p className="mt-2 text-sm">Answers</p>
        {application.answers.map((answer) => <p key={`${answer.id}-confirm`} className="text-sm">{answer.question} · {answer.status}</p>)}
        <p className="mt-2 text-sm text-muted">Review-required answers stay listed. Typing the confirmation phrase records the request and does not submit.</p>
        <form action={recordSubmissionConfirmation} className="mt-3 grid gap-2">
          <input type="hidden" name="id" value={application.id} />
          <input name="phrase" placeholder="Type CONFIRM SUBMISSION" autoComplete="off" />
          <SubmitButton pendingLabel="Checking">Confirm submission</SubmitButton>
        </form>
      </Panel>
      <Panel>
        <h2 className="font-display text-2xl">Browser preparation</h2>
        <p className="mt-2 text-sm">{browserLine(application.package?.timings)}</p>
        <p className="mt-2 text-sm">Prepared means the form was opened. CAPTCHA, Cloudflare, and login stay manual. Preparation is not approval.</p>
      </Panel>
      <Panel>
        <h2 className="font-display text-2xl">Audit history</h2>
        {application.events.map((event) => <p key={event.id} className="mt-2 text-sm">{event.type}{event.detail ? ` · ${event.detail}` : ""}</p>)}
        {application.followUps.map((item) => <p key={item.id} className="mt-2 text-sm">Follow-up {item.status} · {item.channel}</p>)}
      </Panel>
    </div>
  );
}

function latestVersion(documents: Array<{ kind: string; version: number; fileType: string }>, kind: string, fileType: string) {
  return documents.filter((document) => document.kind === kind && document.fileType === fileType).reduce((max, document) => Math.max(max, document.version), 0);
}

function toCandidateRecord(candidate: {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  facts: Array<{ id: string; category: CandidateRecord["facts"][number]["category"]; fact: string; verified: boolean; profiles: CandidateRecord["facts"][number]["profiles"]; skills: string[]; technologies: string[]; keywords: string[]; sourceType: CandidateRecord["facts"][number]["sourceType"] }>;
  projects: Array<{ id: string; name: string; description: string; role: string; technologies: string[]; features: string[]; outcomes: string[]; metrics: string[]; verified: boolean; profiles: CandidateRecord["projects"][number]["profiles"] }>;
  experiences: Array<{ id: string; title: string; organizationName: string; summary: string; verified: boolean; profiles: CandidateRecord["experiences"][number]["profiles"] }>;
}): CandidateRecord {
  return {
    fullName: candidate.fullName,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    email: candidate.email,
    facts: candidate.facts,
    projects: candidate.projects,
    experiences: candidate.experiences,
  };
}

function readResolvedAnswers(timings: unknown, fallback: Array<{ question: string; kind: string; answer: string | null; status: string }>) {
  if (timings && typeof timings === "object" && !Array.isArray(timings)) {
    const row = timings as { resolvedAnswers?: unknown };
    if (Array.isArray(row.resolvedAnswers) && row.resolvedAnswers.length) {
      return row.resolvedAnswers.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const entry = item as { question?: unknown; classification?: unknown; required?: unknown; answer?: unknown; source?: unknown; confidence?: unknown; reviewState?: unknown; reason?: unknown };
        if (typeof entry.question !== "string") return [];
        return [{
          question: entry.question,
          classification: typeof entry.classification === "string" ? entry.classification : "CUSTOM_QUESTION",
          required: entry.required === true,
          answer: typeof entry.answer === "string" ? entry.answer : null,
          source: typeof entry.source === "string" ? entry.source : "HUMAN_REVIEW",
          confidence: typeof entry.confidence === "number" ? entry.confidence : 0,
          reviewState: entry.reviewState === "ANSWERED" ? "ANSWERED" : "REVIEW_REQUIRED",
          reason: typeof entry.reason === "string" ? entry.reason : null,
        }];
      });
    }
  }
  return fallback.map((answer) => ({
    question: answer.question,
    classification: answer.kind,
    required: answer.status !== "ANSWERED",
    answer: answer.answer,
    source: answer.status === "ANSWERED" ? "CANDIDATE_ENTERED" : "HUMAN_REVIEW",
    confidence: answer.status === "ANSWERED" ? 1 : 0,
    reviewState: answer.status === "ANSWERED" ? "ANSWERED" as const : "REVIEW_REQUIRED" as const,
    reason: answer.status === "ANSWERED" ? null : "No safe answer is stored.",
  }));
}

function browserLine(timings: unknown) {
  if (!timings || typeof timings !== "object" || Array.isArray(timings)) return "Browser preparation has not been stored for this package.";
  const row = timings as Record<string, unknown>;
  const inspection = typeof row.browserInspectionMs === "number" ? `${row.browserInspectionMs} ms inspection` : "inspection not recorded";
  const reason = typeof row.failureReason === "string" && row.failureReason ? ` Stop reason: ${row.failureReason}.` : "";
  return `${inspection}.${reason} Opening a form does not mark the application ready.`;
}

function fieldLine(name: string, value: string | null) {
  return {
    name,
    classification: "CUSTOM_QUESTION" as const,
    taxonomy: "CUSTOM_QUESTION" as const,
    confidence: 1,
    required: !value,
    status: value ? "ANSWERED" as const : "REVIEW_REQUIRED" as const,
    value,
    source: value ? "candidate" : null,
    reason: value ? null : "unknown value",
  };
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3">
      <p className="text-sm text-muted">{title}</p>
      <ul className="mt-1 list-disc pl-5 text-sm">{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}

function salary(min: number | null, max: number | null, currency: string | null) {
  if (min == null && max == null) return "Salary not listed";
  return `Salary ${min ?? "—"}–${max ?? "—"} ${currency ?? ""}`.trim();
}

function readAnalysis(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return {
    requiredMatches: strings(row.requiredMatches),
    requiredGaps: strings(row.requiredGaps),
    preferredMatches: strings(row.preferredMatches),
    preferredGaps: strings(row.preferredGaps),
    blockers: strings(row.blockers),
    uncertain: strings(row.uncertain),
    missingInformation: strings(row.missingInformation),
    selections: Array.isArray(row.selections)
      ? row.selections.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const entry = item as { requirement?: unknown; evidence?: unknown; match?: unknown; reason?: unknown };
          if (typeof entry.requirement !== "string" || typeof entry.match !== "string") return [];
          return [{ requirement: entry.requirement, evidence: typeof entry.evidence === "string" ? entry.evidence : "", match: entry.match, reason: typeof entry.reason === "string" ? entry.reason : "" }];
        })
      : [],
    evidence: Array.isArray(row.evidence)
      ? row.evidence.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const entry = item as { requirement?: unknown; fact?: unknown };
          if (typeof entry.requirement !== "string" || typeof entry.fact !== "string") return [];
          return [{ requirement: entry.requirement, fact: entry.fact }];
        })
      : [],
  };
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
