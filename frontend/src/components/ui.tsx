import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api } from "../api/client";
import type { Explanation, Job, Score } from "../api/types";
import { useTheme } from "../theme";

export const inputClass =
  "mt-1 w-full rounded-xl border-frame border-input bg-white px-3 py-2 text-sm font-normal text-ink placeholder:text-ink-muted";

type Variant = "primary" | "secondary" | "danger";

const variantStyles: Record<Variant, string> = {
  primary: "btn-primary border-accent-edge bg-accent text-on-accent",
  secondary: "btn-secondary border-input bg-white text-ink",
  danger: "btn-danger border-danger bg-danger text-white",
};
const buttonBase =
  "btn inline-block rounded-pill border-frame px-4 py-2 text-center text-sm font-semibold whitespace-nowrap disabled:opacity-50 disabled:shadow-none";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${buttonBase} ${variantStyles[variant]} ${className}`} {...props} />;
}

export function LinkButton({
  to,
  variant = "primary",
  children,
}: {
  to: string;
  variant?: Variant;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={`${buttonBase} ${variantStyles[variant]}`}>
      {children}
    </Link>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm font-semibold text-ink">
      {label}
      {children}
    </label>
  );
}

export function TextInput({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <Field label={label}>
      <input className={inputClass} {...props} />
    </Field>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm font-medium text-danger">
      {error instanceof Error ? error.message : "Something went wrong"}
    </p>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-6 min-w-0">
      <h1 className="font-display text-4xl leading-tight text-ink sm:text-5xl">{children}</h1>
      {sub && <p className="mt-2 text-ink-soft">{sub}</p>}
    </header>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border-frame border-line bg-white p-5 shadow-raised ${className}`}>
      {children}
    </section>
  );
}

export function Skeletons({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="h-32 animate-pulse rounded-3xl bg-white/70" />
      ))}
    </div>
  );
}

const SIDEBAR_KEY = "khoj-filters-collapsed";

function savedCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "true";
  } catch {
    return false;
  }
}

function PanelIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
      <path d={collapsed ? "m13 9 3 3-3 3" : "m16 9-3 3 3 3"} />
    </svg>
  );
}

/**
 * Left-hand search and filters. On desktop it collapses to a slim rail, and sets its own width
 * so the page's grid (an `auto` column) gives the space back to the results. On phones only
 * `primary` shows until filters are opened.
 */
export function SearchPanel({
  primary,
  children,
  hasFilters,
  onClear,
}: {
  primary: ReactNode;
  children: ReactNode;
  hasFilters: boolean;
  onClear: () => void;
}) {
  const [showFilters, setShowFilters] = useState(false);
  const [collapsed, setCollapsed] = useState(savedCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, String(next));
    } catch {
      // The panel still toggles for this visit when storage is blocked.
    }
  };
  return (
    <aside
      aria-label="Search and filters"
      className={`rounded-3xl border-frame border-line bg-white p-5 shadow-raised transition-[width] duration-150 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto ${
        collapsed ? "lg:w-[60px] lg:p-2.5" : "lg:w-[300px]"
      }`}
    >
      <div className={`mb-3 hidden items-center lg:flex ${collapsed ? "mb-0 justify-center" : "justify-between"}`}>
        {!collapsed && <p className="text-sm font-semibold">Filters</p>}
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand filters" : "Collapse filters"}
          title={collapsed ? "Expand filters" : "Collapse filters"}
          onClick={toggle}
          className="relative rounded-xl p-1.5 text-ink-soft hover:bg-subtle hover:text-ink"
        >
          <PanelIcon collapsed={collapsed} />
          {collapsed && hasFilters && (
            <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-white" data-testid="filters-active">
              <span className="sr-only">Filters are on</span>
            </span>
          )}
        </button>
      </div>
      <div className={`space-y-4 ${collapsed ? "lg:hidden" : ""}`}>
        {primary}
        <button
          type="button"
          aria-expanded={showFilters}
          onClick={() => setShowFilters(!showFilters)}
          className="text-sm font-semibold text-brand lg:hidden"
        >
          {showFilters ? "Hide filters" : "More filters"}
        </button>
        <div className={`space-y-4 lg:block ${showFilters ? "block" : "hidden"}`}>{children}</div>
        {hasFilters && (
          <Button type="button" variant="secondary" className="w-full" onClick={onClear}>
            Clear filters
          </Button>
        )}
      </div>
    </aside>
  );
}

