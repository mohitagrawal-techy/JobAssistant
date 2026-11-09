import type { ReactNode } from "react";

import type { Candidate } from "../api/types";
import { AVAILABILITY_LABELS } from "../api/types";
import { Timeline } from "./Timeline";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-semibold text-ink">{title}</p>
      {children}
    </div>
  );
}

/** The candidate's full profile, expanded on demand so ranked lists stay easy to scan. */
export function CandidateDetails({ candidate }: { candidate: Candidate }) {
  const hasTimeline = candidate.work_history.length + candidate.projects.length + candidate.education.length > 0;
  const links = Object.entries(candidate.links).filter(([, url]) => url);
  const prefs = [
    AVAILABILITY_LABELS[candidate.availability],
    candidate.open_to_relocate ? "Open to relocating" : "",
    ...candidate.job_types,
  ].filter(Boolean);

  return (
    <details className="mt-2 text-sm text-ink-soft">
      <summary className="cursor-pointer font-medium text-brand">View full profile</summary>
      <div className="mt-2 space-y-3">
        {candidate.summary && <p className="max-w-[75ch]">{candidate.summary}</p>}
        {hasTimeline && (
          <Block title="Background">
            <div className="mt-1.5">
              <Timeline work={candidate.work_history} projects={candidate.projects} education={candidate.education} compact />
            </div>
          </Block>
        )}
        {candidate.certifications.length > 0 && <Block title="Certifications">{candidate.certifications.join(", ")}</Block>}
        {candidate.languages.length > 0 && <Block title="Languages">{candidate.languages.join(", ")}</Block>}
        {prefs.length > 0 && <Block title="Availability and preferences">{prefs.join(", ")}</Block>}
        {links.length > 0 && (
          <Block title="Links">
            <div className="flex flex-wrap gap-3">
              {links.map(([name, url]) => (
                <a key={name} href={url} target="_blank" rel="noopener noreferrer" className="capitalize text-brand underline">
                  {name}
                </a>
              ))}
            </div>
          </Block>
        )}
      </div>
    </details>
  );
}
