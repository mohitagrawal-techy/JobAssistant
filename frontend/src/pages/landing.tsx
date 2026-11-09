import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import type { Job } from "../api/types";
import { homeFor, useCurrentUser } from "../auth";
import { Logo } from "../components/Logo";
import { Button, ErrorText, JobFacts, LinkButton, ScoreBadge } from "../components/ui";

const SEARCH_DELAY_MS = 250;
const PREVIEW_COUNT = 3;
const SUGGESTIONS = ["Python", "React", "Data Engineer", "Designer", "Kubernetes"];

const COPY = {
  title: "Find opportunities that",
  accent: "fit you.",
  lead: "Search real openings right here. Sign up and every job gets a score that tells you why it fits and what's missing.",
  placeholder: "Try a skill or a job title",
};

const SCORE_PARTS = [
  { id: "skills", label: "Skills", points: 50, color: "var(--color-chart-1)", detail: "Do you have what the job asks for?" },
  { id: "similarity", label: "Similarity", points: 25, color: "var(--color-chart-2)", detail: "How close is your background to the role?" },
  { id: "experience", label: "Experience", points: 15, color: "var(--color-chart-3)", detail: "Your years against the job's minimum." },
  { id: "logistics", label: "Logistics", points: 10, color: "var(--color-chart-4)", detail: "Work type, time zone and salary." },
] as const;

const NEVER_SCORED = ["Name", "Age", "Gender", "Contact details"];

const SAMPLE_REQUIRED = ["Python", "PostgreSQL", "Docker", "AWS"];
const SAMPLE_NICE = ["Kubernetes", "Redis"];
const SAMPLE_START = ["Python", "PostgreSQL", "Docker", "Redis"];
const SAMPLE_FIXED_POINTS = { similarity: 19, experience: 15, logistics: 10 };
// Mirrors REQUIRED_SKILL_SHARE in backend/app/matching/scoring.py.
const REQUIRED_SKILL_SHARE = 0.8;

function HeroScenery() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-panel" aria-hidden="true">
      <svg
        viewBox="0 0 1440 240"
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-x-0 bottom-0 h-[240px] w-full"
      >
        <path fill="#8a3a8f" d="M0 240V70L130 42L270 66L420 26L560 62L700 30L850 58L1010 14L1140 48L1290 20L1440 54V240Z" />
        <path fill="#4c1d78" d="M0 240V92L190 58L330 84L500 44L670 88L860 48L1060 90L1210 36L1320 70L1440 62V240Z" />
        <path fill="#2a1158" d="M0 240V118L220 84L420 112L640 78L820 112L1010 80L1240 116L1440 88V240Z" />
      </svg>
    </div>
  );
}

function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="var(--color-accent)" aria-hidden="true">
      <path d="M12 1C12.9 8 15 10.5 23 12C15 13.5 12.9 16 12 23C11.1 16 9 13.5 1 12C9 10.5 11.1 8 12 1Z" />
    </svg>
  );
}

function SkillToggle({ skill, checked, onToggle }: { skill: string; checked: boolean; onToggle: () => void }) {
  return (
    <label
      className={`relative cursor-pointer rounded-pill border-frame px-3 py-1.5 text-sm font-medium text-ink select-none has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand ${
        checked ? "border-transparent bg-positive" : "border-input bg-white hover:bg-subtle"
      }`}
    >
      <input type="checkbox" className="sr-only" checked={checked} onChange={onToggle} />
      {checked ? `✓ ${skill}` : skill}
    </label>
  );
}

