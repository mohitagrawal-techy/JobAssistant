import { defineConfig } from "@playwright/test";

// Runs against the live `docker compose up` stack with real Ollama, so AI steps get long timeouts.
export default defineConfig({
  testDir: "e2e",
  timeout: 300_000,
  expect: { timeout: 120_000 },
  use: { baseURL: "http://localhost:5173", screenshot: "only-on-failure" },
});
