import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeAdmin } from "../discovery/route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await authorizeAdmin(request);
    if (!auth) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId");

    const run = runId ? await prisma.jobDiscoveryRun.findUnique({
      where: { id: runId }
    }) : await prisma.jobDiscoveryRun.findFirst({
      where: { organizationId: auth.organization.id },
      orderBy: { createdAt: "desc" }
    });

    const vacancies = await prisma.jobVacancy.findMany({
      where: { organizationId: auth.organization.id },
      orderBy: { createdAt: "desc" },
      take: 5
    });
    
    const vacancy = vacancies[0];
    if (!vacancy) {
      return NextResponse.json({ error: "No vacancy found" }, { status: 404 });
    }

    const fit = await prisma.jobFitSnapshot.findFirst({
      where: { vacancyId: vacancy.id }
    });

    const application = await prisma.jobApplication.findFirst({
      where: { vacancyId: vacancy.id },
      include: {
        package: true,
        answers: true,
        events: true
      }
    });

    let cv = null;
    let coverLetter = null;

    if (application?.cvId) {
      cv = await prisma.generatedDocument.findUnique({
        where: { id: application.cvId },
        select: { id: true, kind: true, fileName: true, version: true, text: true }
      });
    }

    if (application?.coverLetterId) {
      coverLetter = await prisma.generatedDocument.findUnique({
        where: { id: application.coverLetterId },
        select: { id: true, kind: true, fileName: true, version: true, text: true }
      });
    }

    const automationRun = application ? await prisma.applicationAutomationRun.findFirst({
      where: { applicationId: application.id },
      orderBy: { createdAt: "desc" }
    }) : null;

    const candidate = await prisma.candidate.findUnique({
      where: { id: application?.candidateId || vacancy.candidateId || auth.organization.id }
    });

    return NextResponse.json({
      run,
      vacancy,
      fit,
      application,
      cv,
      coverLetter,
      automationRun,
      candidateEmail: candidate?.email
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
