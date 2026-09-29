CREATE TYPE "EvidenceVerification" AS ENUM ('VERIFIED', 'REVIEW_REQUIRED', 'UNVERIFIED', 'PENDING_REVIEW', 'REJECTED');
CREATE TYPE "EvidenceChange" AS ENUM ('CREATED', 'UPDATED', 'REPLACED', 'REMOVED', 'VERIFICATION_CHANGED', 'PROFILE_ASSIGNMENT_CHANGED');

ALTER TABLE "CandidateFact" ADD COLUMN "verification" "EvidenceVerification" NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE "CandidateFact" ADD COLUMN "duration" TEXT;
UPDATE "CandidateFact" SET "verification" = 'VERIFIED' WHERE "verified" = true;

CREATE TABLE "CandidateFactEvent" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "factId" TEXT,
  "action" "EvidenceChange" NOT NULL,
  "detail" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CandidateFactEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CandidateFactEvent_candidateId_createdAt_idx" ON "CandidateFactEvent"("candidateId", "createdAt");

ALTER TABLE "CandidateFactEvent" ADD CONSTRAINT "CandidateFactEvent_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
