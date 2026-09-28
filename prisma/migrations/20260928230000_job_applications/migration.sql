-- Job application automation. Additive only. Sales outreach tables are unchanged.

CREATE TYPE "CareerProfileKind" AS ENUM ('SOFTWARE', 'WEB', 'MARKETING');
CREATE TYPE "FactCategory" AS ENUM ('IDENTITY', 'EXPERIENCE', 'ACHIEVEMENT', 'SKILL', 'TECHNOLOGY', 'CERTIFICATION', 'EDUCATION', 'METRIC', 'PROJECT', 'LINK');
CREATE TYPE "RequirementKind" AS ENUM ('MUST_HAVE', 'NICE_TO_HAVE', 'RESPONSIBILITY', 'TECHNOLOGY', 'SOFT_SKILL', 'EDUCATION', 'EXPERIENCE_YEARS', 'SENIORITY', 'INDUSTRY', 'LOCATION', 'REMOTE_POLICY', 'EMPLOYMENT_TYPE', 'SALARY', 'APPLICATION_METHOD', 'APPLICATION_PLATFORM');
CREATE TYPE "JobVacancyStatus" AS ENUM ('DISCOVERED', 'ANALYZED', 'QUALIFIED', 'REJECTED', 'DUPLICATE', 'ARCHIVED');
CREATE TYPE "ApplicationPackageStatus" AS ENUM ('PREPARED', 'READY_FOR_REVIEW', 'READY_TO_SUBMIT', 'SUBMITTING', 'SUBMITTED', 'VERIFICATION_REQUIRED', 'FAILED', 'REQUIRES_MANUAL_ACTION', 'WITHDRAWN');
CREATE TYPE "ApplicationEventType" AS ENUM ('JOB_FOUND', 'JOB_ANALYZED', 'FIT_CALCULATED', 'CV_GENERATED', 'COVER_LETTER_GENERATED', 'APPLICATION_OPENED', 'FORM_STARTED', 'CV_UPLOADED', 'QUESTIONS_FILLED', 'SUBMISSION_STARTED', 'SUBMITTED', 'VERIFICATION_PASSED', 'VERIFICATION_FAILED', 'CAPTCHA_DETECTED', 'RATE_LIMITED', 'MANUAL_ACTION_REQUIRED');
CREATE TYPE "GeneratedDocumentKind" AS ENUM ('CV', 'COVER_LETTER', 'SUPPORTING');
CREATE TYPE "ApplicationQuestionKind" AS ENUM ('EXPERIENCE', 'MOTIVATION', 'SALARY', 'LOCATION', 'WORK_AUTHORIZATION', 'AVAILABILITY', 'TECHNICAL', 'BEHAVIORAL', 'COMPANY_SPECIFIC', 'PORTFOLIO', 'EDUCATION', 'OTHER');

