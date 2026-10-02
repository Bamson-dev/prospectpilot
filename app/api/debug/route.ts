import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { legacyAutomationHold } from "@/lib/applications/automation-engine";
import { ApplicationStatus } from "@/lib/applications/types";

export async function GET(request: Request) {
  const application = await prisma.jobApplication.findFirst({
    where: { id: "cmur00hez01aelm0va0miwbzi" },
    include: { package: true },
  });
  
  if (!application) {
    return NextResponse.json({ error: "not found" });
  }

  return NextResponse.json({
    status: application.status,
    hold: legacyAutomationHold(application.status as ApplicationStatus),
    pkg: !!application.package,
    url: !!application.applicationUrl,
    urlVal: application.applicationUrl
  });
}
