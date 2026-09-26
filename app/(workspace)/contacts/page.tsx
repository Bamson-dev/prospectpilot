import Link from "next/link";
import { Empty, PageHeader } from "@/components/ui";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const metadata = { title: "Contacts" };

export default async function ContactsPage() {
  const { organization } = await requireOrganization();
  const contacts = await prisma.contact.findMany({
    where: { organizationId: organization.id },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { prospect: true },
  });
  return (
    <div>
      <PageHeader title="Contacts" detail="A contact is stored only with a source. Missing names stay blank." />
      {contacts.length === 0 ? <Empty title="No contacts" detail="Website research stores public email addresses it can actually see." /> : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table>
            <thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Company</th><th>Confidence</th><th>Source</th></tr></thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td>{contact.fullName || "—"}</td>
                  <td>{contact.jobTitle || "—"}</td>
                  <td>{contact.email || "—"}{contact.suppressed ? " · suppressed" : ""}</td>
                  <td><Link href={`/prospects/${contact.prospectId}`}>{contact.prospect.companyName}</Link></td>
                  <td>{contact.confidence}</td>
                  <td>{contact.sourceUrl || contact.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
