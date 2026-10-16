-- Email application route: who it was sent to, when, and Gmail's response id.
ALTER TABLE "JobApplication" ADD COLUMN "applyEmail" TEXT;
ALTER TABLE "JobApplication" ADD COLUMN "applyEmailSource" TEXT;
ALTER TABLE "JobApplication" ADD COLUMN "emailSubject" TEXT;
ALTER TABLE "JobApplication" ADD COLUMN "emailAttemptAt" TIMESTAMP(3);
ALTER TABLE "JobApplication" ADD COLUMN "emailSentAt" TIMESTAMP(3);
ALTER TABLE "JobApplication" ADD COLUMN "emailMessageId" TEXT;
CREATE INDEX "JobApplication_emailSentAt_idx" ON "JobApplication"("emailSentAt");
