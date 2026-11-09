export type Role = "seeker" | "recruiter";
export type Stage = "applied" | "screening" | "interview" | "offer" | "hired" | "rejected";
export const STAGES: Stage[] = ["applied", "screening", "interview", "offer", "hired", "rejected"];
export type LocationType = "remote" | "hybrid" | "onsite";
export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD", "SGD", "AED", "JPY", "CHF"];

export type Organization = { id: string; name: string; type: "company" | "agency" };
export type User = {
  id: string;
  email: string;
  role: Role;
  email_verified: boolean;
  full_name: string | null;
  picture_url: string | null;
  organization: Organization | null;
};

export type Skill = { name: string; years: number | null };

export type WorkEntry = {
  title: string;
  company: string;
  start: string;
  end: string;
  current: boolean;
  description: string;
};
export type ProjectEntry = {
  name: string;
  role: string;
  start: string;
  end: string;
  current: boolean;
  description: string;
  url: string;
  technologies: string[];
};
export type EducationEntry = { degree: string; institution: string; year: number | null };
export const JOB_TYPES = ["full-time", "part-time", "contract", "internship"] as const;
export type JobType = (typeof JOB_TYPES)[number];
export type Availability = "" | "immediately" | "2-weeks" | "1-month" | "2-months" | "3-months" | "not-looking";
export const AVAILABILITY_LABELS: Record<Availability, string> = {
  "": "",
  immediately: "Available now",
  "2-weeks": "Available in 2 weeks",
  "1-month": "Available in 1 month",
  "2-months": "Available in 2 months",
  "3-months": "Available in 3 months or more",
  "not-looking": "Not actively looking",
};
export type ProfileExtras = {
  work_history: WorkEntry[];
  projects: ProjectEntry[];
  education: EducationEntry[];
  certifications: string[];
  languages: string[];
  desired_roles: string[];
  job_types: JobType[];
  links: { linkedin: string; github: string; portfolio: string };
  availability: Availability;
  open_to_relocate: boolean;
};
export type Profile = ProfileExtras & {
  id: string;
  full_name: string;
  headline: string;
  summary: string;
  years_experience: number | null;
  location: string;
  utc_offset: number | null;
  remote_preference: LocationType | "any";
  salary_min: number | null;
  currency: string;
  is_visible: boolean;
  skills: Skill[];
  has_embedding: boolean;
};

export type Resume = {
  id: string;
  filename: string;
  parse_status: "pending" | "processing" | "done" | "failed";
  parse_error: string | null;
  extracted: {
    headline: string;
    summary: string;
    years_experience: number | null;
    location: string | null;
    skills: string[];
    work_history?: (Omit<WorkEntry, "start" | "end"> & { start: string | null; end: string | null })[];
    projects?: (Omit<ProjectEntry, "start" | "end" | "url"> & { start: string | null; end: string | null; url: string | null })[];
    education?: EducationEntry[];
    certifications?: string[];
    languages?: string[];
  } | null;
};

export type Job = {
  id: string;
  organization_name: string;
  title: string;
  description: string;
  location_type: LocationType;
  location: string;
  tz_min: number | null;
  tz_max: number | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string;
  min_years: number | null;
  required_skills: string[];
  nice_to_have_skills: string[];
  created_at: string;
};

export type OwnedJob = Job & {
  client_name: string | null;
  status: "draft" | "open" | "closed";
  parse_status: "none" | "pending" | "processing" | "done" | "failed";
  parse_error: string | null;
};

export type JobListItem = OwnedJob & { applicant_count: number; awaiting_review: number };

export type Score = {
  total: number;
  skills: number;
  semantic: number;
  experience: number;
  logistics: number;
  matched_required: string[];
  missing_required: string[];
  matched_nice: string[];
  missing_nice: string[];
};

export type Candidate = ProfileExtras & {
  id: string;
  full_name: string;
  headline: string;
  summary: string;
  years_experience: number | null;
  location: string;
  remote_preference: string;
  skills: string[];
};

export type CandidateMatch = { candidate: Candidate; score: Score };
export type JobMatch = { job: Job; score: Score; applied: boolean };
export type Explanation = {
  strengths: { skill: string; reason: string }[];
  gaps: { skill: string; reason: string }[];
  summary: string;
  source: "ai" | "template";
};
export type SeekerApplication = {
  id: string;
  job: Job;
  stage: Stage;
  created_at: string;
  cover_note: string | null;
  via_assistant: boolean;
};
export type RecruiterApplication = {
  id: string;
  candidate: Candidate;
  stage: Stage;
  created_at: string;
  cover_note: string | null;
  via_assistant: boolean;
};

export type ScoreBand = { label: string; count: number };
export type SkillCoverage = { skill: string; required: boolean; count: number; percent: number };
export type ApplicantInsight = {
  application_id: string;
  candidate_id: string;
  full_name: string;
  headline: string;
  stage: Stage;
  days_waiting: number;
  total: number;
  skills: number;
  semantic: number;
  experience: number;
  logistics: number;
};
export type JobAnalytics = {
  applicant_count: number;
  strong_count: number;
  score_bands: ScoreBand[];
  skill_coverage: SkillCoverage[];
  top_candidates: ApplicantInsight[];
  needs_decision: ApplicantInsight[];
};

export type LanguageFlag = { phrase: string; suggestion: string };
export type DescriptionCheck = { missing_skills: string[]; language_flags: LanguageFlag[] };
export type GeneratedDescription = DescriptionCheck & { title: string; description: string };

export type AgentCandidate = {
  ref: string;
  candidate: Candidate;
  score: Score;
  application_id: string | null;
  stage: Stage | null;
};
export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "error"; message: string }
  | { type: "answer"; text: string; display_text: string; candidates: AgentCandidate[] };

export type AssistantSettings = {
  enabled: boolean;
  mode: "ask" | "auto";
  min_score: number;
  daily_limit: number;
  require_all_skills: boolean;
  excluded_companies: string[];
  has_auto_consent: boolean;
  last_run_at: string | null;
};
export type AssistantAction = {
  id: string;
  job: Job;
  score: number;
  note: string;
  status: "pending" | "applied" | "skipped" | "withdrawn";
  applied_automatically: boolean;
  created_at: string;
};
export type AssistantData = {
  settings: AssistantSettings;
  pending: AssistantAction[];
  activity: AssistantAction[];
};
