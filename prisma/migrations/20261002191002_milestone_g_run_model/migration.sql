-- CreateEnum
CREATE TYPE "JobDiscoveryRunStatus" AS ENUM ('STARTED', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIALLY_COMPLETED');

-- AlterTable
ALTER TABLE "SourceHealth" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "JobDiscoveryRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "status" "JobDiscoveryRunStatus" NOT NULL DEFAULT 'STARTED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "queries" INTEGER NOT NULL DEFAULT 0,
    "providers" INTEGER NOT NULL DEFAULT 0,
    "rawResults" INTEGER NOT NULL DEFAULT 0,
    "validVacancies" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "newVacancies" INTEGER NOT NULL DEFAULT 0,
    "updatedVacancies" INTEGER NOT NULL DEFAULT 0,
    "rejectedVacancies" INTEGER NOT NULL DEFAULT 0,
    "providerErrors" INTEGER NOT NULL DEFAULT 0,
    "rateLimits" INTEGER NOT NULL DEFAULT 0,
    "qualificationJobsQueued" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobDiscoveryRun_organizationId_status_idx" ON "JobDiscoveryRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "JobDiscoveryRun_candidateId_startedAt_idx" ON "JobDiscoveryRun"("candidateId", "startedAt");

-- AddForeignKey
ALTER TABLE "JobDiscoveryRun" ADD CONSTRAINT "JobDiscoveryRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDiscoveryRun" ADD CONSTRAINT "JobDiscoveryRun_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
