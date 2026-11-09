import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api, send } from "../api/client";
import type { JobMatch, Profile, SeekerApplication, Stage } from "../api/types";
import {
  Button,
  Card,
  ErrorText,
  ExplanationPanel,
  Field,
  inputClass,
  FilterChips,
  JobFacts,
  LinkButton,
  SearchPanel,
  Skeletons,
  SkillComparison,
  PageTitle,
  ScoreBadge,
  TextInput,
} from "../components/ui";

function MatchCard({ match }: { match: JobMatch }) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const apply = useMutation({
    mutationFn: () => send("POST", "/applications", { job_id: match.job.id }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["matches"] });
      client.invalidateQueries({ queryKey: ["applications"] });
    },
  });
  return (
    <Card>
      <div className="flex items-start gap-4">
        <ScoreBadge total={match.score.total} />
        <div className="min-w-0 flex-1 gap-6 lg:flex lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Link to={`/jobs/${match.job.id}`} className="text-lg font-semibold leading-tight text-brand hover:underline">
              {match.job.title}
            </Link>
            <p className="text-sm text-ink-soft">{match.job.organization_name}</p>
            <JobFacts job={match.job} />
            <div className="mt-2">
              <SkillComparison score={match.score} />
            </div>
          </div>
          <div className="mt-3 flex shrink-0 flex-wrap gap-2 lg:mt-0">
            <Button variant="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "Hide reasons" : "Why this match?"}
            </Button>
            <Button disabled={match.applied || apply.isPending} onClick={() => apply.mutate()}>
              {match.applied ? "Applied" : "Apply"}
            </Button>
          </div>
        </div>
      </div>
      <ErrorText error={apply.error} />
      {open && <ExplanationPanel path={`/matches/jobs/${match.job.id}/explanation`} />}
    </Card>
  );
}

type WorkType = "" | "remote" | "hybrid" | "onsite";
const WORK_TYPES: { id: WorkType; label: string }[] = [
  { id: "", label: "Any" },
  { id: "remote", label: "Remote" },
  { id: "hybrid", label: "Hybrid" },
  { id: "onsite", label: "On-site" },
];
const MATCHES_PER_PAGE = 20;

