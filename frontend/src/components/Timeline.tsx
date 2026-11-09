import type { EducationEntry, ProjectEntry, WorkEntry } from "../api/types";

type Kind = "Work" | "Project" | "Education";

type TimelineEvent = {
  kind: Kind;
  title: string;
  subtitle: string;
  period: string;
  description: string;
  tags: string[];
  url: string;
  sortKey: string;
};

const KIND_STYLES: Record<Kind, { dot: string; tag: string }> = {
  Work: { dot: "bg-brand", tag: "bg-brand text-white" },
  Project: { dot: "bg-project", tag: "bg-project text-on-project" },
  Education: { dot: "bg-highlight ring-1 ring-ink/30", tag: "bg-highlight text-ink" },
};

const ONGOING = "9999";

function period(start: string, end: string, current: boolean, ongoingWord: string): string {
  return [start, current ? ongoingWord : end].filter(Boolean).join(" to ");
}

function buildEvents(work: WorkEntry[], projects: ProjectEntry[], education: EducationEntry[]): TimelineEvent[] {
  const events: TimelineEvent[] = [
    ...work
      .filter((job) => job.title.trim() || job.company.trim())
      .map((job) => ({
        kind: "Work" as const,
        title: job.title || job.company,
        subtitle: job.title ? job.company : "",
        period: period(job.start, job.end, job.current, "present"),
        description: job.description,
        tags: [],
        url: "",
        sortKey: job.current ? ONGOING : job.end || job.start,
      })),
    ...projects
      .filter((project) => project.name.trim())
      .map((project) => ({
        kind: "Project" as const,
        title: project.name,
        subtitle: project.role,
        period: period(project.start, project.end, project.current, "ongoing"),
        description: project.description,
        tags: project.technologies,
        url: project.url,
        sortKey: project.current ? ONGOING : project.end || project.start,
      })),
    ...education
      .filter((item) => item.degree.trim() || item.institution.trim())
      .map((item) => ({
        kind: "Education" as const,
        title: item.degree || item.institution,
        subtitle: item.degree ? item.institution : "",
        period: item.year ? String(item.year) : "",
        description: "",
        tags: [],
        url: "",
        sortKey: item.year ? String(item.year) : "",
      })),
  ];
  return events.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
}

function yearLabel(sortKey: string): string {
  if (sortKey === ONGOING) return "Now";
  return sortKey ? sortKey.slice(0, 4) : "Undated";
}

/** Work, projects and education as one story, most recent first. */
export function Timeline({
  work,
  projects,
  education,
  compact = false,
}: {
  work: WorkEntry[];
  projects: ProjectEntry[];
  education: EducationEntry[];
  compact?: boolean;
}) {
  const events = buildEvents(work, projects, education);
  if (events.length === 0) return null;
  const yearWidth = compact ? "w-12" : "w-16";
  let previousYear: string | null = null;

  return (
    <ol data-testid="timeline">
      {events.map((event, index) => {
        const year = yearLabel(event.sortKey);
        const showYear = year !== previousYear;
        previousYear = year;
        const isLast = index === events.length - 1;
        return (
          <li key={`${event.kind}-${index}`} className="flex gap-3">
            <div className={`shrink-0 pt-0.5 text-right font-semibold text-ink ${yearWidth} ${compact ? "text-xs" : "text-sm"}`}>
              {showYear ? year : ""}
            </div>
            <div className="relative flex w-3 shrink-0 justify-center" aria-hidden="true">
              <span className={`mt-1.5 h-3 w-3 rounded-full ${KIND_STYLES[event.kind].dot}`} />
              {!isLast && <span className="absolute bottom-0 top-5 w-0.5 bg-line" />}
            </div>
            <div className={`min-w-0 flex-1 ${isLast ? "" : compact ? "pb-3" : "pb-6"}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className={`font-semibold text-ink ${compact ? "text-sm" : ""}`}>{event.title}</p>
                <span className={`rounded-pill px-2 py-px text-[11px] font-medium ${KIND_STYLES[event.kind].tag}`}>{event.kind}</span>
              </div>
              {(event.subtitle || event.period) && (
                <p className={`text-ink-soft ${compact ? "text-xs" : "text-sm"}`}>
                  {[event.subtitle, event.period].filter(Boolean).join(", ")}
                </p>
              )}
              {event.description && (
                <p className={`mt-1 max-w-[70ch] text-ink-soft ${compact ? "text-xs" : "text-sm"}`}>{event.description}</p>
              )}
              {event.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {event.tags.map((tag) => (
                    <span key={tag} className="rounded-pill bg-canvas px-2 py-px text-[11px] font-medium text-ink">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {event.url && (
                <a href={event.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm text-brand underline">
                  View project
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
