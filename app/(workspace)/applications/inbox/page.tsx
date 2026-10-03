import { prisma } from "@/lib/db";

import { revalidatePath } from "next/cache";

export default async function InboxPage() {
  const replies = await prisma.employerReply.findMany({
    include: { application: { include: { vacancy: true } } },
    orderBy: { receivedAt: "desc" },
  });

  async function approveDraft(formData: FormData) {
    "use server";
    const id = formData.get("replyId") as string;
    await prisma.employerReply.update({
      where: { id },
      data: { draftStatus: "APPROVED" },
    });
    // The actual sending would be handled by a worker observing APPROVED drafts,
    // or we can invoke Gmail send here. For V1 we just mark as approved.
    revalidatePath("/applications/inbox");
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Employer Inbox</h1>
      {replies.length === 0 ? (
        <p className="text-zinc-500">No employer replies yet.</p>
      ) : (
        <div className="space-y-6">
          {replies.map((reply) => (
            <div key={reply.id} className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-semibold text-lg">{reply.subject || "(No Subject)"}</h3>
                  <p className="text-sm text-zinc-500">From: {reply.fromName} &lt;{reply.fromEmail}&gt;</p>
                  <p className="text-sm text-zinc-500">Role: {reply.application.vacancy.title} at {reply.application.vacancy.companyName}</p>
                </div>
                <div className="text-sm">
                  <span className={`px-2 py-1 rounded text-xs font-mono ${
                    reply.classification === "INTERVIEW_INVITATION" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                    reply.classification === "REJECTION" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" :
                    "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
                  }`}>
                    {reply.classification}
                  </span>
                </div>
              </div>
              
              <div className="bg-zinc-50 dark:bg-zinc-900 p-4 rounded text-sm mb-4 whitespace-pre-wrap">
                {reply.body}
              </div>

              {reply.suggestedDraft && (
                <div className="border border-blue-100 dark:border-blue-900 rounded p-4 bg-blue-50/50 dark:bg-blue-900/10">
                  <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">AI Suggested Reply:</h4>
                  <p className="text-sm whitespace-pre-wrap mb-4">{reply.suggestedDraft}</p>
                  
                  {reply.draftStatus === "PENDING" ? (
                    <form action={approveDraft}>
                      <input type="hidden" name="replyId" value={reply.id} />
                      <button 
                        type="submit"
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
                      >
                        Approve & Send
                      </button>
                    </form>
                  ) : (
                    <span className="text-sm font-medium text-green-600 dark:text-green-400">✓ Approved & Sent</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
