import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, organization, membership } = await requireOrganization();
  return (
    <div>
      <PageHeader title="Settings" detail="Workspace access is enforced on the server." />
      <div className="grid gap-3 md:grid-cols-2">
        <Panel><p className="text-sm text-muted">Signed in</p><p>{user.name}</p><p className="text-sm">{user.email}</p></Panel>
        <Panel><p className="text-sm text-muted">Organization</p><p>{organization.name}</p><p className="text-sm">Role: {membership.role}</p></Panel>
      </div>
      <div className="mt-4 flex gap-4 text-sm">
        <Link href="/billing">Billing</Link>
        {membership.role !== "MEMBER" ? <Link href="/settings/jobs">Job monitor</Link> : null}
      </div>
    </div>
  );
}
