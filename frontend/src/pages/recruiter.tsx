import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api, send } from "../api/client";
import { AgentChat } from "../components/AgentChat";
import { JobHeader } from "../components/JobHeader";
import type {
  CandidateMatch,
  JobListItem,
  Organization,
  OwnedJob,
  RecruiterApplication,
  Stage,
  User,
} from "../api/types";
import { CURRENCIES, STAGES } from "../api/types";
import {
  Button,
  Card,
  ErrorText,
  ExplanationPanel,
  FilterChips,
  Field,
  inputClass,
  JobFacts,
  LinkButton,
  PageTitle,
  ScoreBadge,
  SearchPanel,
  Skeletons,
  SkillComparison,
  TextInput,
} from "../components/ui";

export function OrgSetupPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [type, setType] = useState<Organization["type"]>("company");
  const create = useMutation({
    mutationFn: () => send<Organization>("POST", "/organization", { name, type }),
    onSuccess: async (organization) => {
      client.setQueryData<User | null>(["me"], (user) => (user ? { ...user, organization } : user));
      navigate("/recruiter/jobs");
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <div className="mx-auto max-w-sm">
      <PageTitle>Set up your organization</PageTitle>
      <form onSubmit={submit} className="space-y-4">
        <TextInput label="Organization name" required value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Type">
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as Organization["type"])}>
            <option value="company">Company hiring for itself</option>
            <option value="agency">Hiring agency</option>
          </select>
        </Field>
        <ErrorText error={create.error} />
        <Button disabled={create.isPending} className="w-full">
          Continue
        </Button>
      </form>
    </div>
  );
}

type JobFilter = "all" | "open" | "draft" | "closed";

