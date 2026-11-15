import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: ".harness-artifacts/e2e-results",
  timeout: 30000,
  expect: { timeout: 8000 },
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [
    ["list"],
    ["json", { outputFile: ".harness-artifacts/e2e-results.json" }],
    ["junit", { outputFile: ".harness-artifacts/e2e-junit.xml" }],
    ["html", { outputFolder: ".harness-artifacts/e2e-report", open: "never" }],
  ],
  projects: [
    { name: `${process.env.E2E_BROWSER_CHANNEL ?? "chromium"}-extension` },
  ],
});
