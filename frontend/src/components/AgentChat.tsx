import { type FormEvent, useRef, useState } from "react";

import { ApiError } from "../api/client";
import type { AgentCandidate, AgentEvent, Stage } from "../api/types";
import { StageControl } from "./StageControl";
import { Button, Card, inputClass, ScoreBadge, SkillComparison } from "./ui";

type Entry = {
  role: "user" | "assistant";
  // Anonymous text sent back to the AI as history. `display` is what the recruiter reads.
  content: string;
  display: string;
  candidates?: AgentCandidate[];
  failed?: boolean;
};

const SUGGESTIONS = [
  "Who are my best 3 applicants?",
  "Who should I decide on first?",
  "How strong is my applicant pool?",
];
const MAX_HISTORY = 20;

async function* streamAgent(
  jobId: string,
  messages: { role: string; content: string }[],
): AsyncGenerator<AgentEvent> {
  const response = await fetch(`/api/org/jobs/${jobId}/agent`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!response.ok || !response.body) {
    throw new ApiError(response.status, "The AI assistant couldn't answer that request.");
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as AgentEvent;
    }
  }
}

function CandidateCard({
  jobId,
  card,
  onMoved,
}: {
  jobId: string;
  card: AgentCandidate;
  onMoved: (stage: Stage) => void;
}) {
  const name = card.candidate.full_name || "Unnamed candidate";
  return (
    <div className="rounded-xl border border-ink/15 bg-white p-3" data-testid="agent-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-ink-soft">{card.candidate.headline}</p>
        </div>
        <ScoreBadge total={card.score.total} />
      </div>
      <div className="mt-2">
        <SkillComparison score={card.score} />
      </div>
      <div className="mt-2 text-xs text-ink-soft">
        {card.application_id && card.stage ? (
          <StageControl
            jobId={jobId}
            applicationId={card.application_id}
            name={name}
            stage={card.stage}
            onMoved={onMoved}
          />
        ) : (
          "Hasn't applied to this job"
        )}
      </div>
    </div>
  );
}

export function AgentChat({ jobId }: { jobId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const busyRef = useRef(false);

  const ask = async (text: string) => {
    const content = text.trim();
    if (!content || busyRef.current) return;
    busyRef.current = true;
    const next: Entry[] = [...entries, { role: "user", content, display: content }];
    setEntries(next);
    setQuestion("");
    setStatus("Thinking…");
    const history = next
      .filter((entry) => !entry.failed)
      .slice(-MAX_HISTORY)
      .map((entry) => ({ role: entry.role, content: entry.content.slice(0, 4000) }));
    const fail = (message: string) =>
      setEntries((current) => [
        ...current,
        { role: "assistant", content: "", display: message, failed: true },
      ]);
    try {
      for await (const event of streamAgent(jobId, history)) {
        if (event.type === "status") setStatus(event.message);
        if (event.type === "error") fail(event.message);
        if (event.type === "answer") {
          setEntries((current) => [
            ...current,
            {
              role: "assistant",
              content: event.text,
              display: event.display_text,
              candidates: event.candidates,
            },
          ]);
        }
      }
    } catch (error) {
      fail(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      busyRef.current = false;
      setStatus(null);
    }
  };

  const moved = (ref: string, stage: Stage) =>
    setEntries((current) =>
      current.map((entry) => ({
        ...entry,
        candidates: entry.candidates?.map((card) => (card.ref === ref ? { ...card, stage } : card)),
      })),
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(question);
  };

  return (
    <Card>
      <h2 className="font-medium">Ask the hiring assistant</h2>
      <p className="mt-1 text-xs text-ink-muted">
        It recommends and you decide. Names stay hidden from the AI, and scores come from fixed rules.
      </p>
      <div className="mt-3 space-y-3" aria-live="polite">
        {entries.map((entry, index) => (
          <div key={index} className={entry.role === "user" ? "text-right" : ""}>
            <p
              className={`inline-block max-w-full whitespace-pre-wrap rounded-xl px-3 py-2 text-left text-sm ${
                entry.role === "user"
                  ? "bg-brand text-white"
                  : entry.failed
                    ? "bg-accent/15 text-danger"
                    : "bg-subtle text-ink"
              }`}
            >
              {entry.display}
            </p>
            {entry.candidates && entry.candidates.length > 0 && (
              <div className="mt-2 grid gap-2">
                {entry.candidates.map((card) => (
                  <CandidateCard
                    key={card.ref}
                    jobId={jobId}
                    card={card}
                    onMoved={(stage) => moved(card.ref, stage)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        {status && (
          <p className="text-sm text-ink-muted" role="status">
            {status}
          </p>
        )}
      </div>
      {entries.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((text) => (
            <Button key={text} variant="secondary" type="button" onClick={() => void ask(text)}>
              {text}
            </Button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          aria-label="Ask the hiring assistant"
          placeholder="Ask about your candidates"
          maxLength={1000}
          className={`${inputClass} !mt-0 flex-1`}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <Button disabled={status !== null || !question.trim()}>Ask</Button>
      </form>
    </Card>
  );
}
