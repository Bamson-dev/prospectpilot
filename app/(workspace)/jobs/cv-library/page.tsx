import { archiveGeneratedDocument, saveCandidateDocument } from "@/actions/job-applications";
import { JobsNav } from "@/components/jobs-nav";
import { Empty, Flash, PageHeader, Panel } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "CV library" };

export default async function CvLibraryPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; profile?: string; page?: string }> }) {
  const { organization } = await requireOrganization();
  const query = await searchParams;
  const profile = query.profile === "SOFTWARE" || query.profile === "WEB" || query.profile === "MARKETING" ? query.profile : undefined;
  const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
  const take = 50;
  const skip = (page - 1) * take;

  const [documents, totalCount, candidate] = await Promise.all([
    prisma.generatedDocument.findMany({
      where: { organizationId: organization.id, archived: false, ...(profile ? { profile } : {}) },
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: { vacancy: true },
    }),
    prisma.generatedDocument.count({
      where: { organizationId: organization.id, archived: false, ...(profile ? { profile } : {}) }
    }),
    prisma.candidate.findFirst({
      where: { organizationId: organization.id },
      include: { baseDocuments: { orderBy: { createdAt: "desc" } } }
    })
  ]);
  
  const totalPages = Math.max(1, Math.ceil(totalCount / take));
  return (
    <div>
      <PageHeader title="CV library" detail="Downloads stay inside this organization. Filenames do not include internal ids." />
      <JobsNav />
      <Flash error={query.error} notice={query.notice} />
      <p className="mb-3 text-sm">
        <a className="mr-3" href="/jobs/cv-library">All</a>
        <a className="mr-3" href="/jobs/cv-library?profile=SOFTWARE">Software</a>
        <a className="mr-3" href="/jobs/cv-library?profile=WEB">Web</a>
        <a href="/jobs/cv-library?profile=MARKETING">Marketing</a>
      </p>
      <Panel className="mb-3">
        <h2 className="font-display text-2xl">Base Documents</h2>
        <p className="mt-2 text-sm text-muted">Upload base CVs, portfolios, or certificates. These are used as source material for generated applications.</p>
        
        {candidate?.baseDocuments && candidate.baseDocuments.length > 0 ? (
          <div className="mt-4 grid gap-3">
            {candidate.baseDocuments.map((doc) => (
              <div key={doc.id} className="flex justify-between items-center py-2 border-b border-line">
                <div>
                  <a className="text-tide font-medium" href={`/api/jobs/candidate-documents/${doc.id}`}>{doc.fileName}</a>
                  <p className="text-xs text-muted">{doc.kind} · Uploaded {doc.createdAt.toLocaleDateString()}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">No base documents uploaded yet.</p>
        )}

        <form action={saveCandidateDocument} className="mt-6 flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm text-muted mb-1">Document Type</label>
            <select name="kind" className="w-full">
              <option value="BASE_CV">Base CV</option>
              <option value="PORTFOLIO">Portfolio</option>
              <option value="CERTIFICATE">Certificate</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm text-muted mb-1">File</label>
            <input name="file" type="file" required className="w-full" />
          </div>
          <SubmitButton pendingLabel="Uploading...">Upload Document</SubmitButton>
        </form>
      </Panel>

      <h2 className="font-display text-2xl mt-8 mb-4">Generated Application Documents</h2>
      <div className="mb-4 text-sm text-muted">
        Showing {documents.length > 0 ? skip + 1 : 0}-{Math.min(skip + take, totalCount)} of {totalCount} generated documents (Page {page} of {totalPages})
      </div>
      {documents.length === 0 ? <Empty title="No generated documents" detail="A CV is stored after a vacancy is prepared and the candidate email is real." /> : documents.map((document) => (
        <Panel key={document.id} className="mb-3">
          <p className="font-display text-xl">{document.fileName}</p>
          <p className="text-sm text-muted mb-3">{document.kind} · {document.profile} · {document.vacancy?.title ?? "No vacancy"} · v{document.version}</p>
          <div className="bg-muted/10 p-3 rounded text-xs whitespace-pre-wrap max-h-48 overflow-y-auto mb-3 border border-line">
            {document.text.slice(0, 500)}{document.text.length > 500 ? "..." : ""}
          </div>
          <div className="mt-2 flex gap-2">
            <a className="button button-secondary" href={`/api/jobs/documents/${document.id}`}>Download</a>
            <form action={archiveGeneratedDocument}>
              <input type="hidden" name="id" value={document.id} />
              <SubmitButton pendingLabel="Archiving" variant="secondary">Archive</SubmitButton>
            </form>
          </div>
        </Panel>
      ))}
      
      {totalPages > 1 && (
        <div className="mt-8 flex justify-center gap-2">
          {page > 1 && <a href={`?page=${page - 1}${profile ? `&profile=${profile}` : ""}`} className="px-3 py-1 rounded bg-muted/20 border border-line text-sm">Previous</a>}
          {page < totalPages && <a href={`?page=${page + 1}${profile ? `&profile=${profile}` : ""}`} className="px-3 py-1 rounded bg-muted/20 border border-line text-sm">Next</a>}
        </div>
      )}
    </div>
  );
}
