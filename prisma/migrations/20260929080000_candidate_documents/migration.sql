ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'PACKAGE_PREPARED';
ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'BROWSER_OPENED';
ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'FIELDS_CLASSIFIED';
ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'QUESTIONS_GENERATED';
ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "ApplicationPackage" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

CREATE TYPE "CandidateDocumentKind" AS ENUM ('BASE_CV', 'PORTFOLIO', 'CERTIFICATE', 'OTHER');

CREATE TABLE IF NOT EXISTS "CandidateDocument" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "kind" "CandidateDocumentKind" NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileType" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CandidateDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CandidateDocument_organizationId_candidateId_kind_idx" ON "CandidateDocument"("organizationId", "candidateId", "kind");

ALTER TABLE "CandidateDocument" ADD CONSTRAINT "CandidateDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateDocument" ADD CONSTRAINT "CandidateDocument_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
