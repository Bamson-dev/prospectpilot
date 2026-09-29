export type CareerProfile = "SOFTWARE" | "WEB" | "MARKETING" | "SAAS" | "GROWTH" | "FOUNDER" | "HYBRID";

export type FactCategory =
  | "IDENTITY"
  | "EXPERIENCE"
  | "ACHIEVEMENT"
  | "SKILL"
  | "TECHNOLOGY"
  | "CERTIFICATION"
  | "EDUCATION"
  | "METRIC"
  | "PROJECT"
  | "LINK";

export type RequirementKind =
  | "MUST_HAVE"
  | "NICE_TO_HAVE"
  | "RESPONSIBILITY"
  | "TECHNOLOGY"
  | "SOFT_SKILL"
  | "EDUCATION"
  | "EXPERIENCE_YEARS"
  | "SENIORITY"
  | "INDUSTRY"
  | "LOCATION"
  | "REMOTE_POLICY"
  | "EMPLOYMENT_TYPE"
  | "SALARY"
  | "APPLICATION_METHOD"
  | "APPLICATION_PLATFORM";

export type CandidateFactInput = {
  id: string;
  category: FactCategory;
  fact: string;
  verified: boolean;
  profiles: CareerProfile[];
  skills?: string[];
  technologies?: string[];
  keywords?: string[];
  sourceType?: "CANDIDATE_ENTERED" | "REPOSITORY_VERIFIED" | "DOCUMENT_VERIFIED" | "SYSTEM_GENERATED";
};

export type CandidateProjectInput = {
  id: string;
  name: string;
  description: string;
  role: string;
  technologies: string[];
  features: string[];
  outcomes: string[];
  metrics: string[];
  verified: boolean;
  profiles: CareerProfile[];
  url?: string | null;
  githubUrl?: string | null;
  source?: string;
  confidence?: number;
};

export type CandidateExperienceInput = {
  id: string;
  title: string;
  organizationName: string;
  summary: string;
  verified: boolean;
  profiles: CareerProfile[];
};

export type CandidateRecord = {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  location?: string | null;
  yearsExperience?: number | null;
  workAuthorization?: string | null;
  sponsorship?: string | null;
  availability?: string | null;
  noticePeriod?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  portfolioUrl?: string | null;
  salaryExpectation?: string | null;
  institution?: string | null;
  degree?: string | null;
  certification?: string | null;
  facts: CandidateFactInput[];
  projects: CandidateProjectInput[];
  experiences: CandidateExperienceInput[];
};

export type RequirementCertainty = "required" | "preferred" | "responsibility" | "uncertain";

export type ExtractedRequirement = {
  kind: RequirementKind;
  text: string;
  years?: number;
  required: boolean;
  certainty?: RequirementCertainty;
};

export type JobInput = {
  title: string;
  companyName: string;
  description: string;
  location?: string | null;
  remoteType?: string | null;
  applicationUrl: string;
};

export type ApplicationMode = "MANUAL" | "AUTO_PREPARE" | "AUTO_SUBMIT";

export type ApplicationQuestionKind =
  | "EXPERIENCE"
  | "MOTIVATION"
  | "SALARY"
  | "LOCATION"
  | "WORK_AUTHORIZATION"
  | "AVAILABILITY"
  | "TECHNICAL"
  | "BEHAVIORAL"
  | "COMPANY_SPECIFIC"
  | "PORTFOLIO"
  | "EDUCATION"
  | "OTHER";

export type ApplicationStatus =
  | "PREPARED"
  | "READY_FOR_REVIEW"
  | "READY_TO_SUBMIT"
  | "SUBMITTING"
  | "SUBMITTED"
  | "VERIFICATION_REQUIRED"
  | "FAILED"
  | "REQUIRES_REVIEW"
  | "REQUIRES_MANUAL_ACTION"
  | "WITHDRAWN"
  | "APPROVED"
  | "REJECTED"
  | "VERIFIED"
  | "PREPARING"
  | "FIT_EVALUATED"
  | "READY_FOR_SUBMISSION"
  | "VERIFICATION_PENDING";