export function MatchesPage() {
  const [keyword, setKeyword] = useState("");
  const [skill, setSkill] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [workType, setWorkType] = useState<WorkType>("");
  const [hideApplied, setHideApplied] = useState(false);
  const [visible, setVisible] = useState(MATCHES_PER_PAGE);
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api<Profile>("/profile") });
  const matches = useQuery({ queryKey: ["matches"], queryFn: () => api<JobMatch[]>("/matches/jobs") });

  useEffect(() => setVisible(MATCHES_PER_PAGE), [keyword, skill, minScore, workType, hideApplied]);

  const needsProfile = profile.data?.skills.length === 0;
  const term = keyword.trim().toLowerCase();
  const skillTerm = skill.trim().toLowerCase();
  const shown = (matches.data ?? []).filter(({ job, score, applied }) => {
    const skills = [...job.required_skills, ...job.nice_to_have_skills];
    if (score.total < minScore) return false;
    if (workType && job.location_type !== workType) return false;
    if (hideApplied && applied) return false;
    if (skillTerm && !skills.some((name) => name.includes(skillTerm))) return false;
    if (term && ![job.title, job.organization_name, ...skills].some((text) => text.toLowerCase().includes(term))) return false;
    return true;
  });
  const hasFilters = Boolean(keyword || skill || minScore || workType || hideApplied);
  const clear = () => {
    setKeyword("");
    setSkill("");
    setMinScore(0);
    setWorkType("");
    setHideApplied(false);
  };

  return (
    <div>
      <PageTitle
        sub={
          matches.data && !needsProfile
            ? `${shown.length} of your top ${matches.data.length} matches, ranked for your skills, experience and preferences.`
            : "Ranked for your skills, experience and preferences."
        }
      >
        Your matches
      </PageTitle>
      <ErrorText error={matches.error} />
      {needsProfile ? (
        <Card className="max-w-2xl">
          <h2>Start with your resume</h2>
          <p className="mt-1 text-ink-soft">
            We need your skills to rank jobs for you. Upload a resume and check what we found. It takes about a minute.
          </p>
          <div className="mt-4">
            <LinkButton to="/profile">Add your resume</LinkButton>
          </div>
        </Card>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
          <SearchPanel
            hasFilters={hasFilters}
            onClear={clear}
            primary={
              <Field label="Search your matches">
                <input
                  type="search"
                  placeholder="Title, company or skill"
                  maxLength={200}
                  className={inputClass}
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
              </Field>
            }
          >
            <label className="block text-sm font-semibold">
              Minimum match score: {minScore}
              <input type="range" min={0} max={100} step={5} className="mt-1 w-full accent-brand" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))} />
            </label>
            <div>
              <p className="mb-1.5 text-sm font-semibold">Work type</p>
              <FilterChips label="Work type" options={WORK_TYPES} value={workType} onChange={setWorkType} />
            </div>
            <TextInput label="Skill" placeholder="For example, Python" maxLength={100} value={skill} onChange={(event) => setSkill(event.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={hideApplied} onChange={(event) => setHideApplied(event.target.checked)} />
              Hide jobs I've applied to
            </label>
          </SearchPanel>

          <div className="min-w-0">
            {matches.isPending && <Skeletons />}
            {matches.data && shown.length === 0 && (
              <Card>
                <h2>No matches with these filters</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  Try fewer filters, or{" "}
                  <Link className="text-brand underline" to="/profile">widen your preferences</Link>.
                </p>
              </Card>
            )}
            <div className="space-y-3">
              {shown.slice(0, visible).map((match) => (
                <MatchCard key={match.job.id} match={match} />
              ))}
            </div>
            {shown.length > visible && (
              <div className="mt-4">
                <Button variant="secondary" onClick={() => setVisible(visible + MATCHES_PER_PAGE)}>
                  Show more matches
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const PROGRESS: Stage[] = ["applied", "screening", "interview", "offer", "hired"];

function StageTracker({ stage }: { stage: Stage }) {
  if (stage === "rejected") {
    return <p className="text-sm font-medium text-ink-soft">Status: not moving forward</p>;
  }
  const current = PROGRESS.indexOf(stage);
  return (
    <ol className="flex w-full max-w-xl items-center" aria-label={`Application status: ${stage}`}>
      {PROGRESS.map((step, index) => (
        <li key={step} className={`flex items-center ${index < PROGRESS.length - 1 ? "flex-1" : ""}`}>
          <span className="flex flex-col items-center gap-1">
            <span className={`h-3 w-3 rounded-full ${index <= current ? "bg-brand" : "bg-canvas ring-1 ring-input"}`} />
            <span className={`text-[11px] capitalize sm:text-xs ${index === current ? "font-semibold text-ink" : "text-ink-muted"}`}>
              {step}
            </span>
          </span>
          {index < PROGRESS.length - 1 && (
            <span className={`mx-1 mb-4 h-0.5 flex-1 ${index < current ? "bg-brand" : "bg-line"}`} />
          )}
        </li>
      ))}
    </ol>
  );
}

export function ApplicationsPage() {
  const applications = useQuery({
    queryKey: ["applications"],
    queryFn: () => api<SeekerApplication[]>("/applications"),
  });
  return (
    <div>
      <PageTitle>Your applications</PageTitle>
      <ErrorText error={applications.error} />
      {applications.isPending && <Skeletons />}
      {applications.data?.length === 0 && (
        <Card className="max-w-2xl">
          <h2>Nothing sent yet</h2>
          <p className="mt-1 text-ink-soft">Apply to a match, or let your assistant prepare applications for you.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <LinkButton to="/matches">See your matches</LinkButton>
            <LinkButton to="/assistant" variant="secondary">Set up the assistant</LinkButton>
          </div>
        </Card>
      )}
      <div className="space-y-3">
        {applications.data?.map((application) => (
          <Card key={application.id} className="gap-6 lg:flex lg:items-center lg:justify-between">
            <div className="min-w-0 lg:w-1/3">
              <p className="text-lg font-semibold leading-tight">{application.job.title}</p>
              <p className="text-sm text-ink-soft">{application.job.organization_name}</p>
              {application.via_assistant && (
                <details className="mt-1 text-sm text-ink-soft">
                  <summary className="cursor-pointer">Sent by your assistant</summary>
                  <p className="mt-1 whitespace-pre-wrap">{application.cover_note}</p>
                </details>
              )}
            </div>
            <div className="mt-4 flex-1 lg:mt-0 lg:flex lg:justify-end">
              <StageTracker stage={application.stage} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function PrivacyPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api<Profile>("/profile") });
  const [confirming, setConfirming] = useState(false);

  const visibility = useMutation({
    mutationFn: (data: Profile) => {
      const { id: _id, has_embedding: _embedded, ...body } = data;
      return send<Profile>("PUT", "/profile", { ...body, is_visible: !data.is_visible });
    },
    onSuccess: (data) => client.setQueryData(["profile"], data),
  });
  const exportData = useMutation({
    mutationFn: () => api<unknown>("/profile/export"),
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "khoj-data.json";
      link.click();
      URL.revokeObjectURL(url);
    },
  });
  const remove = useMutation({
    mutationFn: () => send<void>("DELETE", "/account"),
    onSuccess: () => {
      client.clear();
      navigate("/");
    },
  });

  return (
    <div className="max-w-2xl space-y-4">
      <PageTitle>Privacy</PageTitle>
      <Card>
        <h2 className="font-medium">Visibility to recruiters</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {profile.data?.is_visible ? "Recruiters can find you in matches." : "You're hidden. Only employers you apply to can see your profile."}
        </p>
        {profile.data && (
          <Button variant="secondary" className="mt-3" disabled={visibility.isPending} onClick={() => visibility.mutate(profile.data)}>
            {profile.data.is_visible ? "Hide my profile" : "Make my profile visible"}
          </Button>
        )}
        <ErrorText error={visibility.error} />
      </Card>
      <Card>
        <h2 className="font-medium">Export your data</h2>
        <p className="mt-1 text-sm text-ink-soft">Download your profile, resumes data and applications as JSON.</p>
        <Button variant="secondary" className="mt-3" disabled={exportData.isPending} onClick={() => exportData.mutate()}>
          Download my data
        </Button>
        <ErrorText error={exportData.error} />
      </Card>
      <Card>
        <h2 className="font-medium">Delete your account</h2>
        <p className="mt-1 text-sm text-ink-soft">Permanently removes your profile, resumes and applications. This can't be undone.</p>
        {confirming ? (
          <div className="mt-3 flex gap-2">
            <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Yes, delete everything
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="danger" className="mt-3" onClick={() => setConfirming(true)}>
            Delete my account
          </Button>
        )}
        <ErrorText error={remove.error} />
      </Card>
    </div>
  );
}
