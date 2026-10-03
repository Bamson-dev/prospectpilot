import { prisma } from "@/lib/db";

import { revalidatePath } from "next/cache";

export default async function ManualActionsPage() {
  const actions = await prisma.applicationManualAction.findMany({
    where: { resolved: false },
    include: { application: true },
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
        data: { status: "READY_FOR_SUBMISSION" }, // This will trigger the automation to resume
      });
    }
    revalidatePath("/applications/manual-actions");
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Requires Manual Action</h1>
      {actions.length === 0 ? (
        <p className="text-zinc-500">No applications currently require manual action.</p>
      ) : (
        <div className="space-y-4">
          {actions.map((action) => (
            <div key={action.id} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-lg">{action.companyName}</h3>
                  <p className="text-sm text-zinc-500 mb-2">Blocker: <span className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded text-red-600 dark:text-red-400">{action.blockerType}</span></p>
                  <p className="text-sm mb-4">{action.blockerMessage}</p>
                </div>
                <div className="text-sm text-zinc-400">
                  Step: {action.currentStep}
                </div>
              </div>
              <div className="flex space-x-3 mt-4 border-t border-zinc-100 dark:border-zinc-800 pt-4">
                <a 
                  href={action.applicationUrl} 
                  target="_blank" 
                  rel="noreferrer"
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
                >
                  Continue Application
                </a>
                <form action={resolveAction}>
                  <input type="hidden" name="actionId" value={action.id} />
                  <button 
                    type="submit"
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
                  >
                    Resume Automation
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
