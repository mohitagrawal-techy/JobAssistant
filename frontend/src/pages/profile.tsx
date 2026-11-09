import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type DragEvent, type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api, send } from "../api/client";
import type { Availability, EducationEntry, JobType, Profile, ProjectEntry, Resume, WorkEntry } from "../api/types";
import { AVAILABILITY_LABELS, CURRENCIES, JOB_TYPES } from "../api/types";
import { ChipInput } from "../components/ChipInput";
import { Timeline } from "../components/Timeline";
import { Button, Card, ErrorText, Field, FilterChips, inputClass, Skeletons, TextInput } from "../components/ui";

type ProfileForm = Omit<Profile, "id" | "has_embedding" | "skills"> & { skills: string[] };

const EMPTY_WORK: WorkEntry = { title: "", company: "", start: "", end: "", current: false, description: "" };
const EMPTY_PROJECT: ProjectEntry = { name: "", role: "", start: "", end: "", current: false, description: "", url: "", technologies: [] };
const EMPTY_EDUCATION: EducationEntry = { degree: "", institution: "", year: null };
const JOB_TYPE_LABELS: Record<JobType, string> = {
  "full-time": "Full-time",
  "part-time": "Part-time",
  contract: "Contract",
  internship: "Internship",
};

function toNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

function toForm(profile: Profile): ProfileForm {
  const { id: _id, has_embedding: _embedded, skills, ...rest } = profile;
  return { ...rest, skills: skills.map((skill) => skill.name) };
}

function cleanDate(value: string | null | undefined): string {
  return value && /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(value) ? value : "";
}

function checklist(form: ProfileForm) {
  return [
    { label: "Add your name", done: Boolean(form.full_name.trim()) },
    { label: "Write a headline", done: Boolean(form.headline.trim()) },
    { label: "Write a short summary", done: Boolean(form.summary.trim()) },
    { label: "List at least 3 skills", done: form.skills.length >= 3 },
    { label: "Add your work history", done: form.work_history.some((job) => job.title.trim()) },
    { label: "Add a project", done: form.projects.some((project) => project.name.trim()) },
    { label: "Add your education", done: form.education.some((item) => item.degree.trim() || item.institution.trim()) },
    { label: "Say what roles you want", done: form.desired_roles.length > 0 },
    { label: "Set your availability", done: Boolean(form.availability) },
    { label: "Add a link to your work", done: Object.values(form.links).some(Boolean) },
  ];
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card>
      <h2>{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-ink-soft">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </Card>
  );
}

