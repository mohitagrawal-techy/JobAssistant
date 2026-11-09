import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ApplicantInsight, ScoreBand, SkillCoverage } from "../api/types";

// Each theme defines these colours in index.css, validated for colourblind readability.
const SERIES = {
  first: "var(--color-chart-1)",
  second: "var(--color-chart-2)",
  third: "var(--color-chart-3)",
  fourth: "var(--color-chart-4)",
};
const SURFACE = "var(--color-surface)";
const GRID = "var(--color-grid)";
const AXIS_TEXT = { fill: "var(--color-ink-soft)", fontSize: 12 };
const TOOLTIP_STYLE = { fontSize: 12, borderRadius: "var(--radius-xl)", border: "1px solid var(--color-line)" };
const HOVER = { fill: "var(--color-subtle)" };

function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="mt-3 text-sm text-ink-soft">
      <summary className="cursor-pointer text-ink-soft">View as table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-ink/15">
              {headers.map((header) => (
                <th key={header} scope="col" className="py-1 pr-4 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row[0])} className="border-b border-ink/10">
                {row.map((cell, index) => (
                  <td key={index} className="py-1 pr-4">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ChartFrame({ height, label, children }: { height: number; label: string; children: ReactNode }) {
  return (
    <div role="img" aria-label={label} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

export function ScoreSpreadChart({ bands }: { bands: ScoreBand[] }) {
  return (
    <>
      <ChartFrame height={240} label="Number of applicants in each match score band">
        <BarChart data={bands} margin={{ top: 8, right: 8, bottom: 20, left: -20 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="label"
            tick={AXIS_TEXT}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            interval={0}
            angle={-35}
            textAnchor="end"
            height={36}
          />
          <YAxis allowDecimals={false} tick={AXIS_TEXT} tickLine={false} axisLine={false} />
          <Tooltip cursor={HOVER} contentStyle={TOOLTIP_STYLE} formatter={(value) => [value, "Applicants"]} labelFormatter={(label) => `Score ${label}`} />
          <Bar dataKey="count" fill="var(--color-chart-single)" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ChartFrame>
      <DataTable headers={["Score", "Applicants"]} rows={bands.map((band) => [band.label, band.count])} />
    </>
  );
}

export function SkillCoverageChart({ rows }: { rows: SkillCoverage[] }) {
  const data = rows.map((row) => ({ ...row, name: row.required ? row.skill : `${row.skill} (nice)` }));
  return (
    <>
      <ChartFrame height={rows.length * 34 + 40} label="Percentage of applicants who have each skill">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" domain={[0, 100]} unit="%" tick={AXIS_TEXT} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis type="category" dataKey="name" width={120} tick={AXIS_TEXT} tickLine={false} axisLine={false} interval={0} />
          <Tooltip cursor={HOVER} contentStyle={TOOLTIP_STYLE} formatter={(value, _name, item) => [`${value}% (${item.payload.count} applicants)`, "Have this skill"]} />
          <Bar dataKey="percent" barSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((row) => (
              <Cell key={row.skill} fill={row.required ? SERIES.first : SERIES.second} />
            ))}
          </Bar>
        </BarChart>
      </ChartFrame>
      <div className="mt-1 flex gap-4 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.first }} /> Required
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.second }} /> Nice to have
        </span>
      </div>
      <DataTable
        headers={["Skill", "Type", "Applicants with it", "Percent"]}
        rows={rows.map((row) => [row.skill, row.required ? "Required" : "Nice to have", row.count, `${row.percent}%`])}
      />
    </>
  );
}

const PARTS = [
  { key: "skills", label: "Skills", color: SERIES.first },
  { key: "semantic", label: "Similarity", color: SERIES.second },
  { key: "experience", label: "Experience", color: SERIES.third },
  { key: "logistics", label: "Logistics", color: SERIES.fourth },
] as const;

export function TopCandidatesChart({ candidates }: { candidates: ApplicantInsight[] }) {
  const data = candidates.map((candidate) => ({
    ...candidate,
    name: `${candidate.full_name || "Unnamed"} (${Math.round(candidate.total)})`,
  }));
  return (
    <>
      <ChartFrame height={candidates.length * 44 + 40} label="Score parts of the top applicants">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" domain={[0, 100]} tick={AXIS_TEXT} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis type="category" dataKey="name" width={160} tick={AXIS_TEXT} tickLine={false} axisLine={false} interval={0} />
          <Tooltip cursor={HOVER} contentStyle={TOOLTIP_STYLE} />
          {PARTS.map((part, index) => (
            <Bar
              key={part.key}
              dataKey={part.key}
              name={part.label}
              stackId="score"
              fill={part.color}
              stroke={SURFACE}
              strokeWidth={2}
              barSize={20}
              radius={index === PARTS.length - 1 ? [0, 4, 4, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartFrame>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        {PARTS.map((part) => (
          <span key={part.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: part.color }} /> {part.label}
          </span>
        ))}
      </div>
      <DataTable
        headers={["Candidate", "Total", "Skills", "Similarity", "Experience", "Logistics"]}
        rows={candidates.map((c) => [c.full_name || "Unnamed", c.total, c.skills, c.semantic, c.experience, c.logistics])}
      />
    </>
  );
}