export function RecruiterJobsPage() {
  const navigate = useNavigate();
  const [pasting, setPasting] = useState(false);
  const [filter, setFilter] = useState<JobFilter>("all");
  const [description, setDescription] = useState("");
  const [clientName, setClientName] = useState("");
  const jobs = useQuery({ queryKey: ["org-jobs"], queryFn: () => api<JobListItem[]>("/org/jobs") });
  const draft = useMutation({
    mutationFn: () =>
      send<OwnedJob>("POST", "/org/jobs/draft", { description, client_name: clientName || null }),
    onSuccess: (job) => navigate(`/recruiter/jobs/${job.id}/edit`),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    draft.mutate();
  };
  const all = jobs.data ?? [];
  const count = (status: JobFilter) => all.filter((job) => job.status === status).length;
  const shown = all.filter((job) => filter === "all" || job.status === filter);
  const quietLink = "text-sm font-medium text-brand hover:underline";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle>Our jobs</PageTitle>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" aria-expanded={pasting} onClick={() => setPasting(!pasting)}>
            Paste a description
          </Button>
          <LinkButton to="/recruiter/jobs/new">Write a job with AI</LinkButton>
        </div>
      </div>
      {pasting && (
        <Card className="mb-6">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Paste a job description to create a draft">
              <textarea className={inputClass} rows={5} required minLength={20} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <TextInput label="Client name (optional, for agencies, never shown publicly)" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            <ErrorText error={draft.error} />
            <Button disabled={draft.isPending}>Create draft</Button>
          </form>
        </Card>
      )}
      <ErrorText error={jobs.error} />
      {jobs.isPending && <Skeletons />}
      {jobs.data && all.length > 0 && (
        <FilterChips
          label="Filter jobs"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: `All (${all.length})` },
            { id: "open", label: `Open (${count("open")})` },
            { id: "draft", label: `Drafts (${count("draft")})` },
            { id: "closed", label: `Closed (${count("closed")})` },
          ]}
        />
      )}
      {jobs.data && all.length === 0 && (
        <Card className="max-w-2xl">
          <h2>Post your first job</h2>
          <p className="mt-1 text-ink-soft">Give the AI a short brief and it will write the description for you to review.</p>
          <div className="mt-4">
            <LinkButton to="/recruiter/jobs/new">Write a job with AI</LinkButton>
          </div>
        </Card>
      )}
      <div className="space-y-3">
        {shown.map((job) => {
          const isOpen = job.status === "open";
          return (
            <Card key={job.id} className="grid items-center gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1fr)_170px_auto]">
              <div className="min-w-0">
                <Link
                  to={`/recruiter/jobs/${job.id}/${isOpen ? "insights" : "edit"}`}
                  className="text-lg font-semibold leading-tight text-brand hover:underline"
                >
                  {job.title || "Untitled draft"}
                </Link>
                <p className="text-sm text-ink-soft">
                  <span className="capitalize">{job.status}</span>
                  {job.client_name ? `, for ${job.client_name}` : ""}
                </p>
                <JobFacts job={job} />
              </div>
              <div className="text-sm">
                {isOpen && (
                  <>
                    <p className="font-semibold">
                      {job.applicant_count} {job.applicant_count === 1 ? "applicant" : "applicants"}
                    </p>
                    <p className="text-ink-soft">{job.awaiting_review} to review</p>
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {isOpen ? (
                  <>
                    <Link className={quietLink} to={`/recruiter/jobs/${job.id}/insights`}>Insights</Link>
                    <Link className={quietLink} to={`/recruiter/jobs/${job.id}/candidates`}>Candidates</Link>
                    <Link className={quietLink} to={`/recruiter/jobs/${job.id}/pipeline`}>Pipeline</Link>
                  </>
                ) : (
                  <Link className={quietLink} to={`/recruiter/jobs/${job.id}/edit`}>Edit</Link>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

type JobForm = {
  title: string;
  description: string;
  client_name: string;
  location_type: OwnedJob["location_type"];
  location: string;
  salary_min: number | null;
  salary_max: number | null;
  currency: string;
  min_years: number | null;
  tz_min: number | null;
  tz_max: number | null;
  required: string;
  nice: string;
};

function toNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function jobToForm(job: OwnedJob): JobForm {
  return {
    title: job.title,
    description: job.description,
    client_name: job.client_name ?? "",
    location_type: job.location_type,
    location: job.location,
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    currency: job.currency,
    min_years: job.min_years,
    tz_min: job.tz_min,
    tz_max: job.tz_max,
    required: job.required_skills.join(", "),
    nice: job.nice_to_have_skills.join(", "),
  };
}

export function JobEditPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<JobForm | null>(null);
  const job = useQuery({
    queryKey: ["org-job", id],
    queryFn: () => api<OwnedJob>(`/org/jobs/${id}`),
    refetchInterval: (query) => {
      const status = query.state.data?.parse_status;
      return status === "pending" || status === "processing" ? 1500 : false;
    },
  });
  const parsing = job.data?.parse_status === "pending" || job.data?.parse_status === "processing";

  useEffect(() => {
    if (job.data && !parsing && form === null) setForm(jobToForm(job.data));
  }, [job.data, parsing, form]);

  const save = useMutation({
    mutationFn: async ({ values, publish }: { values: JobForm; publish: boolean }) => {
      const { required, nice, client_name, ...rest } = values;
      await send("PUT", `/org/jobs/${id}`, {
        ...rest,
        client_name: client_name || null,
        required_skills: splitList(required),
        nice_to_have_skills: splitList(nice),
      });
      if (publish) await send("PATCH", `/org/jobs/${id}/status`, { status: "open" });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["org-jobs"] });
      client.invalidateQueries({ queryKey: ["org-job", id] });
      navigate("/recruiter/jobs");
    },
  });
  const close = useMutation({
    mutationFn: () => send("PATCH", `/org/jobs/${id}/status`, { status: "closed" }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["org-jobs"] });
      navigate("/recruiter/jobs");
    },
  });

  if (job.isError) return <ErrorText error={job.error} />;
  if (job.isPending || parsing || !form) {
    return (
      <p className="text-sm text-ink-soft" role="status">
        Reading the job description with the local AI model…
      </p>
    );
  }
  const set = <K extends keyof JobForm>(key: K, value: JobForm[K]) => setForm({ ...form, [key]: value });
  const isOpen = job.data.status === "open";

  return (
    <div className="max-w-2xl">
      {isOpen ? (
        <JobHeader jobId={id!} />
      ) : (
        <PageTitle sub="Check what the AI extracted, then publish.">Review job</PageTitle>
      )}
      {job.data.parse_status === "failed" && <p className="mb-4 text-sm text-danger">{job.data.parse_error}</p>}
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({ values: form, publish: !isOpen });
        }}
      >
        <TextInput label="Title" required value={form.title} onChange={(e) => set("title", e.target.value)} />
        <Field label="Description">
          <textarea className={inputClass} rows={8} required value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field label="Required skills (comma separated)">
          <textarea className={inputClass} rows={2} value={form.required} onChange={(e) => set("required", e.target.value)} />
        </Field>
        <Field label="Nice-to-have skills (comma separated)">
          <textarea className={inputClass} rows={2} value={form.nice} onChange={(e) => set("nice", e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Work type">
            <select className={inputClass} value={form.location_type} onChange={(e) => set("location_type", e.target.value as JobForm["location_type"])}>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </select>
          </Field>
          <TextInput label="Location or region" value={form.location} onChange={(e) => set("location", e.target.value)} />
          <TextInput label="Salary from (annual)" type="number" min={0} value={form.salary_min ?? ""} onChange={(e) => set("salary_min", toNumber(e.target.value))} />
          <TextInput label="Salary to (annual)" type="number" min={0} value={form.salary_max ?? ""} onChange={(e) => set("salary_max", toNumber(e.target.value))} />
          <Field label="Currency">
            <select className={inputClass} value={form.currency} onChange={(e) => set("currency", e.target.value)}>
              {CURRENCIES.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </select>
          </Field>
          <TextInput label="Minimum years of experience" type="number" min={0} max={60} step="0.5" value={form.min_years ?? ""} onChange={(e) => set("min_years", toNumber(e.target.value))} />
          <TextInput label="Earliest UTC offset (optional)" type="number" min={-12} max={14} step="0.5" value={form.tz_min ?? ""} onChange={(e) => set("tz_min", toNumber(e.target.value))} />
          <TextInput label="Latest UTC offset (optional)" type="number" min={-12} max={14} step="0.5" value={form.tz_max ?? ""} onChange={(e) => set("tz_max", toNumber(e.target.value))} />
          <TextInput label="Client name (never shown publicly)" value={form.client_name} onChange={(e) => set("client_name", e.target.value)} />
        </div>
        <ErrorText error={save.error} />
        <div className="flex gap-2">
          <Button disabled={save.isPending}>{isOpen ? "Save changes" : "Publish job"}</Button>
          {isOpen && (
            <Button type="button" variant="secondary" disabled={close.isPending} onClick={() => close.mutate()}>
              Close job
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

const WEIGHTS = [
  ["skills", "Skills"],
  ["semantic", "Similarity"],
  ["experience", "Experience"],
  ["logistics", "Logistics"],
] as const;
type WeightKey = (typeof WEIGHTS)[number][0];

function CandidateCard({ jobId, match }: { jobId: string; match: CandidateMatch }) {
  const [open, setOpen] = useState(false);
  const { candidate, score } = match;
  return (
    <Card>
      <div className="flex items-start gap-4">
        <ScoreBadge total={score.total} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-tight">{candidate.full_name || "Unnamed candidate"}</p>
              <p className="text-sm text-ink-soft">
                {[candidate.headline, candidate.location, candidate.years_experience != null ? `${candidate.years_experience} yrs` : null].filter(Boolean).join(", ")}
              </p>
            </div>
            <Button variant="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "Hide reasons" : "Why this match?"}
            </Button>
          </div>
          <div className="mt-2">
            <SkillComparison score={score} />
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Skills {score.skills}, similarity {score.semantic}, experience {score.experience}, logistics {score.logistics}
          </p>
        </div>
      </div>
      {open && <ExplanationPanel path={`/org/jobs/${jobId}/candidates/${candidate.id}/explanation`} />}
    </Card>
  );
}

const DEFAULT_WEIGHTS: Record<WeightKey, number> = { skills: 50, semantic: 25, experience: 15, logistics: 10 };
const SEARCH_DELAY_MS = 300;

export function CandidatesPage() {
  const { id } = useParams();
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [keyword, setKeyword] = useState("");
  const [skill, setSkill] = useState("");
  const [minYears, setMinYears] = useState(0);
  const [allRequired, setAllRequired] = useState(false);
  const [applied, setApplied] = useState({ keyword: "", skill: "" });

  useEffect(() => {
    const timer = setTimeout(() => setApplied({ keyword: keyword.trim(), skill: skill.trim() }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [keyword, skill]);

  const params = new URLSearchParams(Object.entries(weights).map(([key, value]) => [key, String(value)]));
  if (applied.keyword) params.set("q", applied.keyword);
  if (applied.skill) params.set("skill", applied.skill);
  if (minYears) params.set("min_years", String(minYears));
  if (allRequired) params.set("all_required", "true");
  const search = params.toString();

  const matches = useQuery({
    queryKey: ["candidates", id, search],
    queryFn: () => api<CandidateMatch[]>(`/org/jobs/${id}/matches?${search}`),
    placeholderData: keepPreviousData,
  });
  const weightsChanged = WEIGHTS.some(([key]) => weights[key] !== DEFAULT_WEIGHTS[key]);
  const hasFilters = Boolean(keyword || skill || minYears || allRequired || weightsChanged);
  const clear = () => {
    setKeyword("");
    setSkill("");
    setMinYears(0);
    setAllRequired(false);
    setWeights(DEFAULT_WEIGHTS);
  };

  return (
    <div>
      <JobHeader jobId={id!} />
      <div className="grid items-start gap-6 lg:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)_360px]">
        <div className="lg:sticky lg:top-4 lg:row-span-2 xl:row-span-1">
          <SearchPanel
            hasFilters={hasFilters}
            onClear={clear}
            primary={
              <Field label="Search candidates">
                <input
                  type="search"
                  placeholder="Name or current role"
                  maxLength={200}
                  className={inputClass}
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
              </Field>
            }
          >
            <TextInput label="Skill" placeholder="For example, Python" maxLength={100} value={skill} onChange={(event) => setSkill(event.target.value)} />
            <label className="block text-sm font-semibold">
              Minimum experience: {minYears} {minYears === 1 ? "year" : "years"}
              <input type="range" min={0} max={20} className="mt-1 w-full accent-brand" value={minYears} onChange={(event) => setMinYears(Number(event.target.value))} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={allRequired} onChange={(event) => setAllRequired(event.target.checked)} />
              Has every required skill
            </label>
            <div className="space-y-2 border-t border-ink/10 pt-4">
              <p className="text-sm font-semibold">What matters most</p>
              {WEIGHTS.map(([key, label]) => (
                <label key={key} className="block text-sm text-ink-soft">
                  {label}: {weights[key]}
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    className="mt-1 w-full accent-brand"
                    value={weights[key]}
                    onChange={(event) => setWeights({ ...weights, [key]: Number(event.target.value) })}
                  />
                </label>
              ))}
            </div>
          </SearchPanel>
        </div>
        <div className="min-w-0 lg:col-start-2 xl:col-start-3 xl:row-start-1 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
          <AgentChat jobId={id!} />
        </div>
        <div className="min-w-0 lg:col-start-2 xl:row-start-1" data-testid="candidate-results">
          <ErrorText error={matches.error} />
          {matches.isPending && <Skeletons />}
          {matches.data?.length === 0 && (
            <Card>
              <h2>No candidates match</h2>
              <p className="mt-1 text-sm text-ink-soft">
                {hasFilters
                  ? "Try fewer filters."
                  : "Nobody visible meets this job's work type, time zone, salary and experience limits."}
              </p>
            </Card>
          )}
          <div className="space-y-3">
            {matches.data?.map((match) => (
              <CandidateCard key={match.candidate.id} jobId={id!} match={match} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PipelinePage() {
  const { id } = useParams();
  const client = useQueryClient();
  const applications = useQuery({
    queryKey: ["pipeline", id],
    queryFn: () => api<RecruiterApplication[]>(`/org/jobs/${id}/applications`),
  });
  const move = useMutation({
    mutationFn: ({ applicationId, stage }: { applicationId: string; stage: Stage }) =>
      send("PATCH", `/org/applications/${applicationId}`, { stage }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["pipeline", id] }),
  });
  return (
    <div>
      <JobHeader jobId={id!} />
      <ErrorText error={applications.error ?? move.error} />
      <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {STAGES.map((stage) => {
          const items = applications.data?.filter((item) => item.stage === stage) ?? [];
          return (
            <section key={stage} className="rounded-2xl bg-subtle p-3" data-testid={`stage-${stage}`}>
              <h2 className="text-sm font-medium capitalize">
                {stage} ({items.length})
              </h2>
              <div className="mt-2 space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="rounded-xl border border-ink/15 bg-white p-3">
                    <p className="text-sm font-medium">{item.candidate.full_name || "Unnamed candidate"}</p>
                    <p className="text-xs text-ink-soft">{item.candidate.headline}</p>
                    {item.cover_note && (
                      <details className="mt-1 text-xs text-ink-soft">
                        <summary className="cursor-pointer">
                          {item.via_assistant ? "Note sent by their AI assistant" : "Note"}
                        </summary>
                        <p className="mt-1 whitespace-pre-wrap">{item.cover_note}</p>
                      </details>
                    )}
                    <select
                      aria-label={`Move ${item.candidate.full_name || "candidate"} to stage`}
                      className={`${inputClass} !py-1 capitalize`}
                      value={item.stage}
                      disabled={move.isPending}
                      onChange={(e) => move.mutate({ applicationId: item.id, stage: e.target.value as Stage })}
                    >
                      {STAGES.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
