import { Shell } from "@/components/shell";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { user, organization } = await requireOrganization();
  const pending = await prisma.outreachMessage.count({
    where: { organizationId: organization.id, state: "PENDING_APPROVAL" },
  });
  return (
    <Shell name={user.name} organization={organization.name} pending={pending}>
      {children}
    </Shell>
  );
}
