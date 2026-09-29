CREATE TYPE "FactSourceType" AS ENUM ('CANDIDATE_ENTERED', 'REPOSITORY_VERIFIED', 'DOCUMENT_VERIFIED', 'SYSTEM_GENERATED');

ALTER TYPE "ApplicationPackageStatus" ADD VALUE IF NOT EXISTS 'REQUIRES_REVIEW';

ALTER TABLE "CandidateFact" ADD COLUMN IF NOT EXISTS "sourceType" "FactSourceType" NOT NULL DEFAULT 'CANDIDATE_ENTERED';

ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "linkedinUrl" TEXT;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "portfolioUrl" TEXT;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "githubUrl" TEXT;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "yearsExperience" INTEGER;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "currentRole" TEXT;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "targetRoles" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "workAuthorization" TEXT;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "sponsorship" TEXT;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "availability" TEXT;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "noticePeriod" TEXT;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "employmentPreference" TEXT;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "remotePreference" TEXT;
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "relocationPreference" TEXT;

ALTER TABLE "CandidatePreference" ADD COLUMN IF NOT EXISTS "salaryMin" INTEGER;
ALTER TABLE "CandidatePreference" ADD COLUMN IF NOT EXISTS "salaryTarget" INTEGER;
ALTER TABLE "CandidatePreference" ADD COLUMN IF NOT EXISTS "salaryCurrency" TEXT;
ALTER TABLE "CandidatePreference" ADD COLUMN IF NOT EXISTS "salaryPeriod" TEXT;

CREATE TABLE IF NOT EXISTS "CandidateEducation" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "institution" TEXT NOT NULL,
  "degree" TEXT,
  "field" TEXT,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "source" TEXT NOT NULL,
  CONSTRAINT "CandidateEducation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CandidateCertification" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "issuer" TEXT,
  "issuedAt" TIMESTAMP(3),
  "credentialUrl" TEXT,
  "source" TEXT NOT NULL,
  CONSTRAINT "CandidateCertification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CandidateEducation_candidateId_idx" ON "CandidateEducation"("candidateId");
CREATE INDEX IF NOT EXISTS "CandidateCertification_candidateId_idx" ON "CandidateCertification"("candidateId");

DO $$ BEGIN
  ALTER TABLE "CandidateEducation" ADD CONSTRAINT "CandidateEducation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CandidateCertification" ADD CONSTRAINT "CandidateCertification_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ApplicationPackage" ADD COLUMN IF NOT EXISTS "timings" JSONB;
