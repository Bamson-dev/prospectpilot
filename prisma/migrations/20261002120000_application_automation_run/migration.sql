ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'AUTOMATION_STARTED';
ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'AUTOMATION_RESUMED';
ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'FORM_DISCOVERED';
ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'FIELDS_DETECTED';
ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'ANSWERS_RESOLVED';
ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'FORM_FILL_STARTED';
ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'DOCUMENT_UPLOADED';
ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'FORM_VALIDATED';
ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'AUTOMATION_FAILED';
ALTER TYPE "ApplicationEventType" ADD VALUE IF NOT EXISTS 'AUTOMATION_RETRY_SCHEDULED';

CREATE TYPE "AutomationRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PAUSED', 'WAITING', 'COMPLETED', 'FAILED', 'BLOCKED');
CREATE TYPE "BrowserSessionStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED');
CREATE TYPE "FieldResolutionStatus" AS ENUM ('DETECTED', 'CLASSIFIED', 'RESOLVED', 'UNRESOLVED', 'FILLED', 'VALIDATED', 'FAILED');
CREATE TYPE "DocumentUploadStatus" AS ENUM ('NOT_STARTED', 'UPLOADING', 'UPLOADED', 'VALIDATED', 'FAILED');

CREATE TABLE "ApplicationAutomationRun" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "packageVersion" INTEGER NOT NULL,
  "status" "AutomationRunStatus" NOT NULL DEFAULT 'QUEUED',
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "currentStep" TEXT NOT NULL DEFAULT 'BROWSER_STARTED',
  "currentUrl" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "nextRetryAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "blocker" TEXT,
  "cvUpload" "DocumentUploadStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "coverUpload" "DocumentUploadStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApplicationAutomationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationBrowserSession" (
  "id" TEXT NOT NULL,
  "automationRunId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "adapter" TEXT NOT NULL,
  "status" "BrowserSessionStatus" NOT NULL DEFAULT 'RUNNING',
  "currentUrl" TEXT,
  "pageTitle" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  CONSTRAINT "ApplicationBrowserSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationFieldResolution" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "automationRunId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "fieldKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "elementId" TEXT NOT NULL,
  "fieldType" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "classification" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "answer" TEXT,
  "answerSource" TEXT,
  "resolution" "FieldResolutionStatus" NOT NULL DEFAULT 'DETECTED',
  "filled" BOOLEAN NOT NULL DEFAULT false,
  "validated" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApplicationFieldResolution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApplicationAutomationRun_idempotencyKey_key" ON "ApplicationAutomationRun"("idempotencyKey");
CREATE INDEX "ApplicationAutomationRun_applicationId_status_idx" ON "ApplicationAutomationRun"("applicationId", "status");
CREATE INDEX "ApplicationAutomationRun_packageId_idx" ON "ApplicationAutomationRun"("packageId");
CREATE UNIQUE INDEX "ApplicationAutomationRun_one_active" ON "ApplicationAutomationRun"("applicationId") WHERE "status" IN ('QUEUED', 'RUNNING');
CREATE INDEX "ApplicationBrowserSession_applicationId_startedAt_idx" ON "ApplicationBrowserSession"("applicationId", "startedAt");
CREATE INDEX "ApplicationBrowserSession_automationRunId_idx" ON "ApplicationBrowserSession"("automationRunId");
CREATE UNIQUE INDEX "ApplicationFieldResolution_automationRunId_fieldKey_key" ON "ApplicationFieldResolution"("automationRunId", "fieldKey");
CREATE INDEX "ApplicationFieldResolution_applicationId_idx" ON "ApplicationFieldResolution"("applicationId");

ALTER TABLE "ApplicationAutomationRun" ADD CONSTRAINT "ApplicationAutomationRun_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationAutomationRun" ADD CONSTRAINT "ApplicationAutomationRun_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ApplicationPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationBrowserSession" ADD CONSTRAINT "ApplicationBrowserSession_automationRunId_fkey" FOREIGN KEY ("automationRunId") REFERENCES "ApplicationAutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationBrowserSession" ADD CONSTRAINT "ApplicationBrowserSession_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationFieldResolution" ADD CONSTRAINT "ApplicationFieldResolution_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationFieldResolution" ADD CONSTRAINT "ApplicationFieldResolution_automationRunId_fkey" FOREIGN KEY ("automationRunId") REFERENCES "ApplicationAutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
