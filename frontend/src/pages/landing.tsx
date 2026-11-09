import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import type { Job } from "../api/types";
import { homeFor, useCurrentUser } from "../auth";
import { Button, ErrorText, JobFacts, LinkButton, ScoreBadge, STAR } from "../components/ui";
import { useTheme } from "../theme";

const SEARCH_DELAY_MS = 250;
const PREVIEW_COUNT = 3;
const SUGGESTIONS = ["Python", "React", "Data Engineer", "Designer", "Kubernetes"];

const COPY = {
  playful: {
    title: "Khoj your next job.",
    lead: "Search real openings right here. Sign up and every job gets a score that tells you why it fits and what's missing.",
    placeholder: "Try a skill or a job title",
  },
  professional: {
    title: "Search for roles that fit your experience.",
    lead: "Browse open positions below. Create an account to see how each one matches your background, and where the gaps are.",
    placeholder: "Search by skill or job title",
  },
};

const SCORE_PARTS = [
  { label: "Skills", points: 50, color: "var(--color-chart-1)", detail: "Do you have what the job asks for?" },
  { label: "Similarity", points: 25, color: "var(--color-chart-2)", detail: "How close is your background to the role?" },
  { label: "Experience", points: 15, color: "var(--color-chart-3)", detail: "Your years against the job's minimum." },
  { label: "Logistics", points: 10, color: "var(--color-chart-4)", detail: "Work type, time zone and salary." },
];

function NameSticker() {
  return (
    <div className="stamp absolute -top-7 right-3 h-28 w-28 rotate-6 sm:-top-10 sm:right-10 sm:h-44 sm:w-44">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <polygon points={STAR} transform="translate(3 3)" fill="var(--color-ink)" />
        <polygon
          points={STAR}
          fill="var(--color-highlight)"
          stroke="var(--color-ink)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>
      <p className="absolute inset-0 flex flex-col items-center justify-center text-ink">
        <span lang="hi" className="font-devanagari text-[1.9rem] font-extrabold leading-none sm:text-5xl">
          खोज
        </span>
        <span className="text-[11px] font-semibold leading-tight sm:mt-1 sm:text-sm">means search</span>
      </p>
    </div>
  );
}

function JobPreviews() {
  const { theme } = useTheme();
  const copy = COPY[theme];
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
    <>
      <form
        onSubmit={submit}
        className="mt-7 flex max-w-2xl items-center gap-2 rounded-pill border-frame border-line bg-white p-1.5 shadow-raised focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-highlight"
      >
        <input
          type="search"
          aria-label="Search jobs"
          placeholder={copy.placeholder}
          maxLength={200}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-4 py-2 text-lg text-ink placeholder:text-ink-muted focus-visible:outline-none"
        />
        <Button className="shrink-0">Search</Button>
      </form>
      <div className="mt-4 flex flex-wrap gap-2">
        {SUGGESTIONS.map((term) => (
          <button
            key={term}
            type="button"
            onClick={() => setDraft(term)}
            className="rounded-pill bg-white/15 px-3 py-1 text-sm font-medium text-white hover:bg-white/25"
          >
            {term}
          </button>
        ))}
      </div>

      <div
        className="mt-8 -mb-20 rounded-3xl border-frame border-line bg-white p-2 text-ink shadow-raised sm:p-3"
        data-testid="landing-results"
      >
        <ErrorText error={jobs.error} />
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
        <p className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/10 px-3 pb-1 pt-3 text-sm" aria-live="polite">
          <Link to={allJobsPath} className="font-semibold text-brand underline">
            {jobs.data ? `See all ${jobs.data.total} ${jobs.data.total === 1 ? "job" : "jobs"}` : "See all jobs"}
          </Link>
          <Link to="/register?role=seeker" className="text-ink-soft underline">
            Sign up to see your match score
          </Link>
        </p>
      </div>
    </>
  );
}

function ScoreExplainer() {
  return (
    <section className="grid items-center gap-8 md:grid-cols-[auto_1fr] md:gap-14">
      <div className="justify-self-center md:justify-self-start">
        <ScoreBadge total={87} large />
      </div>
      <div>
        <h2 className="heading-display text-3xl leading-tight sm:text-4xl">What's inside your score</h2>
        <p className="mt-2 max-w-xl text-ink-soft">
          The same rules for everyone, out of 100. AI reads resumes and explains results, but it
          doesn't decide the number. Your name, age and gender aren't part of it.
        </p>
        <div className="mt-5 flex h-5 gap-0.5 overflow-hidden rounded-pill" aria-hidden="true">
          {SCORE_PARTS.map((part) => (
            <span key={part.label} style={{ flexGrow: part.points, background: part.color }} />
          ))}
        </div>
        <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {SCORE_PARTS.map((part) => (
            <div key={part.label} className="flex gap-2.5">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: part.color }} />
              <div>
                <dt className="font-semibold">
                  {part.label}, {part.points} points
                </dt>
                <dd className="text-sm text-ink-soft">{part.detail}</dd>
              </div>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-ink-muted">Hiring teams can change how much each part counts in their own searches.</p>
      </div>
    </section>
  );
}

export function LandingPage() {
  const { data: user } = useCurrentUser();
  const { theme } = useTheme();
  if (user) return <Navigate to={homeFor(user)} replace />;
  const copy = COPY[theme];
  const playful = theme === "playful";

  return (
    <div className="space-y-16 pt-6 sm:pt-8">
      <section className="relative rounded-panel border-frame border-line bg-brand px-5 pb-6 pt-20 text-white sm:px-10 sm:pb-8 sm:pt-14">
        {playful && <NameSticker />}
        <h1 className={`text-balance font-display leading-[0.98] ${playful ? "max-w-3xl text-[clamp(3.4rem,11vw,7rem)]" : "max-w-3xl text-[clamp(2.6rem,7vw,4.5rem)] leading-[1.08]"}`}>
          {copy.title}
        </h1>
        <p className="mt-6 max-w-xl text-lg text-white/90">{copy.lead}</p>
        {!playful && (
          <p className="mt-3 text-sm text-white/80">
            <span lang="hi" className="font-devanagari text-base">खोज</span> (khoj) is Hindi for search.
          </p>
        )}
        <JobPreviews />
      </section>

      <div className="space-y-16 pt-14">
        <ScoreExplainer />

        <section className="grid gap-4 md:grid-cols-[1.25fr_1fr]">
          <div className="rounded-panel border-frame border-line bg-accent p-7 text-on-accent">
            <h2 className="heading-display text-3xl">Looking for work</h2>
            <ul className="mt-4 space-y-2">
              <li>Upload your resume once and check what we pulled from it.</li>
              <li>See jobs ranked for you, with a plain answer to "why this job?"</li>
              <li>Let the assistant apply to strong matches, with your say-so.</li>
              <li>Hide your profile, export your data or delete it anytime.</li>
            </ul>
            <div className="mt-6">
              <LinkButton to="/register?role=seeker" variant="secondary">I'm looking for a job</LinkButton>
            </div>
          </div>
          <div className="rounded-panel border-frame border-line bg-highlight p-7 text-ink">
            <h2 className="heading-display text-3xl">Hiring</h2>
            <ul className="mt-4 space-y-2">
              <li>Turn a short brief into a full job post.</li>
              <li>Ask the assistant who to look at first.</li>
              <li>See where applicants fall short, and who's waited too long.</li>
            </ul>
            <div className="mt-6">
              <LinkButton to="/register?role=recruiter" variant="secondary">I'm hiring</LinkButton>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
