-- Additive profile and application states. Existing rows keep their current values.

ALTER TYPE "CareerProfileKind" ADD VALUE IF NOT EXISTS 'SAAS';
ALTER TYPE "CareerProfileKind" ADD VALUE IF NOT EXISTS 'GROWTH';
ALTER TYPE "CareerProfileKind" ADD VALUE IF NOT EXISTS 'FOUNDER';
ALTER TYPE "CareerProfileKind" ADD VALUE IF NOT EXISTS 'HYBRID';

ALTER TYPE "ApplicationPackageStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "ApplicationPackageStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "ApplicationPackageStatus" ADD VALUE IF NOT EXISTS 'VERIFIED';
ALTER TYPE "ApplicationPackageStatus" ADD VALUE IF NOT EXISTS 'PREPARING';
ALTER TYPE "ApplicationPackageStatus" ADD VALUE IF NOT EXISTS 'FIT_EVALUATED';

ALTER TABLE "JobFitSnapshot" ADD COLUMN IF NOT EXISTS "analysis" JSONB;
