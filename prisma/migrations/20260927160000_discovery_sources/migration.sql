-- Additive discovery evidence. Existing campaigns keep their rows and gain safe defaults.

ALTER TABLE "Campaign" ADD COLUMN "dailyQualificationLimit" INTEGER NOT NULL DEFAULT 25;
ALTER TABLE "Campaign" ADD COLUMN "excludedKeywords" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "maxQueries" INTEGER NOT NULL DEFAULT 6;
ALTER TABLE "Campaign" ADD COLUMN "maxPagesPerSite" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Campaign" ADD COLUMN "crawlDepth" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "Campaign" ADD COLUMN "enableDirectory" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campaign" ADD COLUMN "enableMap" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campaign" ADD COLUMN "enableSocial" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "DiscoverySource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "campaignId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "query" TEXT,
    "title" TEXT,
    "snippet" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoverySource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceHealth" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "emptyResults" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceHealth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceHealth_name_key" ON "SourceHealth"("name");
CREATE INDEX "DiscoverySource_prospectId_createdAt_idx" ON "DiscoverySource"("prospectId", "createdAt");
CREATE INDEX "DiscoverySource_organizationId_sourceType_idx" ON "DiscoverySource"("organizationId", "sourceType");

ALTER TABLE "DiscoverySource" ADD CONSTRAINT "DiscoverySource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoverySource" ADD CONSTRAINT "DiscoverySource_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoverySource" ADD CONSTRAINT "DiscoverySource_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
