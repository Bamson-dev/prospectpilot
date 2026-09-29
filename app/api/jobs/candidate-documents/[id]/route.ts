import { NextResponse } from "next/server";
import { documentAccess } from "@/lib/applications/access";
import { requireOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { organization } = await requireOrganization();
  const { id } = await context.params;
  const document = await prisma.candidateDocument.findFirst({
    where: { id, organizationId: organization.id },
  });
  if (!document || documentAccess(organization.id, document.organizationId) !== "allow") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const fileName = document.fileName.replace(/[^A-Za-z0-9._-]/g, "") || "document";
  return new NextResponse(Buffer.from(document.content), {
    headers: {
      "Content-Type": document.fileType,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
