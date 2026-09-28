import { switchOrganization } from "@/actions/organization";
import { Flash } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requireUser } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Choose a workspace" };

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { organization: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="font-display text-4xl">Choose a workspace</h1>
      <p className="mt-3 text-sm text-muted">This account belongs to more than one workspace. Open the one you want to use.</p>
      <div className="mt-6"><Flash error={params.error} /></div>
      {memberships.length === 0 ? <p className="mt-4 text-sm text-muted">This account is not a member of a workspace.</p> : (
        <div className="mt-6 space-y-4">
          {memberships.map((membership) => (
            <form key={membership.id} action={switchOrganization} className="space-y-1">
              <input type="hidden" name="organizationId" value={membership.organizationId} />
              <SubmitButton pendingLabel="Opening">{membership.organization.name}</SubmitButton>
              <p className="text-sm text-muted">{membership.role}</p>
            </form>
          ))}
        </div>
      )}
    </main>
  );
}
