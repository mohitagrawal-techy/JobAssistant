import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";

import { api, send } from "../api/client";
import type { AssistantAction, AssistantData, AssistantSettings } from "../api/types";
import { Button, Card, ErrorText, Field, inputClass, JobFacts, PageTitle, ScoreBadge } from "../components/ui";

type Form = Pick<
  AssistantSettings,
  "enabled" | "mode" | "min_score" | "daily_limit" | "require_all_skills"
> & { companies: string; consent: boolean };

function toForm(settings: AssistantSettings): Form {
  return {
    enabled: settings.enabled,
    mode: settings.mode,
    min_score: settings.min_score,
    daily_limit: settings.daily_limit,
    require_all_skills: settings.require_all_skills,
    companies: settings.excluded_companies.join(", "),
    consent: settings.has_auto_consent,
  };
}

function useRefresh() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ["assistant"] });
    client.invalidateQueries({ queryKey: ["applications"] });
    client.invalidateQueries({ queryKey: ["matches"] });
  };
}

function PendingCard({ action }: { action: AssistantAction }) {
  const refresh = useRefresh();
  const [note, setNote] = useState(action.note);
  const approve = useMutation({
    mutationFn: () => send("POST", `/assistant/actions/${action.id}/approve`, { note }),
    onSuccess: refresh,
  });
  const skip = useMutation({
    mutationFn: () => send("POST", `/assistant/actions/${action.id}/skip`),
    onSuccess: refresh,
  });
  const busy = approve.isPending || skip.isPending;
  return (
    <Card className="shadow-raised" >
      <div data-testid="assistant-pending">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold leading-tight">{action.job.title}</p>
            <p className="text-sm text-ink-soft">{action.job.organization_name}</p>
            <JobFacts job={action.job} />
          </div>
          <ScoreBadge total={action.score} />
        </div>
        <div className="mt-3">
          <Field label="Note to the employer">
            <textarea className={inputClass} rows={4} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={busy || !note.trim()} onClick={() => approve.mutate()}>Apply</Button>
          <Button variant="secondary" disabled={busy} onClick={() => skip.mutate()}>Skip</Button>
        </div>
        <ErrorText error={approve.error ?? skip.error} />
      </div>
    </Card>
  );
}

const STATUS_TEXT = {
  applied: (action: AssistantAction) => (action.applied_automatically ? "Applied automatically" : "Applied after you approved"),
  skipped: () => "Skipped",
  withdrawn: () => "Withdrawn",
  pending: () => "Waiting for you",
};

function ActivityRow({ action }: { action: AssistantAction }) {
  const refresh = useRefresh();
  const withdraw = useMutation({
    mutationFn: () => send("POST", `/assistant/actions/${action.id}/withdraw`),
    onSuccess: refresh,
  });
  return (
    <li className="py-3" data-testid="assistant-activity">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{action.job.title}</p>
          <p className="text-sm text-ink-soft">
            {action.job.organization_name}, {new Date(action.created_at).toLocaleDateString()}
          </p>
          <p className="text-sm font-semibold">{STATUS_TEXT[action.status](action)}</p>
        </div>
        {action.status === "applied" && (
          <Button variant="secondary" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
            Withdraw
          </Button>
        )}
      </div>
      {action.status === "applied" && (
        <details className="mt-1 text-sm text-ink-soft">
          <summary className="cursor-pointer">See what was sent</summary>
          <p className="mt-1 whitespace-pre-wrap">{action.note}</p>
        </details>
      )}
      <ErrorText error={withdraw.error} />
    </li>
  );
}

