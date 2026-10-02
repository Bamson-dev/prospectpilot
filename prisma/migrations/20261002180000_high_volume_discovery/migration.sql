-- AlterTable
ALTER TABLE "JobVacancy" ADD COLUMN "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "JobVacancy" ADD COLUMN "normalizedCompany" TEXT NOT NULL DEFAULT '';
ALTER TABLE "JobVacancy" ADD COLUMN "normalizedLocation" TEXT NOT NULL DEFAULT '';
ALTER TABLE "JobVacancy" ADD COLUMN "normalizedTitle" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "JobVacancy_organizationId_normalizedCompany_normalizedTitle_idx" ON "JobVacancy"("organizationId", "normalizedCompany", "normalizedTitle");
CREATE INDEX "JobVacancy_organizationId_lastCheckedAt_idx" ON "JobVacancy"("organizationId", "lastCheckedAt");
