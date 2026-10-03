import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { PageHeader, Panel, Flash } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { JobsNav } from "@/components/jobs-nav";

export const metadata = { title: "Manual Actions" };

export default async function ManualActionsPage() {
  const actions = await prisma.applicationManualAction.findMany({
    where: { resolved: false },
    include: { application: { include: { vacancy: true } } },
    orderBy: { createdAt: "desc" },
  });

  async function resolveAction(formData: FormData) {
    "use server";
    const id = formData.get("actionId") as string;
    await prisma.applicationManualAction.update({
      where: { id },
      data: { resolved: true },
    });
    const action = await prisma.applicationManualAction.findUnique({ where: { id } });
    if (action) {
      await prisma.jobApplication.update({
        where: { id: action.applicationId },
        data: { status: "READY_FOR_SUBMISSION" },
      });
    }
    revalidatePath("/applications/manual-actions");
  }

  return (
    <div>
      <PageHeader title="Manual Actions Center" detail="Resolve employer security challenges and missing information." />
      <JobsNav />
      
      {actions.length === 0 ? (
        <Panel className="text-center py-12">
          <p className="text-muted">No applications currently require manual action.</p>
          <p className="text-sm mt-2 text-wine">The autonomous system is running smoothly.</p>
        </Panel>
      ) : (
        <div className="grid gap-4 mt-6">
          {actions.map((action) => (
            <Panel key={action.id} className="border-l-4 border-l-wine">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 pb-4 border-b border-line">
                <div>
                  <h3 className="font-display text-xl">{action.companyName} · {action.application?.vacancy?.title || "Unknown Role"}</h3>
                  <div className="flex gap-2 mt-2">
                    <span className="text-xs bg-wine/10 text-wine px-2 py-0.5 rounded font-medium uppercase tracking-wider">{action.blockerType}</span>
                    <span className="text-xs bg-muted/10 text-muted px-2 py-0.5 rounded font-medium uppercase tracking-wider">Step: {action.currentStep}</span>
                  </div>
                </div>
                <div className="text-xs text-muted whitespace-nowrap">
                  {action.createdAt.toLocaleString()}
                </div>
              </div>
              
              <div className="text-sm mb-6">
                <p className="font-medium text-ink mb-1">Required Action:</p>
                <p className="text-muted bg-muted/5 p-3 rounded border border-line">{action.blockerMessage}</p>
              </div>
              
              <div className="flex flex-wrap items-center gap-3">
                <a 
                  href={action.applicationUrl} 
                  target="_blank" 
                  rel="noreferrer"
                  className="button button-primary"
                >
                  Complete in Browser
                </a>
                <form action={resolveAction}>
                  <input type="hidden" name="actionId" value={action.id} />
                  <SubmitButton pendingLabel="Resuming...">Mark Resolved & Resume</SubmitButton>
                </form>
                <a href={`/jobs/applications/${action.applicationId}`} className="text-sm text-tide hover:underline underline-offset-2 ml-auto">
                  View full application
                </a>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
