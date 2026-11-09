import { expect, type Page, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stamp = Date.now();
const PASSWORD = "e2e-password-123";
const JOB_TITLE = `Elixir Platform Engineer ${stamp}`;
const DESCRIPTION = `${JOB_TITLE}

We are hiring a remote Elixir platform engineer to build realtime systems.
Required skills: Elixir, Phoenix, PostgreSQL. Nice to have: RabbitMQ.
Minimum 4 years of experience.`;

async function register(page: Page, role: "seeker" | "recruiter", email: string) {
  await page.goto(`/register?role=${role}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.waitForURL(/\/(matches|recruiter)/);
}

test("recruiter and seeker complete a hire end to end", async ({ browser }) => {
  const recruiter = await (await browser.newContext()).newPage();
  await register(recruiter, "recruiter", `recruiter-${stamp}@example.com`);
  await recruiter.getByLabel("Organization name").fill(`E2E Org ${stamp}`);
  await recruiter.getByRole("button", { name: "Continue" }).click();

  await recruiter.getByRole("button", { name: "Paste a description" }).click();
  await recruiter.getByLabel(/Paste a job description/).fill(DESCRIPTION);
  await recruiter.getByRole("button", { name: "Create draft" }).click();

  const required = recruiter.getByLabel("Required skills (comma separated)");
  await expect(required).toHaveValue(/elixir/i);
  await expect(recruiter.getByLabel("Title")).toHaveValue(/Elixir/);
  await recruiter.getByLabel("Title").fill(JOB_TITLE);
  await recruiter.getByRole("button", { name: "Publish job" }).click();
  await expect(recruiter.getByText(JOB_TITLE)).toBeVisible();

  const seeker = await (await browser.newContext()).newPage();
  await register(seeker, "seeker", `seeker-${stamp}@example.com`);
  await seeker.goto("/profile");
  await seeker.getByLabel(/Resume \(PDF or DOCX/).setInputFiles(path.join(here, "fixtures/resume.docx"));
  await seeker.getByRole("button", { name: "Fill the form with these details" }).click();
  await expect(seeker.getByTestId("skill-chips")).toContainText(/elixir/i);
  await expect(seeker.getByTestId("work-entry").first().getByLabel("Job title")).toHaveValue(/platform engineer/i);
  await seeker.getByLabel("Full name").fill("Robin Vale");
  await seeker.getByRole("button", { name: "Save and see matches" }).click();

  await expect(seeker.getByRole("heading", { name: "Your matches" })).toBeVisible();
  // Embeddings refresh in the background just after saving.
  await seeker.waitForTimeout(3000);
  await seeker.reload();
  const card = seeker.locator("section", { hasText: JOB_TITLE });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Why this match?" }).click();
  await expect(card.getByTestId("explanation")).toContainText(/elixir/i);
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card.getByRole("button", { name: "Applied" })).toBeVisible();

  await recruiter.reload();
  const row = recruiter.locator("section", { hasText: JOB_TITLE });
  await row.getByRole("link", { name: "Candidates" }).click();
  const candidate = recruiter.locator("section", { hasText: "Robin Vale" });
  await expect(candidate).toBeVisible();
  await candidate.getByText("View full profile").click();
  await expect(candidate.getByTestId("timeline")).toContainText(/platform engineer/i);
  await candidate.getByRole("button", { name: "Why this match?" }).click();
  await expect(candidate.getByTestId("explanation")).toBeVisible();

  await recruiter.goBack();
  await recruiter.locator("section", { hasText: JOB_TITLE }).getByRole("link", { name: "Pipeline" }).click();
  await expect(recruiter.getByTestId("stage-applied")).toContainText("Robin Vale");
  await recruiter.getByLabel("Move Robin Vale to stage").selectOption("interview");
  await expect(recruiter.getByTestId("stage-interview")).toContainText("Robin Vale");

  await seeker.goto("/applications");
  await expect(seeker.locator("section", { hasText: JOB_TITLE })).toContainText(/interview/i);

  await seeker.goto("/privacy");
  await seeker.getByRole("button", { name: "Delete my account" }).click();
  await seeker.getByRole("button", { name: "Yes, delete everything" }).click();
  await expect(seeker.getByRole("heading", { name: /Find opportunities that fit you/ })).toBeVisible();
});

test("demo accounts show seeded matches", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Demo seeker" }).click();
  await expect(page.getByRole("heading", { name: "Your matches" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Why this match?" }).first()).toBeVisible();
});

test("hiring partner writes a job, asks the agent and acts on insights", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Demo recruiter" }).click();
  await expect(page.getByRole("heading", { name: "Our jobs" })).toBeVisible();

  await page.getByRole("link", { name: "Write a job with AI" }).click();
  await page.getByLabel("Job title").fill("Data Engineer");
  await page.getByLabel("Required skills (comma separated)").fill("Python, Airflow, Snowflake");
  await page.getByLabel("Notes about the team or role").fill("Small team building an analytics platform.");
  await page.getByRole("button", { name: "Write description" }).click();
  const description = page.getByTestId("job-description");
  await expect(description).toHaveValue(/Airflow/);
  const first = await description.inputValue();

  await page.getByRole("button", { name: "Make it shorter" }).click();
  await expect(description).not.toHaveValue(first);
  await expect(description).toHaveValue(/Snowflake/);

  await description.fill(`${await description.inputValue()}\nWe need a rockstar.`);
  await expect(page.getByText("Wording to reconsider")).toBeVisible();

  await page.getByRole("button", { name: "Save as draft and review" }).click();
  await page.getByRole("button", { name: "Publish job" }).click();
  await expect(page.getByRole("heading", { name: "Our jobs" })).toBeVisible();

  const seeded = page.locator("section", { hasText: "Senior Frontend Engineer" }).first();
  const candidates = await seeded.getByRole("link", { name: "Candidates" }).getAttribute("href");
  await seeded.getByRole("link", { name: "Insights" }).click();
  await expect(page.getByRole("heading", { name: "Match score spread" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Skill coverage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top candidate comparison" })).toBeVisible();

  const waiting = page.getByTestId("needs-decision");
  const before = await waiting.count();
  expect(before).toBeGreaterThan(0);
  await waiting.first().getByRole("combobox").selectOption("interview");
  await expect(waiting).toHaveCount(before - 1);

  await page.goto(candidates!);
  await page.getByLabel("Ask the hiring assistant").fill("Who are my best 3 applicants?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("agent-card").first()).toBeVisible();
  await expect(page.getByTestId("agent-card").first().getByRole("combobox")).toBeVisible();
});

test("forgot password confirms without revealing whether the account exists", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await page.getByLabel("Email").fill(`nobody-${stamp}@example.com`);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If nobody-");
});

test("landing page search shows live jobs and carries the search to browse", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Khoj");
  const results = page.getByTestId("landing-results");
  const seeAll = results.getByRole("link", { name: /See all \d+ jobs?/ });
  await expect(seeAll).toBeVisible();
  const everything = (await seeAll.textContent())!;

  await page.getByRole("button", { name: "Kubernetes" }).click();
  await expect(seeAll).not.toHaveText(everything);
  await expect(page.getByLabel("Search jobs")).toHaveValue("Kubernetes");

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs\?q=Kubernetes/);
  await expect(page.getByRole("heading", { name: "Browse jobs" })).toBeVisible();
  await expect(page.getByLabel("Search jobs")).toHaveValue("Kubernetes");
});

test("assistant prepares applications, applies with permission, and can withdraw", async ({ page }) => {
  // A fresh account, so this doesn't depend on what anyone has done with the demo logins.
  await register(page, "seeker", `assistant-${Date.now()}@example.com`);
  const saved = await page.request.put("/api/profile", {
    data: {
      full_name: "Assistant Tester",
      headline: "Senior Backend Engineer",
      summary: "Backend engineer building Python APIs on AWS.",
      years_experience: 7,
      skills: ["python", "postgresql", "docker", "aws", "fastapi", "redis"].map((name) => ({ name })),
    },
  });
  expect(saved.ok()).toBeTruthy();
  await page.getByRole("link", { name: "Assistant", exact: true }).click();
  await page.getByLabel(/Minimum match score/).fill("50");

  await page.getByLabel("Turn on the assistant").check();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Find jobs now" }).click();
  const pending = page.getByTestId("assistant-pending");
  await expect(pending.first()).toBeVisible();
  await expect(pending.first().getByRole("textbox")).not.toHaveValue("");
  const total = await pending.count();

  await pending.first().getByRole("button", { name: "Apply" }).click();
  await expect(pending).toHaveCount(total - 1);
  const activity = page.getByTestId("assistant-activity");
  await expect(activity.first()).toContainText("Applied after you approved");

  await activity.first().getByRole("button", { name: "Withdraw" }).click();
  await expect(activity.first()).toContainText("Withdrawn");

  await page.getByRole("radio", { name: /Apply automatically/ }).check();
  const save = page.getByRole("button", { name: "Save settings" });
  await expect(save).toBeDisabled();
  await page.getByRole("checkbox", { name: /I authorise Khoj/ }).check();
  await save.click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
});

test("browse page left panel filters jobs and keeps them in the address", async ({ page }) => {
  await page.goto("/jobs");
  const panel = page.getByRole("complementary", { name: "Search and filters" });
  const count = page.getByText(/^\d+ open jobs?$/);
  await expect(count).toBeVisible();
  const everything = await count.textContent();

  await panel.getByLabel("Skill").fill("kubernetes");
  await expect(count).not.toHaveText(everything!);
  await expect(page).toHaveURL(/skill=kubernetes/);
  const bySkill = await count.textContent();

  await panel.getByRole("button", { name: "Remote" }).click();
  await expect(count).not.toHaveText(bySkill!);
  await expect(page).toHaveURL(/location_type=remote/);

  await page.reload();
  await expect(panel.getByLabel("Skill")).toHaveValue("kubernetes");
  await expect(panel.getByRole("button", { name: "Remote" })).toHaveAttribute("aria-pressed", "true");

  await panel.getByRole("button", { name: "Clear filters" }).click();
  await expect(count).toHaveText(everything!);
  await expect(page).toHaveURL(/\/jobs$/);
});

test("matches left panel narrows the seeker's matches", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Demo seeker" }).click();
  await expect(page.getByRole("button", { name: "Why this match?" }).first()).toBeVisible();
  const panel = page.getByRole("complementary", { name: "Search and filters" });
  const summary = page.getByText(/of your top \d+ matches/);
  await expect(summary).toBeVisible();
  const everything = await summary.textContent();

  await panel.getByRole("button", { name: "Remote" }).click();
  await expect(summary).not.toHaveText(everything!);

  await panel.getByLabel("Search your matches").fill("zzzz-no-such-job");
  await expect(page.getByRole("heading", { name: "No matches with these filters" })).toBeVisible();

  await panel.getByRole("button", { name: "Clear filters" }).click();
  await expect(summary).toHaveText(everything!);
});

test("candidates left panel searches the whole pool", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Demo recruiter" }).click();
  await expect(page.getByRole("heading", { name: "Our jobs" })).toBeVisible();
  const seeded = page.locator("section", { hasText: "Senior Frontend Engineer" }).first();
  await seeded.getByRole("link", { name: "Candidates" }).click();

  const results = page.getByTestId("candidate-results");
  const cards = results.getByRole("button", { name: "Why this match?" });
  await expect(cards.first()).toBeVisible();
  const panel = page.getByRole("complementary", { name: "Search and filters" });
  const firstName = await results.locator("p.text-lg").first().textContent();

  await panel.getByLabel("Search candidates").fill(firstName!);
  await expect(results.locator("p.text-lg").first()).toHaveText(firstName!);
  await expect.poll(() => cards.count()).toBeLessThan(20);

  await panel.getByRole("button", { name: "Clear filters" }).click();
  await panel.getByRole("checkbox", { name: "Has every required skill" }).check();
  await expect(panel.getByRole("button", { name: "Clear filters" })).toBeVisible();
  await expect(page.getByLabel("Ask the hiring assistant")).toBeVisible();
});

test("filter sidebar collapses, gives space back and remembers the choice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/jobs");
  const panel = page.getByRole("complementary", { name: "Search and filters" });
  const search = panel.getByLabel("Search jobs");
  await expect(search).toBeVisible();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(300, 0);

  await search.fill("python");
  await page.getByRole("button", { name: "Collapse filters" }).click();
  await expect(search).toBeHidden();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeLessThan(80);
  await expect(page.getByTestId("filters-active")).toBeAttached();
  await expect(page).toHaveURL(/q=python/);

  await page.goto("/login");
  await page.getByRole("button", { name: "Demo seeker" }).click();
  await expect(page.getByRole("heading", { name: "Your matches" })).toBeVisible();
  const matchesPanel = page.getByRole("complementary", { name: "Search and filters" });
  await expect(matchesPanel.getByLabel("Search your matches")).toBeHidden();

  await page.getByRole("button", { name: "Expand filters" }).click();
  await expect(matchesPanel.getByLabel("Search your matches")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Search and filters" }).getByLabel("Search your matches")).toBeVisible();
});

test("profile page builds up a full profile and rejects unsafe links", async ({ page }) => {
  await register(page, "seeker", `profile-${Date.now()}@example.com`);
  await page.goto("/profile");
  const strength = page.getByRole("progressbar", { name: "Profile strength" });
  await expect(strength).toHaveAttribute("aria-valuenow", "0");

  await page.getByLabel("Full name").fill("Priya Sharma");
  await page.getByLabel("Your skills").fill("Python, Docker");
  await page.getByLabel("Your skills").press("Enter");
  await expect(page.getByTestId("skill-chips")).toContainText("Docker");
  await page.getByRole("button", { name: "Remove Docker" }).click();
  await expect(page.getByTestId("skill-chips")).not.toContainText("Docker");

  await page.getByRole("button", { name: "Add a job" }).click();
  const job = page.getByTestId("work-entry").first();
  await job.getByLabel("Job title").fill("Backend Engineer");
  await job.getByLabel("Company").fill("Acme");
  await job.getByLabel("Started").fill("2021");
  await job.getByLabel("I work here now").check();
  await expect(job.getByLabel("Ended")).toBeDisabled();

  await page.getByRole("button", { name: "Add a project" }).click();
  const project = page.getByTestId("project-entry").first();
  await project.getByLabel("Project name").fill("Open Metrics");
  await project.getByLabel("Started").fill("2023");
  await project.getByLabel("Still working on this").check();
  await project.getByLabel("Technologies used").fill("Go");
  await project.getByLabel("Technologies used").press("Enter");

  await page.getByRole("button", { name: "Timeline" }).click();
  const timeline = page.getByTestId("timeline");
  await expect(timeline.getByRole("listitem")).toHaveCount(2);
  await expect(timeline).toContainText("Open Metrics");
  await expect(timeline).toContainText("Backend Engineer");
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  await page.getByLabel("Availability").selectOption("1-month");
  await page.getByLabel("Portfolio").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("https://");
  await page.getByLabel("Portfolio").fill("https://priya.example.com");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("work-entry").first().getByLabel("Company")).toHaveValue("Acme");
  await expect(page.getByLabel("Portfolio")).toHaveValue("https://priya.example.com");
  await expect(page.getByLabel("Availability")).toHaveValue("1-month");
  await expect(page.getByTestId("project-entry").first().getByLabel("Project name")).toHaveValue("Open Metrics");
  expect(Number(await strength.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
});