export function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-pill border-frame px-3 py-1.5 text-sm font-medium ${
            value === option.id ? "border-ink bg-ink text-white" : "border-line bg-white text-ink hover:bg-subtle"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SkillTag({
  name,
  tone = "neutral",
}: {
  name: string;
  tone?: "neutral" | "match" | "missing";
}) {
  const styles = {
    neutral: "bg-canvas text-ink",
    match: "bg-positive text-ink",
    missing: "bg-highlight text-ink",
  }[tone];
  return <span className={`rounded-pill px-2.5 py-0.5 text-xs font-medium ${styles}`}>{name}</span>;
}

export function formatSalary(job: Job): string | null {
  if (job.salary_min == null && job.salary_max == null) return null;
  const format = (value: number) => value.toLocaleString("en-US");
  const range = [job.salary_min, job.salary_max]
    .filter((value): value is number => value != null)
    .map(format)
    .join(" – ");
  return `${job.currency} ${range}`;
}

/** The facts about a job, as tags so they scan quickly. Safe to place inside a paragraph. */
export function JobFacts({ job }: { job: Job }) {
  const salary = formatSalary(job);
  const place = job.location && job.location.toLowerCase() !== job.location_type ? job.location : null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      <span className="rounded-pill bg-canvas px-2.5 py-0.5 text-xs font-medium capitalize text-ink">
        {job.location_type}
      </span>
      {place && (
        <span className="rounded-pill bg-canvas px-2.5 py-0.5 text-xs font-medium text-ink">{place}</span>
      )}
      {salary && (
        <span className="rounded-pill bg-canvas px-2.5 py-0.5 text-xs font-medium text-ink">{salary}</span>
      )}
    </span>
  );
}

const STAR_POINTS = 14;

function starPath(): string {
  const points = Array.from({ length: STAR_POINTS * 2 }, (_, index) => {
    const radius = index % 2 === 0 ? 48 : 41;
    const angle = (Math.PI * index) / STAR_POINTS;
    return `${(50 + radius * Math.sin(angle)).toFixed(2)},${(50 - radius * Math.cos(angle)).toFixed(2)}`;
  });
  return points.join(" ");
}

export const STAR = starPath();

function scoreColor(total: number): string {
  if (total >= 75) return "var(--color-score-high)";
  if (total >= 50) return "var(--color-score-mid)";
  return "var(--color-score-low)";
}

function ScoreRing({ total, large }: { total: number; large: boolean }) {
  const score = Math.round(total);
  const circumference = 2 * Math.PI * 44;
  return (
    <div className={`relative shrink-0 ${large ? "h-28 w-28" : "h-[68px] w-[68px]"}`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r="44" fill="none" stroke="var(--color-grid)" strokeWidth="7" />
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          stroke={scoreColor(total)}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(circumference * Math.min(total, 100)) / 100} ${circumference}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-ink">
        <span className={`font-semibold leading-none ${large ? "text-3xl" : "text-lg"}`}>{score}</span>
        <span className={`leading-none text-ink-muted ${large ? "mt-1 text-sm" : "mt-0.5 text-[10px]"}`}>match</span>
      </div>
    </div>
  );
}

function ScoreSticker({ total, large }: { total: number; large: boolean }) {
  const score = Math.round(total);
  // Each score gets its own slight tilt, so a list looks hand-stickered but never jumps around.
  const tilt = (score % 15) - 7;
  return (
    <div
      className={`relative shrink-0 ${large ? "h-32 w-32" : "h-[68px] w-[68px]"}`}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <polygon points={STAR} transform="translate(3 3)" fill="var(--color-ink)" />
        <polygon
          points={STAR}
          fill={scoreColor(total)}
          stroke="var(--color-ink)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-ink">
        <span className={`font-display leading-none ${large ? "text-5xl" : "text-2xl"}`}>{score}</span>
        <span className={`font-semibold leading-none ${large ? "mt-1 text-sm" : "text-[10px]"}`}>match</span>
      </div>
    </div>
  );
}

export function ScoreBadge({ total, large = false }: { total: number; large?: boolean }) {
  const { theme } = useTheme();
  const Badge = theme === "professional" ? ScoreRing : ScoreSticker;
  return <Badge total={total} large={large} />;
}

export function SkillComparison({ score }: { score: Score }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {[...score.matched_required, ...score.matched_nice].map((skill) => (
        <SkillTag key={skill} name={`✓ ${skill}`} tone="match" />
      ))}
      {score.missing_required.map((skill) => (
        <SkillTag key={skill} name={`needs ${skill}`} tone="missing" />
      ))}
      {score.missing_nice.map((skill) => (
        <SkillTag key={skill} name={`nice: ${skill}`} />
      ))}
    </div>
  );
}

export function ExplanationPanel({ path }: { path: string }) {
  const query = useQuery({
    queryKey: ["explanation", path],
    queryFn: () => api<Explanation>(path),
    staleTime: 60_000,
  });
  if (query.isPending) {
    return (
      <p className="mt-3 text-sm text-ink-muted" role="status">
        Writing explanation with the local AI model, this can take a little while…
      </p>
    );
  }
  if (query.isError) return <ErrorText error={query.error} />;
  const { summary, strengths, gaps, source } = query.data;
  return (
    <div className="mt-3 space-y-3 rounded-2xl bg-subtle p-4 text-sm" data-testid="explanation">
      <p>{summary}</p>
      {strengths.length > 0 && <PointList title="What fits" points={strengths} />}
      {gaps.length > 0 && <PointList title="What's missing" points={gaps} />}
      <p className="text-xs text-ink-muted">
        {source === "ai"
          ? "Explained by AI. The score itself is calculated by fixed rules."
          : "AI is unavailable, so this summary comes straight from the score."}
      </p>
    </div>
  );
}

function PointList({ title, points }: { title: string; points: Explanation["strengths"] }) {
  return (
    <div>
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 list-inside list-disc">
        {points.map((point) => (
          <li key={point.skill}>
            <b>{point.skill}:</b> {point.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
