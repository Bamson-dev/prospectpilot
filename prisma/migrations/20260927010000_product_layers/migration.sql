-- Additive product-layer fields. Existing rows and enum values stay in place.

ALTER TYPE "OutreachState" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "OutreachState" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "JobState" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "OpportunityKind" ADD VALUE IF NOT EXISTS 'CUSTOM_SOFTWARE';
ALTER TYPE "OpportunityKind" ADD VALUE IF NOT EXISTS 'SOFTWARE_REPLACEMENT';
ALTER TYPE "OpportunityKind" ADD VALUE IF NOT EXISTS 'ADVERTISING_MANAGEMENT';
ALTER TYPE "OpportunityKind" ADD VALUE IF NOT EXISTS 'ADVERTISING_OPTIMIZATION';

CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'DISMISSED');

ALTER TABLE "Prospect" ADD COLUMN "notes" TEXT;
ALTER TABLE "Contact" ADD COLUMN "notes" TEXT;

ALTER TABLE "ResearchRecord" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'website';
ALTER TABLE "ResearchRecord" ADD COLUMN "content" TEXT;
ALTER TABLE "ResearchRecord" ADD COLUMN "technologies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ResearchRecord" ADD COLUMN "services" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ResearchRecord" ADD COLUMN "products" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ResearchRecord" ADD COLUMN "contactSignals" JSONB;
ALTER TABLE "ResearchRecord" ADD COLUMN "advertisingSignals" JSONB;
ALTER TABLE "ResearchRecord" ADD COLUMN "softwareSignals" JSONB;
ALTER TABLE "ResearchRecord" ADD COLUMN "socialLinks" JSONB;
ALTER TABLE "ResearchRecord" ADD COLUMN "bookingSignals" JSONB;
ALTER TABLE "ResearchRecord" ADD COLUMN "trackingSignals" JSONB;
ALTER TABLE "ResearchRecord" ADD COLUMN "confidence" INTEGER;

ALTER TABLE "OpportunityAssessment" ADD COLUMN "title" TEXT;
ALTER TABLE "OpportunityAssessment" ADD COLUMN "description" TEXT;
ALTER TABLE "OpportunityAssessment" ADD COLUMN "potentialValue" TEXT;
ALTER TABLE "OpportunityAssessment" ADD COLUMN "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN';

ALTER TABLE "OutreachMessage" ADD COLUMN "scheduledAt" TIMESTAMP(3);

ALTER TABLE "Suppression" ADD COLUMN "notes" TEXT;

ALTER TABLE "ActivityLog" ADD COLUMN "userId" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "contactId" TEXT;

CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProspectTag" (
    "prospectId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    CONSTRAINT "ProspectTag_pkey" PRIMARY KEY ("prospectId","tagId")
);

CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Tag_organizationId_name_key" ON "Tag"("organizationId", "name");
CREATE INDEX "ProspectTag_tagId_idx" ON "ProspectTag"("tagId");
CREATE INDEX "Sequence_organizationId_campaignId_idx" ON "Sequence"("organizationId", "campaignId");
CREATE UNIQUE INDEX "SequenceStep_sequenceId_position_key" ON "SequenceStep"("sequenceId", "position");
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");

ALTER TABLE "Tag" ADD CONSTRAINT "Tag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectTag" ADD CONSTRAINT "ProspectTag_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectTag" ADD CONSTRAINT "ProspectTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
