# Khoj

AI-assisted hiring: job seekers find the right jobs, recruiters and agencies find the right
candidates, and both sides see why a match was made.

**AI runs locally through [Ollama](https://ollama.com).** No API key is needed, and resumes never
leave your machine.

```
Browser ── React + TypeScript (Vite, :5173)
              │  /api
              ▼
           FastAPI (:8000) ───────► Ollama on the host (:11434)
              │                       LLM: extract data, write explanations
              ▼                       Embeddings: nomic-embed-text
           Postgres + pgvector
```

## How matching works

The LLM reads documents and writes explanations, but **it never sets a score**. Ranking is
deterministic code in `backend/app/matching/scoring.py`:

1. **Hard filters:** work type, time zone window, salary compared across currencies.
2. **Retrieval:** top 50 by embedding similarity.
3. **Score out of 100:** skills 50, similarity 25, experience 15, logistics 10. Recruiters can
   change the weights per search.
4. **Explanation:** written on demand and stored. If AI is unavailable, a summary is built directly
   from the score.

Names, age, gender and raw resume text are not inputs to the score.

## Hiring partner tools

- **AI job writer** (`/recruiter/jobs/new`): turns a short brief into a full description, revises it on request, flags exclusionary wording, missing required skills and experience figures that aren't in the brief. Client names are never sent to the AI.
- **Hiring assistant** (chat on each job's Candidates page): answers questions using read-only tools. It sees anonymous references, numbers and the job's own skills, never names or text written by candidates. Postgres enforces read-only access for the whole run, and a recruiter makes every pipeline move.
- **Insights** (`/recruiter/jobs/:id/insights`): match score spread, skill coverage, top candidate comparison and a "needs a decision" list. These are computed by code, so they work without AI.

Discovered candidates with under half of a job's minimum years are hidden. Anyone who applied stays visible.

## Application assistant

Job seekers can turn on an assistant at `/assistant`. It's off by default and applies only to jobs on Khoj. In "ask me first" mode, it prepares applications for review. In "apply automatically" mode, which needs explicit permission, it submits them, and it re-checks every 30 minutes (`ASSISTANT_INTERVAL_SECONDS`) while the backend runs.

Fixed rules choose jobs: minimum score, daily limit (10 at most), excluded companies and required skills. AI only writes the cover note, from structured facts, without the applicant's name, contact details or the job posting's text. Employers can see which applications came through the assistant, and seekers can withdraw one until the employer moves it forward.

## Themes

The site has two themes, Playful (the default) and Professional, chosen with the switch in the navigation and remembered in each visitor's browser. Both use the Khoj brand palette and differ only in type and corners. Theme values live in `frontend/src/index.css`, so components only use names like `bg-canvas` and `text-brand`. Chart colours are checked for colourblind readability.

## Run it

Requires Docker and Ollama running on the host.

```bash
ollama pull gpt-oss:20b
ollama pull nomic-embed-text
docker compose up -d --build
docker compose exec backend python -m scripts.seed   # 200 fictional candidates, 100 jobs
```

Open http://localhost:5173 and use the demo buttons on the login page. Browsing, search and scoring
work without Ollama. Resume reading and AI explanations need it. `gpt-oss:20b` uses about 13 GB of
memory; choose a smaller model with `LLM_MODEL` in `.env`.

## Using a hosted AI API later

Everything provider-specific lives in `backend/app/ai/`:

1. Add a class implementing `LLMClient` from `base.py`.
2. Add a branch for it in `factory.py`.
3. Add it to `CLIENTS` in `tests/test_llm_contract.py`, then set `LLM_PROVIDER` and `LLM_MODEL`.

Embeddings are configured separately, because not every LLM provider offers them. After changing
`EMBEDDING_MODEL`, run `python -m scripts.reembed` and recalibrate the similarity band in
`scoring.py`. The vector column is 768 dimensions, so a model of another size also needs a migration.

## Tests

```bash
docker compose exec backend pytest                     # unit and API tests, fake AI
docker compose exec -e OLLAMA_TEST_URL=http://host.docker.internal:11434 backend pytest  # adds real Ollama
cd frontend && npm install && npx playwright install chromium && npm run e2e   # browser, live stack
python -m scripts.compare_models gpt-oss:20b llama3.2  # from backend/, compare models
```

## Before real-world use

This is a portfolio project. Salary conversion uses static rates in `app/fx.py`, there's no email
verification or password reset, login has no rate limiting, and `JWT_SECRET` and `COOKIE_SECURE`
must be set for any deployment. Automated hiring tools are regulated in several regions, including
under the EU AI Act and New York City Local Law 144, so get legal advice before using this on real
candidates.
