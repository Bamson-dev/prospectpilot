import { PageHeader, Panel } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  await requireOrganization();
  return (
    <div>
      <PageHeader title="Billing" detail="No payment provider is connected. This workspace is not being charged from ProspectPilot." />
      <div className="grid gap-3 md:grid-cols-3">
        {["Free", "Pro", "Business"].map((plan) => (
          <Panel key={plan}><h2 className="font-display text-2xl">{plan}</h2><p className="mt-2 text-sm text-muted">Not available for purchase in this version.</p></Panel>
        ))}
      </div>
    </div>
  );
}