function SampleMatch({ className }: { className: string }) {
  const [have, setHave] = useState(() => new Set(SAMPLE_START));
  const toggle = (skill: string) => {
    const next = new Set(have);
    if (!next.delete(skill)) next.add(skill);
    setHave(next);
  };

  const share = (skills: string[]) => skills.filter((skill) => have.has(skill)).length / skills.length;
  const skillPoints = Math.round(
    50 * (REQUIRED_SKILL_SHARE * share(SAMPLE_REQUIRED) + (1 - REQUIRED_SKILL_SHARE) * share(SAMPLE_NICE)),
  );
  const earned = { skills: skillPoints, ...SAMPLE_FIXED_POINTS };
  const total = Object.values(earned).reduce((sum, points) => sum + points, 0);
  const missing = SAMPLE_REQUIRED.filter((skill) => !have.has(skill));

  const group = (label: string, skills: string[]) => (
    <div>
      <p className="text-sm text-ink-soft">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {skills.map((skill) => (
          <SkillToggle key={skill} skill={skill} checked={have.has(skill)} onToggle={() => toggle(skill)} />
        ))}
      </div>
    </div>
  );

  return (
    <section
      aria-labelledby="sample-match-title"
      className={`rounded-3xl border-frame border-line bg-white p-5 text-ink shadow-raised ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="pt-1">
          <h2 id="sample-match-title" className="text-xl! leading-tight">
            Example: Senior Backend Engineer
          </h2>
          <p className="mt-1.5 text-sm text-ink-soft">Tick the skills you have. The rest of this example stays fixed.</p>
        </div>
        <ScoreBadge total={total} large />
      </div>

      <fieldset className="mt-2 space-y-2.5">
        <legend className="sr-only">Skills you have</legend>
        {group("Required", SAMPLE_REQUIRED)}
        {group("Nice to have", SAMPLE_NICE)}
      </fieldset>

      <dl className="mt-4 space-y-1.5">
        {SCORE_PARTS.map((part) => (
          <div key={part.id} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-sm">
            <dt className="font-medium">{part.label}</dt>
            <dd className="contents">
              <span className="h-2 overflow-hidden rounded-pill bg-grid" aria-hidden="true">
                <span
                  className="block h-full rounded-pill transition-[width] duration-200"
                  style={{ width: `${(earned[part.id] / part.points) * 100}%`, background: part.color }}
                />
              </span>
              <span className="w-[4.25rem] whitespace-nowrap text-right tabular-nums text-ink-soft">
                {earned[part.id]} of {part.points}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p role="status" className="min-w-0 flex-1 basis-40 text-sm font-medium">
          <span className="sr-only">Match score {total} out of 100. </span>
          {missing.length ? `Still needed: ${missing.join(", ")}` : "You have every required skill"}
        </p>
        <LinkButton to="/register?role=seeker">Sign up to score real jobs</LinkButton>
      </div>
    </section>
  );
}

function ResultsSkeleton() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: PREVIEW_COUNT }, (_, index) => (
        <div key={index} className="p-3">
          <div className="h-5 w-48 max-w-full rounded-pill bg-canvas" />
          <div className="mt-2 h-4 w-32 max-w-full rounded-pill bg-subtle" />
        </div>
      ))}
    </div>
  );
}

function Hero() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(draft.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  const jobs = useQuery({
    queryKey: ["landing-jobs", query],
    queryFn: () =>
      api<{ items: Job[]; total: number }>(`/jobs?${new URLSearchParams(query ? { q: query } : {})}`),
    placeholderData: keepPreviousData,
  });

  const allJobsPath = query ? `/jobs?${new URLSearchParams({ q: query })}` : "/jobs";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    navigate(draft.trim() ? `/jobs?${new URLSearchParams({ q: draft.trim() })}` : "/jobs");
  };

  return (
    <section className="hero-sunset relative rounded-panel px-5 pb-6 pt-8 text-white sm:px-10 sm:pb-8 sm:pt-12">
      <HeroScenery />
      {/* DOM order follows the desktop layout. Below xl, jobs move up so results stay next to the search box. */}
      <div className="relative grid grid-cols-[minmax(0,1fr)] gap-y-8 xl:grid-cols-[minmax(0,1fr)_27rem] xl:gap-x-10 xl:gap-y-24">
        <div>
          <p className="mb-5 inline-flex items-center gap-2 rounded-pill border border-white/40 px-3.5 py-1.5 text-sm font-medium">
            <Sparkle />
            AI-powered job search
          </p>
          <h1 className="text-balance font-display text-[clamp(2.75rem,5vw,4.5rem)] leading-[1.06]">
            {COPY.title} <span className="text-accent">{COPY.accent}</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-white/90">{COPY.lead}</p>

          <form
            onSubmit={submit}
            className="mt-7 flex max-w-2xl items-center gap-2 rounded-pill border-frame border-line bg-white p-1.5 shadow-raised focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-highlight"
          >
            <input
              type="search"
              aria-label="Search jobs"
              placeholder={COPY.placeholder}
              maxLength={200}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-w-0 flex-1 bg-transparent px-4 py-2 text-lg text-ink placeholder:text-ink-muted focus-visible:outline-none"
            />
            <Button className="shrink-0">Search</Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTIONS.map((term) => {
              const active = draft.trim() === term;
              return (
                <button
                  key={term}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDraft(active ? "" : term)}
                  className={`rounded-pill px-3 py-1.5 text-sm font-medium sm:py-1 ${active ? "bg-white text-ink" : "bg-white/15 text-white hover:bg-white/25"}`}
                >
                  {term}
                </button>
              );
            })}
          </div>
          <p className="mt-5 text-sm text-white">
            Hiring instead?{" "}
            <Link to="/register?role=recruiter" className="font-semibold underline">
              Sign up to rank your applicants
            </Link>
          </p>
        </div>

        <SampleMatch className="order-3 -mb-20 xl:order-none xl:mb-0 xl:self-start" />

        <div
          className="order-2 rounded-3xl border-frame border-line bg-white p-2 text-ink shadow-raised sm:p-3 xl:order-none xl:col-span-2 xl:-mb-40"
          data-testid="landing-results"
        >
          <ErrorText error={jobs.error} />
          {jobs.isPending && <ResultsSkeleton />}
          {jobs.data?.items.slice(0, PREVIEW_COUNT).map((job) => (
            <Link
              key={job.id}
              to={`/jobs/${job.id}`}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-2xl p-3 hover:bg-subtle"
            >
              <span>
                <span className="block text-lg font-semibold leading-tight text-brand">{job.title}</span>
                <span className="text-sm text-ink-soft">{job.organization_name}</span>
              </span>
              <JobFacts job={job} />
            </Link>
          ))}
          {jobs.data?.total === 0 && (
            <p className="p-3 text-sm text-ink-soft">
              No open jobs mention "{query}" yet. Try one word, like a skill or a job title.
            </p>
          )}
          <p className="border-t border-ink/10 px-3 pb-1 pt-3 text-sm" aria-live="polite">
            <Link to={allJobsPath} className="font-semibold text-brand underline">
              {jobs.data ? `See all ${jobs.data.total} ${jobs.data.total === 1 ? "job" : "jobs"}` : "See all jobs"}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

function ScoringRules() {
  return (
    <section className="grid gap-x-16 gap-y-8 lg:grid-cols-2">
      <div>
        <h2 className="heading-display text-3xl! leading-tight sm:text-4xl!">The same rules for everyone</h2>
        <p className="mt-3 max-w-xl text-lg text-ink-soft">
          AI reads resumes and explains results, but it doesn't decide the number. Fixed rules do,
          and they add up to 100.
        </p>
        <h3 className="mt-6 font-semibold">Never part of your score</h3>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-lg">
          {NEVER_SCORED.map((item) => (
            <li key={item} className="line-through decoration-accent decoration-2">
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-ink-muted">Hiring teams can change how much each part counts in their own searches.</p>
      </div>
      <div>
        <dl className="divide-y divide-ink/15">
          {SCORE_PARTS.map((part) => (
            <div key={part.id} className="grid grid-cols-[4rem_1fr] gap-x-3 py-3 first:pt-0">
              <dt className="col-start-2 flex items-center gap-2 font-semibold">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: part.color }} aria-hidden="true" />
                {part.label}
              </dt>
              <dd className="col-start-2 text-ink-soft">{part.detail}</dd>
              <dd className="col-start-1 row-span-2 row-start-1 self-center font-display text-4xl font-bold leading-none tabular-nums">
                {part.points}
                <span className="sr-only"> points</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function AudiencePanel({
  title,
  points,
  to,
  action,
  className,
}: {
  title: string;
  points: string[];
  to: string;
  action: string;
  className: string;
}) {
  return (
    <div className={`flex flex-col rounded-panel border-frame border-line p-7 ${className}`}>
      <h2 className="heading-display text-3xl!">{title}</h2>
      <ul className="mb-6 mt-3 divide-y divide-current/20">
        {points.map((point) => (
          <li key={point} className="py-2.5">
            {point}
          </li>
        ))}
      </ul>
      <div className="mt-auto">
        <LinkButton to={to} variant="secondary">
          {action}
        </LinkButton>
      </div>
    </div>
  );
}

export function LandingPage() {
  const { data: user } = useCurrentUser();
  if (user) return <Navigate to={homeFor(user)} replace />;

  return (
    <div className="space-y-16 pt-6 sm:pt-8">
      <Hero />

      <div className="space-y-16 pt-14 xl:pt-36">
        <ScoringRules />

        <section className="grid gap-4 md:grid-cols-[1.25fr_1fr]">
          <AudiencePanel
            title="Looking for work"
            className="bg-brand text-white"
            to="/register?role=seeker"
            action="Sign up to find jobs"
            points={[
              "Upload your resume once and check what we pulled from it.",
              'See jobs ranked for you, with a plain answer to "why this job?"',
              "Let the assistant apply to strong matches, with your say-so.",
              "Hide your profile, export your data or delete it anytime.",
            ]}
          />
          <AudiencePanel
            title="Hiring"
            className="bg-highlight text-ink"
            to="/register?role=recruiter"
            action="Sign up to hire"
            points={[
              "Turn a short brief into a full job post.",
              "Ask the assistant who to look at first.",
              "See where applicants fall short, and who's waited too long.",
            ]}
          />
        </section>

        <div className="text-center text-ink">
          <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Logo className="text-2xl" markClassName="h-10 w-auto" />
            <span className="text-lg text-ink-soft">Discover What's Next.</span>
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            <span lang="hi" className="font-devanagari text-base">खोज</span> (khoj) is Hindi for search.
          </p>
        </div>
      </div>
    </div>
  );
}