CREATE TABLE "Candidate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "location" TEXT,
  "headline" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CandidateCareerProfile" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "kind" "CareerProfileKind" NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  CONSTRAINT "CandidateCareerProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CandidateExperience" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "organizationName" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "current" BOOLEAN NOT NULL DEFAULT false,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL,
  "profiles" "CareerProfileKind"[],
  CONSTRAINT "CandidateExperience_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CandidateProject" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "industry" TEXT,
  "projectType" TEXT,
  "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "outcomes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "metrics" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "url" TEXT,
  "githubUrl" TEXT,
  "demoUrl" TEXT,
  "videoUrl" TEXT,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL,
  "profiles" "CareerProfileKind"[],
  CONSTRAINT "CandidateProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CandidateFact" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "category" "FactCategory" NOT NULL,
  "subcategory" TEXT,
  "fact" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceDocumentId" TEXT,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "profiles" "CareerProfileKind"[],
  "industries" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CandidateFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CandidateWritingProfile" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "tone" TEXT NOT NULL,
  "formality" TEXT NOT NULL,
  "verbosity" TEXT NOT NULL,
  "voice" TEXT NOT NULL,
  "samples" TEXT[] DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "CandidateWritingProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CandidatePreference" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "discoverJobs" BOOLEAN NOT NULL DEFAULT false,
  "dailyTarget" INTEGER NOT NULL DEFAULT 500,
  "mode" TEXT NOT NULL DEFAULT 'AUTO_PREPARE',
  "locations" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "remoteOnly" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "CandidatePreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobVacancy" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "applicationUrl" TEXT NOT NULL,
  "externalId" TEXT,
  "companyName" TEXT NOT NULL,
  "companyDomain" TEXT,
  "companyDescription" TEXT,
  "title" TEXT NOT NULL,
  "location" TEXT,
  "country" TEXT,
  "remoteType" TEXT,
  "employmentType" TEXT,
  "salaryMin" INTEGER,
  "salaryMax" INTEGER,
  "salaryCurrency" TEXT,
  "description" TEXT NOT NULL,
  "seniority" TEXT,
  "industry" TEXT,
  "postedAt" TIMESTAMP(3),
  "deadline" TIMESTAMP(3),
  "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "JobVacancyStatus" NOT NULL DEFAULT 'DISCOVERED',
  "duplicateOf" TEXT,
  "rawData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobVacancy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobRequirement" (
  "id" TEXT NOT NULL,
  "vacancyId" TEXT NOT NULL,
  "kind" "RequirementKind" NOT NULL,
  "text" TEXT NOT NULL,
  "years" INTEGER,
  "required" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "JobRequirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobFitSnapshot" (
  "id" TEXT NOT NULL,
  "vacancyId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "profile" "CareerProfileKind" NOT NULL,
  "overallMatch" INTEGER NOT NULL,
  "profileMatch" INTEGER NOT NULL,
  "missing" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "gaps" JSONB NOT NULL,
  "advantages" JSONB NOT NULL,
  "recommendation" TEXT NOT NULL,
  "selectedProjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "selectedFactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobFitSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GeneratedDocument" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "vacancyId" TEXT,
  "profile" "CareerProfileKind",
  "kind" "GeneratedDocumentKind" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "fileName" TEXT NOT NULL,
  "fileType" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JobApplication" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "vacancyId" TEXT NOT NULL,
  "profile" "CareerProfileKind" NOT NULL,
  "status" "ApplicationPackageStatus" NOT NULL DEFAULT 'PREPARED',
  "source" TEXT NOT NULL,
  "applicationUrl" TEXT NOT NULL,
  "cvId" TEXT,
  "coverLetterId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "blockedReason" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationPackage" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "profile" "CareerProfileKind" NOT NULL,
  "fitSummary" TEXT NOT NULL,
  "strategy" TEXT NOT NULL,
  "status" "ApplicationPackageStatus" NOT NULL DEFAULT 'PREPARED',
  "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "ApplicationPackage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationEvent" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "type" "ApplicationEventType" NOT NULL,
  "detail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApplicationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationAnswer" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "kind" "ApplicationQuestionKind" NOT NULL,
  "answer" TEXT,
  "status" TEXT NOT NULL,
  CONSTRAINT "ApplicationAnswer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApplicationFollowUp" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "runAt" TIMESTAMP(3) NOT NULL,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "draft" TEXT NOT NULL,
  CONSTRAINT "ApplicationFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Candidate_organizationId_email_key" ON "Candidate"("organizationId", "email");
CREATE INDEX "Candidate_organizationId_idx" ON "Candidate"("organizationId");
CREATE UNIQUE INDEX "CandidateCareerProfile_candidateId_kind_key" ON "CandidateCareerProfile"("candidateId", "kind");
CREATE INDEX "CandidateExperience_candidateId_idx" ON "CandidateExperience"("candidateId");
CREATE UNIQUE INDEX "CandidateProject_candidateId_name_key" ON "CandidateProject"("candidateId", "name");
CREATE INDEX "CandidateProject_candidateId_idx" ON "CandidateProject"("candidateId");
CREATE UNIQUE INDEX "CandidateFact_candidateId_category_fact_key" ON "CandidateFact"("candidateId", "category", "fact");
CREATE INDEX "CandidateFact_candidateId_category_idx" ON "CandidateFact"("candidateId", "category");
CREATE UNIQUE INDEX "CandidateWritingProfile_candidateId_key" ON "CandidateWritingProfile"("candidateId");
CREATE UNIQUE INDEX "CandidatePreference_candidateId_key" ON "CandidatePreference"("candidateId");
CREATE UNIQUE INDEX "JobVacancy_organizationId_applicationUrl_key" ON "JobVacancy"("organizationId", "applicationUrl");
CREATE INDEX "JobVacancy_organizationId_status_createdAt_idx" ON "JobVacancy"("organizationId", "status", "createdAt");
CREATE INDEX "JobVacancy_organizationId_externalId_idx" ON "JobVacancy"("organizationId", "externalId");
CREATE INDEX "JobVacancy_companyDomain_idx" ON "JobVacancy"("companyDomain");
CREATE INDEX "JobRequirement_vacancyId_kind_idx" ON "JobRequirement"("vacancyId", "kind");
CREATE UNIQUE INDEX "JobFitSnapshot_vacancyId_key" ON "JobFitSnapshot"("vacancyId");
CREATE INDEX "GeneratedDocument_organizationId_candidateId_kind_createdAt_idx" ON "GeneratedDocument"("organizationId", "candidateId", "kind", "createdAt");
CREATE INDEX "GeneratedDocument_vacancyId_idx" ON "GeneratedDocument"("vacancyId");
CREATE UNIQUE INDEX "ApplicationPackage_applicationId_key" ON "ApplicationPackage"("applicationId");
CREATE UNIQUE INDEX "JobApplication_organizationId_vacancyId_candidateId_key" ON "JobApplication"("organizationId", "vacancyId", "candidateId");
CREATE INDEX "JobApplication_organizationId_status_createdAt_idx" ON "JobApplication"("organizationId", "status", "createdAt");
CREATE INDEX "JobApplication_applicationUrl_idx" ON "JobApplication"("applicationUrl");
CREATE INDEX "ApplicationEvent_applicationId_createdAt_idx" ON "ApplicationEvent"("applicationId", "createdAt");
CREATE INDEX "ApplicationAnswer_applicationId_idx" ON "ApplicationAnswer"("applicationId");
CREATE INDEX "ApplicationFollowUp_applicationId_runAt_idx" ON "ApplicationFollowUp"("applicationId", "runAt");

ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateCareerProfile" ADD CONSTRAINT "CandidateCareerProfile_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateExperience" ADD CONSTRAINT "CandidateExperience_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateProject" ADD CONSTRAINT "CandidateProject_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateFact" ADD CONSTRAINT "CandidateFact_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateWritingProfile" ADD CONSTRAINT "CandidateWritingProfile_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidatePreference" ADD CONSTRAINT "CandidatePreference_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobVacancy" ADD CONSTRAINT "JobVacancy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobRequirement" ADD CONSTRAINT "JobRequirement_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "JobVacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobFitSnapshot" ADD CONSTRAINT "JobFitSnapshot_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "JobVacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "JobVacancy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobApplication" ADD CONSTRAINT "JobApplication_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "JobVacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationPackage" ADD CONSTRAINT "ApplicationPackage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationEvent" ADD CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApplicationFollowUp" ADD CONSTRAINT "ApplicationFollowUp_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
