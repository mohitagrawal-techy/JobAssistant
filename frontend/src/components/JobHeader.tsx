import { useQuery } from "@tanstack/react-query";
import { Link, NavLink } from "react-router-dom";

import { api } from "../api/client";
import type { OwnedJob } from "../api/types";

const TABS = [
  { path: "insights", label: "Insights" },
  { path: "candidates", label: "Candidates" },
  { path: "pipeline", label: "Pipeline" },
  { path: "edit", label: "Edit job" },
];

/** The title and tabs shared by every page of a posted job. */
export function JobHeader({ jobId }: { jobId: string }) {
  const job = useQuery({ queryKey: ["org-job", jobId], queryFn: () => api<OwnedJob>(`/org/jobs/${jobId}`) });
  return (
    <header className="mb-6">
      <Link to="/recruiter/jobs" className="text-sm font-medium text-brand hover:underline">
        Our jobs
      </Link>
      <h1 className="mt-1 font-display text-3xl leading-tight text-ink sm:text-4xl">{job.data?.title ?? " "}</h1>
      <nav aria-label="Job sections" className="mt-4 flex gap-1 overflow-x-auto border-b border-ink/15">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={`/recruiter/jobs/${jobId}/${tab.path}`}
            className={({ isActive }) =>
              `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${
                isActive ? "border-brand text-brand" : "border-transparent text-ink-soft hover:text-ink"
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
