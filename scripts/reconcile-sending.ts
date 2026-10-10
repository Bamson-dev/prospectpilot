// Lists outreach messages stuck in SENDING. Read only unless you pass every flag for a decision.
//
//   npx tsx scripts/reconcile-sending.ts                              list stuck messages
//   RECONCILE_MIN_AGE_MINUTES=60 npx tsx scripts/reconcile-sending.ts  change the age threshold
//   npx tsx scripts/reconcile-sending.ts --message <id> --disposition sent --provider-id <gmail id> \
//     --evidence "found in Gmail Sent on <date>" --confirm <id>
//   npx tsx scripts/reconcile-sending.ts --message <id> --disposition not-sent \
//     --evidence "not in Sent, provider logs show rejection" --confirm <id>
//
// This script never sends email and never touches more than the one message you name.
import { prisma } from "@/lib/db";
import { listStuckSending, reconcileMessage, stuckThresholdMinutes, type Disposition } from "@/lib/email/reconcile";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function main() {
  const messageId = arg("--message");
  if (messageId) {
    const next = await reconcileMessage(prisma, {
      messageId,
      confirm: arg("--confirm") ?? "",
      disposition: (arg("--disposition") ?? "") as Disposition,
      evidence: arg("--evidence") ?? "",
      providerMessageId: arg("--provider-id") ?? undefined,
    });
    console.log(`Message ${messageId} is now ${next}.`);
    return;
  }
  const stuck = await listStuckSending(prisma, { thresholdMinutes: stuckThresholdMinutes() });
  if (stuck.length === 0) return console.log("No messages are stuck in SENDING.");
  for (const item of stuck) console.log(`${item.id}  ${item.provider ?? "-"}  ${item.recipient ?? "-"}  ${item.minutesInSending} min  ${item.lastResult}`);
  console.log(`${stuck.length} message(s). No changes were made.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