function ProfileSummary({ form }: { form: ProfileForm }) {
  const items = checklist(form);
  const done = items.filter((item) => item.done).length;
  const percent = Math.round((100 * done) / items.length);
  const todo = items.filter((item) => !item.done).slice(0, 3);
  const initials = form.full_name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("") || "?";
  const facts = [
    form.location,
    form.years_experience != null ? `${form.years_experience} years of experience` : "",
    AVAILABILITY_LABELS[form.availability],
  ].filter(Boolean);

  return (
    <Card className="lg:sticky lg:top-4">
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand text-lg font-bold uppercase text-white" aria-hidden="true">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold leading-tight">{form.full_name || "Your name"}</p>
          <p className="truncate text-sm text-ink-soft">{form.headline || "Your headline"}</p>
        </div>
      </div>
      {facts.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-sm text-ink-soft">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <p className="flex justify-between text-sm font-semibold">
          <span>Profile strength</span>
          <span>{percent}%</span>
        </p>
        <div
          className="mt-1.5 h-2 overflow-hidden rounded-pill bg-canvas"
          role="progressbar"
          aria-label="Profile strength"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-pill bg-brand transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
      </div>
      {todo.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-semibold">Next steps</p>
          <ul className="mt-1 list-inside list-disc text-sm text-ink-soft">
            {todo.map((item) => (
              <li key={item.label}>{item.label}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-soft">Your profile is complete.</p>
      )}
      <p className="mt-4 border-t border-ink/10 pt-3 text-sm text-ink-soft">
        {form.is_visible ? "Employers can find you in matches." : "You're hidden from employers you haven't applied to."}{" "}
        <Link to="/privacy" className="text-brand underline">Change</Link>
      </p>
    </Card>
  );
}

function ResumeSection({ onFill, filledId }: { onFill: (resume: Resume) => void; filledId: string | null }) {
  const client = useQueryClient();
  const [dragging, setDragging] = useState(false);
  const resume = useQuery({
    queryKey: ["resume"],
    queryFn: () => api<Resume | null>("/profile/resume"),
    refetchInterval: (query) => {
      const status = query.state.data?.parse_status;
      return status === "pending" || status === "processing" ? 1500 : false;
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api<Resume>("/profile/resume", { method: "POST", body });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["resume"] }),
  });
  const latest = resume.data;
  const busy = latest?.parse_status === "pending" || latest?.parse_status === "processing";
  const review = latest?.parse_status === "done" && latest.id !== filledId ? latest : null;

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) upload.mutate(file);
    event.target.value = "";
  };
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !busy) upload.mutate(file);
  };

  return (
    <Section title="Start with your resume" hint="We'll pull out your details so you only have to check them.">
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`block cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center text-sm focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-brand ${
          dragging ? "border-brand bg-subtle" : "border-input hover:bg-subtle"
        }`}
      >
        <span className="font-semibold text-brand">Choose a file</span> or drop it here
        <span className="sr-only">Resume (PDF or DOCX, up to 5 MB)</span>
        <span className="mt-1 block text-xs text-ink-muted">PDF or DOCX, up to 5 MB</span>
        <input type="file" accept=".pdf,.docx" className="sr-only" onChange={onFile} disabled={busy || upload.isPending} />
      </label>
      <div className="space-y-2 text-sm" aria-live="polite">
        <ErrorText error={upload.error} />
        {busy && <p className="text-ink-soft">Reading your resume with the local AI model…</p>}
        {latest?.parse_status === "failed" && <p className="text-danger">{latest.parse_error}</p>}
        {review && (
          <div className="rounded-2xl bg-subtle p-3">
            <p>
              We read <b>{review.filename}</b> and found {review.extracted?.skills.length ?? 0} skills
              {review.extracted?.work_history?.length ? ` and ${review.extracted.work_history.length} jobs` : ""}.
            </p>
            <Button type="button" variant="secondary" className="mt-2" onClick={() => onFill(review)}>
              Fill the form with these details
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}

export function ProfilePage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [filledId, setFilledId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [view, setView] = useState<"edit" | "timeline">("edit");
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api<Profile>("/profile") });

  useEffect(() => {
    if (profile.data && form === null) setForm(toForm(profile.data));
  }, [profile.data, form]);

  const save = useMutation({
    mutationFn: ({ values }: { values: ProfileForm; thenMatches: boolean }) =>
      send<Profile>("PUT", "/profile", {
        ...values,
        skills: values.skills.map((name) => ({ name })),
        work_history: values.work_history
          .filter((job) => job.title.trim() || job.company.trim())
          .map((job) => ({ ...job, end: job.current ? "" : job.end })),
        projects: values.projects
          .filter((project) => project.name.trim())
          .map((project) => ({ ...project, end: project.current ? "" : project.end })),
        education: values.education.filter((item) => item.degree.trim() || item.institution.trim()),
      }),
    onSuccess: (_data, { thenMatches }) => {
      client.invalidateQueries({ queryKey: ["profile"] });
      client.invalidateQueries({ queryKey: ["matches"] });
      if (thenMatches) navigate("/matches");
      else setSaved(true);
    },
  });

  if (profile.isError) return <ErrorText error={profile.error} />;
  if (!form) return <Skeletons />;

  const update = (patch: Partial<ProfileForm>) => {
    setSaved(false);
    setForm({ ...form, ...patch });
  };
  const setWork = (index: number, patch: Partial<WorkEntry>) =>
    update({ work_history: form.work_history.map((job, i) => (i === index ? { ...job, ...patch } : job)) });
  const setProject = (index: number, patch: Partial<ProjectEntry>) =>
    update({ projects: form.projects.map((project, i) => (i === index ? { ...project, ...patch } : project)) });
  const setEducation = (index: number, patch: Partial<EducationEntry>) =>
    update({ education: form.education.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  const toggleJobType = (type: JobType) =>
    update({
      job_types: form.job_types.includes(type)
        ? form.job_types.filter((item) => item !== type)
        : [...form.job_types, type],
    });

  const fillFromResume = (resume: Resume) => {
    const data = resume.extracted;
    if (!data) return;
    update({
      headline: data.headline,
      summary: data.summary,
      years_experience: data.years_experience,
      location: data.location ?? form.location,
      skills: data.skills,
      work_history: data.work_history?.length
        ? data.work_history.map((job) => ({
            title: job.title,
            company: job.company,
            start: cleanDate(job.start),
            end: cleanDate(job.end),
            current: job.current,
            description: job.description,
          }))
        : form.work_history,
      projects: data.projects?.length
        ? data.projects.map((project) => ({
            name: project.name,
            role: project.role,
            start: cleanDate(project.start),
            end: cleanDate(project.end),
            current: project.current,
            description: project.description,
            url: project.url && /^https?:\/\//i.test(project.url) ? project.url : "",
            technologies: project.technologies,
          }))
        : form.projects,
      education: data.education?.length
        ? data.education.map((item) => ({ degree: item.degree, institution: item.institution, year: item.year }))
        : form.education,
      certifications: data.certifications?.length ? data.certifications : form.certifications,
      languages: data.languages?.length ? data.languages : form.languages,
    });
    setFilledId(resume.id);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ values: form, thenMatches: true });
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-4xl leading-tight text-ink sm:text-5xl">Your profile</h1>
        <p className="mt-2 text-ink-soft">The more you add, the easier it is for employers to say yes.</p>
        <div className="mt-4">
          <FilterChips
            label="Profile view"
            value={view}
            onChange={setView}
            options={[
              { id: "edit", label: "Edit" },
              { id: "timeline", label: "Timeline" },
            ]}
          />
        </div>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <ProfileSummary form={form} />
        {view === "timeline" && (
          <Card className="min-w-0">
            <h2>Your timeline</h2>
            <p className="mt-0.5 text-sm text-ink-soft">This is how employers see your background.</p>
            <div className="mt-5">
              <Timeline work={form.work_history} projects={form.projects} education={form.education} />
              {!form.work_history.length && !form.projects.length && !form.education.length && (
                <p className="text-sm text-ink-soft">
                  Nothing here yet. Add work history, projects or education and they'll appear in date order.
                </p>
              )}
            </div>
          </Card>
        )}
        <form onSubmit={submit} className={`min-w-0 space-y-4 ${view === "edit" ? "" : "hidden"}`}>
          <ResumeSection onFill={fillFromResume} filledId={filledId} />

          <Section title="About you">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="Full name" autoComplete="name" value={form.full_name} onChange={(e) => update({ full_name: e.target.value })} />
              <TextInput label="Headline" placeholder="For example, Senior Backend Engineer" value={form.headline} onChange={(e) => update({ headline: e.target.value })} />
              <TextInput label="Location" placeholder="City, country" value={form.location} onChange={(e) => update({ location: e.target.value })} />
              <TextInput label="Years of experience" type="number" min={0} max={60} step="0.5" value={form.years_experience ?? ""} onChange={(e) => update({ years_experience: toNumber(e.target.value) })} />
            </div>
            <Field label="Summary">
              <textarea className={inputClass} rows={4} maxLength={5000} placeholder="A few sentences about your work and what you're good at." value={form.summary} onChange={(e) => update({ summary: e.target.value })} />
            </Field>
          </Section>

          <Section title="Skills" hint="These count most toward your match score. Press Enter after each one.">
            <ChipInput label="Your skills" values={form.skills} onChange={(skills) => update({ skills })} placeholder="Python, React, Figma" testId="skill-chips" />
          </Section>

          <Section title="Work history">
            {form.work_history.map((job, index) => (
              <div key={index} className="space-y-3 rounded-2xl bg-subtle p-4" data-testid="work-entry">
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextInput label="Job title" value={job.title} onChange={(e) => setWork(index, { title: e.target.value })} />
                  <TextInput label="Company" value={job.company} onChange={(e) => setWork(index, { company: e.target.value })} />
                  <TextInput label="Started" placeholder="2021 or 2021-06" maxLength={7} value={job.start} onChange={(e) => setWork(index, { start: e.target.value })} />
                  <TextInput label="Ended" placeholder="2024 or 2024-03" maxLength={7} disabled={job.current} value={job.current ? "" : job.end} onChange={(e) => setWork(index, { end: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-brand" checked={job.current} onChange={(e) => setWork(index, { current: e.target.checked })} />
                  I work here now
                </label>
                <Field label="What you did">
                  <textarea className={inputClass} rows={2} maxLength={2000} value={job.description} onChange={(e) => setWork(index, { description: e.target.value })} />
                </Field>
                <button type="button" className="text-sm font-medium text-danger hover:underline" onClick={() => update({ work_history: form.work_history.filter((_, i) => i !== index) })}>
                  Remove this job
                </button>
              </div>
            ))}
            <Button type="button" variant="secondary" disabled={form.work_history.length >= 20} onClick={() => update({ work_history: [...form.work_history, EMPTY_WORK] })}>
              Add a job
            </Button>
          </Section>

          <Section title="Projects" hint="Side projects, open source, freelance or standout work.">
            {form.projects.map((project, index) => (
              <div key={index} className="space-y-3 rounded-2xl bg-subtle p-4" data-testid="project-entry">
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextInput label="Project name" value={project.name} onChange={(e) => setProject(index, { name: e.target.value })} />
                  <TextInput label="Your role" placeholder="For example, Lead developer" value={project.role} onChange={(e) => setProject(index, { role: e.target.value })} />
                  <TextInput label="Started" placeholder="2023 or 2023-02" maxLength={7} value={project.start} onChange={(e) => setProject(index, { start: e.target.value })} />
                  <TextInput label="Ended" placeholder="2024 or 2024-08" maxLength={7} disabled={project.current} value={project.current ? "" : project.end} onChange={(e) => setProject(index, { end: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-brand" checked={project.current} onChange={(e) => setProject(index, { current: e.target.checked })} />
                  Still working on this
                </label>
                <Field label="About this project">
                  <textarea className={inputClass} rows={2} maxLength={2000} value={project.description} onChange={(e) => setProject(index, { description: e.target.value })} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ChipInput label="Technologies used" values={project.technologies} onChange={(technologies) => setProject(index, { technologies })} placeholder="React, PostgreSQL" />
                  <TextInput label="Project link" type="url" placeholder="https://github.com/you/project" value={project.url} onChange={(e) => setProject(index, { url: e.target.value })} />
                </div>
                <button type="button" className="text-sm font-medium text-danger hover:underline" onClick={() => update({ projects: form.projects.filter((_, i) => i !== index) })}>
                  Remove this project
                </button>
              </div>
            ))}
            <Button type="button" variant="secondary" disabled={form.projects.length >= 20} onClick={() => update({ projects: [...form.projects, EMPTY_PROJECT] })}>
              Add a project
            </Button>
          </Section>

          <Section title="Education">
            {form.education.map((item, index) => (
              <div key={index} className="space-y-3 rounded-2xl bg-subtle p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_120px]">
                  <TextInput label="Degree or course" value={item.degree} onChange={(e) => setEducation(index, { degree: e.target.value })} />
                  <TextInput label="School" value={item.institution} onChange={(e) => setEducation(index, { institution: e.target.value })} />
                  <TextInput label="Year" type="number" min={1950} max={2100} value={item.year ?? ""} onChange={(e) => setEducation(index, { year: toNumber(e.target.value) })} />
                </div>
                <button type="button" className="text-sm font-medium text-danger hover:underline" onClick={() => update({ education: form.education.filter((_, i) => i !== index) })}>
                  Remove this entry
                </button>
              </div>
            ))}
            <Button type="button" variant="secondary" disabled={form.education.length >= 10} onClick={() => update({ education: [...form.education, EMPTY_EDUCATION] })}>
              Add education
            </Button>
            <div className="grid gap-4 sm:grid-cols-2">
              <ChipInput label="Certifications" values={form.certifications} onChange={(certifications) => update({ certifications })} placeholder="AWS Solutions Architect" />
              <ChipInput label="Languages you speak" values={form.languages} onChange={(languages) => update({ languages })} placeholder="English, Hindi" />
            </div>
          </Section>

          <Section title="What you're looking for" hint="Work type, time zone and salary decide which jobs you're matched with.">
            <ChipInput label="Roles you want" values={form.desired_roles} onChange={(desired_roles) => update({ desired_roles })} placeholder="Staff Engineer, Tech Lead" />
            <fieldset>
              <legend className="text-sm font-semibold">Job type</legend>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-2">
                {JOB_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-brand" checked={form.job_types.includes(type)} onChange={() => toggleJobType(type)} />
                    {JOB_TYPE_LABELS[type]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Work preference">
                <select className={inputClass} value={form.remote_preference} onChange={(e) => update({ remote_preference: e.target.value as ProfileForm["remote_preference"] })}>
                  <option value="any">Any</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">On-site</option>
                </select>
              </Field>
              <Field label="Availability">
                <select className={inputClass} value={form.availability} onChange={(e) => update({ availability: e.target.value as Availability })}>
                  <option value="">Not set</option>
                  {Object.entries(AVAILABILITY_LABELS)
                    .filter(([value]) => value)
                    .map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                </select>
              </Field>
              <TextInput label="UTC offset (hours, e.g. 5.5)" type="number" min={-12} max={14} step="0.5" value={form.utc_offset ?? ""} onChange={(e) => update({ utc_offset: toNumber(e.target.value) })} />
              <TextInput label="Minimum annual salary" type="number" min={0} value={form.salary_min ?? ""} onChange={(e) => update({ salary_min: toNumber(e.target.value) })} />
              <Field label="Currency">
                <select className={inputClass} value={form.currency} onChange={(e) => update({ currency: e.target.value })}>
                  {CURRENCIES.map((code) => (
                    <option key={code}>{code}</option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={form.open_to_relocate} onChange={(e) => update({ open_to_relocate: e.target.checked })} />
              I'm open to relocating
            </label>
          </Section>

          <Section title="Links" hint="Use full addresses starting with https://">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <TextInput label="LinkedIn" type="url" placeholder="https://linkedin.com/in/you" value={form.links.linkedin} onChange={(e) => update({ links: { ...form.links, linkedin: e.target.value } })} />
              <TextInput label="GitHub" type="url" placeholder="https://github.com/you" value={form.links.github} onChange={(e) => update({ links: { ...form.links, github: e.target.value } })} />
              <TextInput label="Portfolio" type="url" placeholder="https://your-site.com" value={form.links.portfolio} onChange={(e) => update({ links: { ...form.links, portfolio: e.target.value } })} />
            </div>
          </Section>

          <div className="sticky bottom-16 z-10 rounded-2xl border-frame border-line bg-white p-3 shadow-raised md:bottom-4">
            <ErrorText error={save.error} />
            <div className="flex flex-wrap items-center justify-end gap-2">
              {saved && !save.isPending && <span className="mr-auto text-sm font-medium" role="status">Saved</span>}
              <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => save.mutate({ values: form, thenMatches: false })}>
                Save
              </Button>
              <Button disabled={save.isPending}>Save and see matches</Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