export function AssistantPage() {
  const refresh = useRefresh();
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  const assistant = useQuery({ queryKey: ["assistant"], queryFn: () => api<AssistantData>("/assistant") });

  useEffect(() => {
    if (assistant.data && form === null) setForm(toForm(assistant.data.settings));
  }, [assistant.data, form]);

  const save = useMutation({
    mutationFn: (values: Form) =>
      send<AssistantSettings>("PUT", "/assistant/settings", {
        enabled: values.enabled,
        mode: values.mode,
        min_score: values.min_score,
        daily_limit: values.daily_limit,
        require_all_skills: values.require_all_skills,
        excluded_companies: values.companies.split(",").map((name) => name.trim()).filter(Boolean),
        auto_consent: values.consent,
      }),
    onSuccess: () => {
      setSaved(true);
      refresh();
    },
  });
  const run = useMutation({
    mutationFn: () => send<{ applied: number; suggested: number }>("POST", "/assistant/run"),
    onSuccess: refresh,
  });

  if (assistant.isError) return <ErrorText error={assistant.error} />;
  if (!assistant.data || !form) return <p className="text-sm text-ink-muted">Loading…</p>;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setSaved(false);
    setForm({ ...form, [key]: value });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(form);
  };
  const { settings, pending, activity } = assistant.data;
  const needsConsent = form.mode === "auto" && !form.consent;

  let runMessage = null;
  if (run.data) {
    const { applied, suggested } = run.data;
    if (applied > 0) runMessage = `Applied to ${applied} ${applied === 1 ? "job" : "jobs"} for you.`;
    else if (suggested > 0) runMessage = `Found ${suggested} ${suggested === 1 ? "job" : "jobs"} for you to review.`;
    else runMessage = "No new jobs meet your rules right now, or you've reached today's limit.";
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[380px_1fr]">
      <div className="lg:col-span-2">
        <PageTitle sub="It finds jobs that meet your rules and applies with a short note. Employers can see when an application came through it.">
          Your application assistant
        </PageTitle>
      </div>

      <Card>
        <form onSubmit={submit} className="space-y-4">
          <label className="flex items-center gap-2 font-semibold">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={form.enabled} onChange={(event) => set("enabled", event.target.checked)} />
            Turn on the assistant
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">When it finds a job</legend>
            <label className="flex gap-2 text-sm">
              <input type="radio" name="mode" className="mt-0.5 accent-brand" checked={form.mode === "ask"} onChange={() => set("mode", "ask")} />
              <span><b>Ask me first.</b> You review each application before it's sent.</span>
            </label>
            <label className="flex gap-2 text-sm">
              <input type="radio" name="mode" className="mt-0.5 accent-brand" checked={form.mode === "auto"} onChange={() => setForm({ ...form, mode: "auto", consent: settings.has_auto_consent })} />
              <span><b>Apply automatically.</b> It applies without checking with you.</span>
            </label>
          </fieldset>
          {form.mode === "auto" && (
            <label className="flex gap-2 rounded-2xl bg-highlight/40 p-3 text-sm">
              <input type="checkbox" className="mt-0.5 accent-brand" checked={form.consent} onChange={(event) => set("consent", event.target.checked)} />
              <span>
                I authorise Khoj to submit job applications for me without asking first, including
                AI-written notes and sharing my profile with those employers, even if my profile is hidden.
              </span>
            </label>
          )}
          <label className="block text-sm font-semibold">
            Minimum match score: {form.min_score}
            <input type="range" min={50} max={100} step={5} className="mt-1 w-full accent-brand" value={form.min_score} onChange={(event) => set("min_score", Number(event.target.value))} />
          </label>
          <label className="block text-sm font-semibold">
            Most applications per day: {form.daily_limit}
            <input type="range" min={1} max={10} className="mt-1 w-full accent-brand" value={form.daily_limit} onChange={(event) => set("daily_limit", Number(event.target.value))} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={form.require_all_skills} onChange={(event) => set("require_all_skills", event.target.checked)} />
            Only jobs where I have every required skill
          </label>
          <Field label="Never apply to these companies (comma separated)">
            <input className={inputClass} value={form.companies} onChange={(event) => set("companies", event.target.value)} />
          </Field>
          <ErrorText error={save.error} />
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={save.isPending || needsConsent}>Save settings</Button>
            {saved && !save.isPending && <span className="text-sm font-medium" role="status">Saved</span>}
          </div>
          {needsConsent && <p className="text-sm text-ink-soft">Tick the permission box to use automatic applying.</p>}
        </form>
      </Card>

      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={!settings.enabled || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? "Working…" : "Find jobs now"}
          </Button>
          <p className="text-sm text-ink-soft" role="status">
            {run.isPending
              ? "Checking jobs and writing notes with the local AI model…"
              : runMessage ?? (settings.enabled ? "It also checks for new jobs every 30 minutes while Khoj is running." : "Turn it on and save to start.")}
          </p>
        </div>
        <ErrorText error={run.error} />

        {pending.length > 0 && (
          <section className="space-y-3">
            <h2>Ready for your review</h2>
            {pending.map((action) => (
              <PendingCard key={action.id} action={action} />
            ))}
          </section>
        )}

        <Card>
          <h2>Activity</h2>
          {activity.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">Everything the assistant does will be listed here.</p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {activity.map((action) => (
                <ActivityRow key={action.id} action={action} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
