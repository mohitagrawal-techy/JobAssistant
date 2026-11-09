import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api, send } from "../api/client";
import type { Job, LocationType, Role, User } from "../api/types";
import { homeFor, useCurrentUser } from "../auth";
import {
  Button,
  Card,
  ErrorText,
  Field,
  FilterChips,
  inputClass,
  JobFacts,
  LinkButton,
  PageTitle,
  SearchPanel,
  Skeletons,
  SkillTag,
  TextInput,
} from "../components/ui";

export function useFinishAuth() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return (user: User) => {
    client.setQueryData(["me"], user);
    navigate(homeFor(user));
  };
}

const GOOGLE_ERRORS: Record<string, string> = {
  cancelled: "Google sign-in was cancelled.",
  failed: "We couldn't sign you in with Google. Try again.",
  unverified: "Google hasn't verified this email address, so it can't be used to sign in.",
};

function GoogleButton({ role }: { role?: Role }) {
  const providers = useQuery({
    queryKey: ["auth-providers"],
    queryFn: () => api<{ google: boolean }>("/auth/providers"),
    staleTime: Infinity,
  });
  if (!providers.data?.google) return null;
  return (
    <>
      <a
        href={`/api/auth/google/start${role ? `?role=${role}` : ""}`}
        className="btn btn-secondary flex items-center justify-center gap-3 rounded-pill border-frame border-input bg-white px-4 py-2 text-sm font-semibold text-ink"
      >
        {/* Google's sign-in guidelines require its logo in these exact colours. */}
        <svg viewBox="0 0 18 18" className="h-[18px] w-[18px]" aria-hidden="true">
          <path fill="#EA4335" d="M9 3.48c1.69 0 2.83.73 3.48 1.34l2.54-2.48C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z" />
          <path fill="#4285F4" d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z" />
          <path fill="#FBBC05" d="M3.88 10.78A5.54 5.54 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A9.008 9.008 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.44 15.98 5.48 18 9 18z" />
        </svg>
        Continue with Google
      </a>
      <p className="my-4 flex items-center gap-3 text-sm text-ink-muted before:h-px before:flex-1 before:bg-ink/15 after:h-px after:flex-1 after:bg-ink/15">
        or
      </p>
    </>
  );
}

