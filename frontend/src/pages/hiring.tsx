import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api, send } from "../api/client";
import type {
  DescriptionCheck,
  GeneratedDescription,
  JobAnalytics,
  LocationType,
  OwnedJob,
} from "../api/types";
import { CURRENCIES } from "../api/types";
import { ScoreSpreadChart, SkillCoverageChart, TopCandidatesChart } from "../components/charts";
import { JobHeader } from "../components/JobHeader";
import { StageControl } from "../components/StageControl";
import {
  Button,
  Card,
  ErrorText,
  Field,
  inputClass,
  PageTitle,
  TextInput,
} from "../components/ui";

const MIN_APPLICANTS_FOR_CHARTS = 3;
const REFINEMENTS = ["Make it shorter", "Make it more senior", "Make the tone friendlier"];

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

export function JobWriterPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [title, setTitle] = useState("");
  const [seniority, setSeniority] = useState("");
  const [required, setRequired] = useState("");
  const [nice, setNice] = useState("");
  const [locationType, setLocationType] = useState<LocationType>("remote");
  const [location, setLocation] = useState("");
  const [minYears, setMinYears] = useState<number | null>(null);
  const [salaryMin, setSalaryMin] = useState<number | null>(null);
  const [salaryMax, setSalaryMax] = useState<number | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [notes, setNotes] = useState("");
  const [clientName, setClientName] = useState("");

  const [finalTitle, setFinalTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instruction, setInstruction] = useState("");
  const [check, setCheck] = useState<DescriptionCheck | null>(null);

  const requiredSkills = splitList(required);
  const brief = {
    title,
    seniority,
    required_skills: requiredSkills,
    nice_to_have_skills: splitList(nice),
    location_type: locationType,
    location,
    min_years: minYears,
    notes,
  };

  const generate = useMutation({
    mutationFn: (revision?: string) =>
      send<GeneratedDescription>("POST", "/org/jobs/generate-description", {
        brief,
        current_description: revision ? description : null,
        instruction: revision ?? null,
      }),
    onSuccess: (result) => {
      setFinalTitle(result.title);
      setDescription(result.description);
      setCheck(result);
      setInstruction("");
    },
  });

  const requiredKey = requiredSkills.join("|");
  useEffect(() => {
    if (!description) return;
    const timer = setTimeout(() => {
      send<DescriptionCheck>("POST", "/org/jobs/check-description", {
        description,
        required_skills: requiredKey ? requiredKey.split("|") : [],
        min_years: minYears,
      })
        .then(setCheck)
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [description, requiredKey, minYears]);

  const create = useMutation({
    mutationFn: () =>
      send<OwnedJob>("POST", "/org/jobs", {
        title: finalTitle,
        description,
        client_name: clientName || null,
        location_type: locationType,
        location,
        salary_min: salaryMin,
        salary_max: salaryMax,
        currency,
        min_years: minYears,
        required_skills: requiredSkills,
        nice_to_have_skills: splitList(nice),
      }),
    onSuccess: (job) => {
      client.invalidateQueries({ queryKey: ["org-jobs"] });
      navigate(`/recruiter/jobs/${job.id}/edit`);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    generate.mutate(undefined);
  };
  const refine = (event: FormEvent) => {
    event.preventDefault();
    if (instruction.trim()) generate.mutate(instruction.trim());
  };

  return (
    <div>
      <PageTitle sub="Describe the role briefly. The AI uses only what you enter here.">Write a job with AI</PageTitle>
      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={submit} className="space-y-4">
          <TextInput label="Job title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          <Field label="Seniority">
            <select className={inputClass} value={seniority} onChange={(e) => setSeniority(e.target.value)}>
              <option value="">Not specified</option>
              <option>Junior</option>
              <option>Mid-level</option>
              <option>Senior</option>
              <option>Staff</option>
              <option>Lead</option>
            </select>
          </Field>
          <TextInput label="Required skills (comma separated)" value={required} onChange={(e) => setRequired(e.target.value)} />
          <TextInput label="Nice-to-have skills (comma separated)" value={nice} onChange={(e) => setNice(e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Work type">
              <select className={inputClass} value={locationType} onChange={(e) => setLocationType(e.target.value as LocationType)}>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">On-site</option>
              </select>
            </Field>
            <TextInput label="Location or region" value={location} onChange={(e) => setLocation(e.target.value)} />
            <TextInput label="Minimum years of experience" type="number" min={0} max={60} step="0.5" value={minYears ?? ""} onChange={(e) => setMinYears(toNumber(e.target.value))} />
            <Field label="Currency">
              <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
            </Field>
            <TextInput label="Salary from (annual)" type="number" min={0} value={salaryMin ?? ""} onChange={(e) => setSalaryMin(toNumber(e.target.value))} />
            <TextInput label="Salary to (annual)" type="number" min={0} value={salaryMax ?? ""} onChange={(e) => setSalaryMax(toNumber(e.target.value))} />
          </div>
          <Field label="Notes about the team or role">
            <textarea className={inputClass} rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <TextInput label="Client name (never shown publicly or sent to the AI)" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          <Button disabled={generate.isPending}>{description ? "Write again from brief" : "Write description"}</Button>
          {generate.isPending && (
            <p className="text-sm text-ink-soft" role="status">
              Writing with the local AI model, this can take up to a minute…
            </p>
          )}
          <ErrorText error={generate.error} />
        </form>

        <Card>
          {description ? (
            <div className="space-y-4">
              <TextInput label="Title" required value={finalTitle} onChange={(e) => setFinalTitle(e.target.value)} />
              <Field label="Description">
                <textarea data-testid="job-description" className={inputClass} rows={16} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              {check && check.missing_skills.length > 0 && (
                <p className="rounded-xl bg-highlight/30 p-3 text-sm text-ink" role="status">
                  Not mentioned in the description: <b>{check.missing_skills.join(", ")}</b>
                </p>
              )}
              {check && check.language_flags.length > 0 && (
                <div className="rounded-xl bg-highlight/30 p-3 text-sm text-ink" role="status">
                  <p className="font-medium">Wording to reconsider</p>
                  <ul className="mt-1 list-inside list-disc">
                    {check.language_flags.map((flag) => (
                      <li key={flag.phrase}>
                        "{flag.phrase}" → {flag.suggestion}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <form onSubmit={refine} className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {REFINEMENTS.map((text) => (
                    <Button key={text} type="button" variant="secondary" disabled={generate.isPending} onClick={() => generate.mutate(text)}>
                      {text}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    aria-label="Ask for a change"
                    placeholder="Or ask for a change"
                    maxLength={500}
                    className={`${inputClass} !mt-0 flex-1`}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                  />
                  <Button variant="secondary" disabled={generate.isPending || !instruction.trim()}>
                    Revise
                  </Button>
                </div>
              </form>
              <ErrorText error={create.error} />
              <Button type="button" disabled={create.isPending || !finalTitle || !description} onClick={() => create.mutate()}>
                Save as draft and review
              </Button>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Your job description will appear here, ready to edit.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

export function InsightsPage() {
  const { id } = useParams();
  const analytics = useQuery({
    queryKey: ["analytics", id],
    queryFn: () => api<JobAnalytics>(`/org/jobs/${id}/analytics`),
  });

  if (analytics.isError) return <ErrorText error={analytics.error} />;
  if (analytics.isPending) return <p className="text-sm text-ink-muted">Loading…</p>;
  const data = analytics.data;
  const shortage = data.skill_coverage.find((row) => row.required);

  const stats = [
    { label: "Applicants", value: data.applicant_count },
    { label: "Scoring 60 or higher", value: data.strong_count },
    { label: "Waiting on you", value: data.needs_decision.length },
    { label: "Biggest skill gap", value: shortage ? shortage.skill : "None" },
  ];

  return (
    <div>
      <JobHeader jobId={id!} />
      <dl className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-2xl border-frame border-line bg-white p-4 shadow-raised">
            <dt className="text-sm text-ink-soft">{stat.label}</dt>
            <dd className="mt-1 truncate text-2xl font-semibold text-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>

      {data.applicant_count < MIN_APPLICANTS_FOR_CHARTS ? (
        <Card>
          <p className="text-sm text-ink-soft">
            Charts appear once this job has at least {MIN_APPLICANTS_FOR_CHARTS} applicants. It has{" "}
            {data.applicant_count} so far.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <h2 className="font-medium">Needs a decision</h2>
            <p className="mt-1 text-sm text-ink-soft">Strong applicants who have waited longest in applied or screening.</p>
            {data.needs_decision.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">Nobody strong is waiting right now.</p>
            ) : (
              <ul className="mt-3 divide-y divide-ink/10">
                {data.needs_decision.map((person) => (
                  <li key={person.application_id} className="flex flex-wrap items-center justify-between gap-3 py-2" data-testid="needs-decision">
                    <div>
                      <p className="text-sm font-medium">{person.full_name || "Unnamed candidate"}</p>
                      <p className="text-xs text-ink-soft">
                        {person.headline}, score {Math.round(person.total)}, waiting {person.days_waiting}{" "}
                        {person.days_waiting === 1 ? "day" : "days"}
                      </p>
                    </div>
                    <StageControl jobId={id!} applicationId={person.application_id} name={person.full_name || "candidate"} stage={person.stage} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="font-medium">Match score spread</h2>
            <p className="mt-1 mb-3 text-sm text-ink-soft">{data.strong_count} of {data.applicant_count} score 60 or higher.</p>
            <ScoreSpreadChart bands={data.score_bands} />
          </Card>
          <Card>
            <h2 className="font-medium">Skill coverage</h2>
            <p className="mt-1 mb-3 text-sm text-ink-soft">
              {shortage ? `Biggest shortage: ${shortage.skill}, held by ${shortage.percent}% of applicants.` : "This job lists no skills."}
            </p>
            <SkillCoverageChart rows={data.skill_coverage} />
          </Card>
          {data.top_candidates.length > 0 && (
            <Card className="lg:col-span-2">
              <h2 className="font-medium">Top candidate comparison</h2>
              <p className="mt-1 mb-3 text-sm text-ink-soft">What makes up each score, out of 100. Rejected and hired applicants aren't shown.</p>
              <TopCandidatesChart candidates={data.top_candidates} />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
