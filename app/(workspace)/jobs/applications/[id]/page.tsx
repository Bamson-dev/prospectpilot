import { notFound } from "next/navigation";
import { JobsNav } from "@/components/jobs-nav";
import { PageHeader, Panel } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Application review" };

export default async function ApplicationReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { organization } = await requireOrganization();
  const { id } = await params;
  const application = await prisma.jobApplication.findFirst({
    where: { id, organizationId: organization.id },
    include: {
      vacancy: { include: { requirements: true, fit: true } },
      package: true,
      answers: true,
      events: { orderBy: { createdAt: "desc" }, take: 30 },
      followUps: true,
      candidate: true,
    },
  });
  if (!application) notFound();
  const documents = await prisma.generatedDocument.findMany({
    where: { organizationId: organization.id, vacancyId: application.vacancyId, archived: false },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div>
      <PageHeader title={application.vacancy.title} detail={`${application.vacancy.companyName} · ${application.status}`} />
      <JobsNav />
      <Panel className="mb-3">
        <p className="text-sm">Profile {application.profile}. Match {application.vacancy.fit?.overallMatch ?? "—"}. Recommendation {application.vacancy.fit?.recommendation ?? "—"}.</p>
        <p className="mt-2 text-sm"><a className="text-tide" href={application.applicationUrl}>{application.applicationUrl}</a></p>
        <ul className="mt-3 list-disc pl-5 text-sm">
          {(application.package?.warnings ?? []).map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Documents</h2>
        {documents.map((document) => <p key={document.id} className="mt-2 text-sm"><a className="text-tide" href={`/api/jobs/documents/${document.id}`}>{document.fileName}</a></p>)}
        {documents.length === 0 ? <p className="mt-2 text-sm text-muted">No document stored. A placeholder email blocks CV generation.</p> : null}
      </Panel>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Answers</h2>
        {application.answers.map((answer) => <p key={answer.id} className="mt-2 text-sm">{answer.question} · {answer.status}{answer.answer ? ` · ${answer.answer.slice(0, 180)}` : ""}</p>)}
      </Panel>
      <Panel>
        <h2 className="font-display text-2xl">History</h2>
        {application.events.map((event) => <p key={event.id} className="mt-2 text-sm">{event.type}{event.detail ? ` · ${event.detail}` : ""}</p>)}
        {application.followUps.map((item) => <p key={item.id} className="mt-2 text-sm">Follow-up {item.status} · {item.channel}</p>)}
      </Panel>
    </div>
  );
}