export function RoleAndConsentFields({
  role,
  consent,
  onRole,
  onConsent,
}: {
  role: Role;
  consent: boolean;
  onRole: (role: Role) => void;
  onConsent: (consent: boolean) => void;
}) {
  return (
    <>
      <Field label="I am">
        <select className={inputClass} value={role} onChange={(e) => onRole(e.target.value as Role)}>
          <option value="seeker">Looking for a job</option>
          <option value="recruiter">Hiring or recruiting</option>
        </select>
      </Field>
      <label className="flex gap-2 text-sm text-ink-soft">
        <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => onConsent(e.target.checked)} required />
        I agree that my data is processed to provide matching, and I can export or delete it at any time.
      </label>
    </>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const googleError = GOOGLE_ERRORS[params.get("google") ?? ""];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const finish = useFinishAuth();
  const login = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      send<User>("POST", "/auth/login", body),
    onSuccess: finish,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ email, password });
  };
  return (
    <div className="mx-auto max-w-sm">
      <PageTitle>Log in</PageTitle>
      {params.get("reset") === "1" && (
        <p role="status" className="mb-4 rounded-xl bg-positive p-3 text-sm text-ink">
          Your password is updated. Log in with your new password.
        </p>
      )}
      {googleError && (
        <p role="alert" className="mb-4 text-sm font-medium text-danger">
          {googleError}
        </p>
      )}
      <GoogleButton />
      <form onSubmit={submit} className="space-y-4">
        <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextInput label="Password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorText error={login.error} />
        <Button disabled={login.isPending} className="w-full">
          Log in
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="font-semibold text-brand underline">
            Forgot your password?
          </Link>
        </p>
      </form>
      <div className="mt-6 rounded-xl border border-ink/15 bg-white p-3 text-sm text-ink-soft">
        <p className="font-medium text-ink-soft">Demo accounts (after seeding)</p>
        <div className="mt-2 flex gap-2">
          <Button variant="secondary" onClick={() => login.mutate({ email: "demo-seeker@example.com", password: "demo-password" })}>
            Demo seeker
          </Button>
          <Button variant="secondary" onClick={() => login.mutate({ email: "demo-recruiter@example.com", password: "demo-password" })}>
            Demo recruiter
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const initialRole = new URLSearchParams(window.location.search).get("role");
  const [role, setRole] = useState<Role>(initialRole === "recruiter" ? "recruiter" : "seeker");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const finish = useFinishAuth();
  const register = useMutation({
    mutationFn: () => send<User>("POST", "/auth/register", { email, password, role, consent }),
    onSuccess: finish,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    register.mutate();
  };
  return (
    <div className="mx-auto max-w-sm">
      <PageTitle>Create your account</PageTitle>
      <GoogleButton role={initialRole === "recruiter" || initialRole === "seeker" ? initialRole : undefined} />
      <form onSubmit={submit} className="space-y-4">
        <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextInput label="Password (at least 8 characters)" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        <RoleAndConsentFields role={role} consent={consent} onRole={setRole} onConsent={setConsent} />
        <ErrorText error={register.error} />
        <Button disabled={register.isPending} className="w-full">
          Sign up
        </Button>
      </form>
    </div>
  );
}

type WorkType = "" | LocationType;
const WORK_TYPES: { id: WorkType; label: string }[] = [
  { id: "", label: "Any" },
  { id: "remote", label: "Remote" },
  { id: "hybrid", label: "Hybrid" },
  { id: "onsite", label: "On-site" },
];
const SEARCH_DELAY_MS = 300;

export function JobSearchPage() {
  const [urlParams, setUrlParams] = useSearchParams();
  const [keyword, setKeyword] = useState(urlParams.get("q") ?? "");
  const [skill, setSkill] = useState(urlParams.get("skill") ?? "");
  const [salary, setSalary] = useState(urlParams.get("min_salary_usd") ?? "");
  const [workType, setWorkType] = useState<WorkType>((urlParams.get("location_type") ?? "") as WorkType);
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState({ keyword, skill, salary });

  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied({ keyword: keyword.trim(), skill: skill.trim(), salary: salary.trim() });
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [keyword, skill, salary]);

  const filters = new URLSearchParams();
  if (applied.keyword) filters.set("q", applied.keyword);
  if (workType) filters.set("location_type", workType);
  if (applied.skill) filters.set("skill", applied.skill);
  if (applied.salary) filters.set("min_salary_usd", applied.salary);
  const filterKey = filters.toString();

  // Keeps the address shareable, and the Back button returns to the same search.
  useEffect(() => {
    setUrlParams(new URLSearchParams(filterKey), { replace: true });
  }, [filterKey, setUrlParams]);

  const jobs = useQuery({
    queryKey: ["jobs", filterKey, page],
    queryFn: () => {
      const query = new URLSearchParams(filterKey);
      query.set("page", String(page));
      return api<{ items: Job[]; total: number }>(`/jobs?${query}`);
    },
    placeholderData: keepPreviousData,
  });
  const pages = Math.max(1, Math.ceil((jobs.data?.total ?? 0) / 20));
  const hasFilters = Boolean(keyword || skill || salary || workType);
  const clear = () => {
    setKeyword("");
    setSkill("");
    setSalary("");
    setWorkType("");
    setPage(1);
  };

  return (
    <div>
      <PageTitle sub={jobs.data ? `${jobs.data.total} open ${jobs.data.total === 1 ? "job" : "jobs"}` : undefined}>
        Browse jobs
      </PageTitle>
      <div className="grid items-start gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        <SearchPanel
          hasFilters={hasFilters}
          onClear={clear}
          primary={
            <Field label="Search jobs">
              <input
                type="search"
                placeholder="Skill, title or keyword"
                maxLength={200}
                className={inputClass}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </Field>
          }
        >
          <div>
            <p className="mb-1.5 text-sm font-semibold">Work type</p>
            <FilterChips
              label="Work type"
              options={WORK_TYPES}
              value={workType}
              onChange={(value) => {
                setWorkType(value);
                setPage(1);
              }}
            />
          </div>
          <TextInput label="Skill" placeholder="For example, Python" maxLength={100} value={skill} onChange={(e) => setSkill(e.target.value)} />
          <div>
            <TextInput label="Minimum salary (USD a year)" type="number" min={0} step={5000} value={salary} onChange={(e) => setSalary(e.target.value)} />
            <p className="mt-1 text-xs text-ink-muted">Jobs in other currencies are converted. Jobs with no listed salary are hidden.</p>
          </div>
        </SearchPanel>

        <div className="min-w-0" aria-live="polite">
          <ErrorText error={jobs.error} />
          {jobs.isPending && <Skeletons />}
          <div className="space-y-3">
            {jobs.data?.items.map((job) => (
              <Card key={job.id} className="gap-6 lg:flex lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <Link to={`/jobs/${job.id}`} className="text-lg font-semibold leading-tight text-brand hover:underline">
                    {job.title}
                  </Link>
                  <p className="text-sm text-ink-soft">{job.organization_name}</p>
                  <JobFacts job={job} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 lg:mt-0 lg:max-w-[45%] lg:justify-end">
                  {job.required_skills.slice(0, 6).map((name) => (
                    <SkillTag key={name} name={name} />
                  ))}
                </div>
              </Card>
            ))}
            {jobs.data?.items.length === 0 && (
              <Card>
                <h2>No jobs match this search</h2>
                <p className="mt-1 text-sm text-ink-soft">Try fewer filters, or a single word such as a skill or job title.</p>
              </Card>
            )}
          </div>
          {pages > 1 && (
            <div className="mt-6 flex items-center gap-3">
              <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-sm text-ink-soft">
                Page {page} of {pages}
              </span>
              <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function JobDetailPage() {
  const { id } = useParams();
  const { data: user } = useCurrentUser();
  const client = useQueryClient();
  const job = useQuery({ queryKey: ["job", id], queryFn: () => api<Job>(`/jobs/${id}`) });
  const apply = useMutation({
    mutationFn: () => send("POST", "/applications", { job_id: id }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["applications"] }),
  });
  if (job.isPending) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (job.isError) return <ErrorText error={job.error} />;
  const data = job.data;
  return (
    <article>
      <PageTitle>{data.title}</PageTitle>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="order-2 lg:order-1">
          <p className="max-w-[75ch] whitespace-pre-wrap leading-7 text-ink">{data.description}</p>
        </Card>
        <Card className="order-1 lg:sticky lg:top-4 lg:order-2">
          <p className="font-semibold">{data.organization_name}</p>
          <JobFacts job={data} />
          {data.required_skills.length > 0 && (
            <>
              <h2 className="mt-4 text-sm">Required skills</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.required_skills.map((skill) => (
                  <SkillTag key={skill} name={skill} />
                ))}
              </div>
            </>
          )}
          <div className="mt-5 space-y-2">
            {user?.role === "seeker" && (
              <Button className="w-full" disabled={apply.isPending || apply.isSuccess} onClick={() => apply.mutate()}>
                {apply.isSuccess ? "Applied" : "Apply"}
              </Button>
            )}
            {!user && <LinkButton to="/register?role=seeker">Sign up to apply</LinkButton>}
            <ErrorText error={apply.error} />
          </div>
        </Card>
      </div>
    </article>
  );
}
