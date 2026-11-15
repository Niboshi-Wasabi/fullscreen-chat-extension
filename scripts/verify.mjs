import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isMain } from "./lib/check-utils.mjs";

export const steps = [
  ["prepare", "node_modules/wxt/bin/wxt.mjs", "prepare"],
  ["ci-tools", "scripts/setup-ci-tools.mjs"],
  ["workflows", "scripts/check-workflows.mjs"],
  ["docs", "scripts/verify-docs.mjs"],
  ["locales", "scripts/verify-locales.mjs"],
  [
    "format",
    "node_modules/prettier/bin/prettier.cjs",
    "--check",
    "src",
    "scripts",
    "tests",
    ".github",
    "*.ts",
    "*.mjs",
    "*.cjs",
    "*.json",
    "pnpm-workspace.yaml",
  ],
  [
    "lint",
    "node_modules/eslint/bin/eslint.js",
    "src",
    "scripts",
    "tests",
    "eslint.config.mjs",
    "vitest.config.ts",
    "playwright.config.ts",
    "wxt.config.ts",
    "--max-warnings=0",
  ],
  ["types", "node_modules/typescript/bin/tsc", "--noEmit"],
  ["tests", "node_modules/vitest/vitest.mjs", "run"],
  [
    "architecture",
    "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
    "src",
    "--config",
    ".dependency-cruiser.cjs",
    "--output-type",
    "err-long",
  ],
  ["chrome-build", "node_modules/wxt/bin/wxt.mjs", "build"],
  ["firefox-build", "node_modules/wxt/bin/wxt.mjs", "build", "-b", "firefox"],
  ["manifests", "scripts/verify-manifests.mjs"],
];

/** Run sequential checks without a shell; stop and record not-run on failure / シェルを介さず実行し失敗後を未実行として返す。 */
export function runVerification(root, run = spawnSync, selectedSteps = steps) {
  const results = [];
  for (const [name, script, ...args] of selectedSteps) {
    console.log(`\n[verify] ${name}`);
    const started = Date.now();
    const result = run(process.execPath, [path.join(root, script), ...args], {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    results.push({
      name,
      status: result.status === 0 && !result.error ? "passed" : "failed",
      exitCode: result.status,
      signal: result.signal ?? null,
      error: result.error?.message,
      durationMs: Date.now() - started,
    });
    if (results.at(-1).status === "failed") break;
  }
  for (const [name] of selectedSteps.slice(results.length))
    results.push({ name, status: "not-run" });
  return results;
}

/** Select explicit verification profiles; CI always requires pinned browser E2E / CIの拡張E2Eを省略しない。
 * @param {{securityOnly?: boolean, ci?: boolean, browser?: string, requireHistory?: boolean}} options
 */
export function selectSteps({
  securityOnly = false,
  ci = false,
  browser,
  requireHistory = false,
} = {}) {
  if (browser !== undefined && !["chromium", "chrome"].includes(browser))
    throw new Error("Unsupported browser profile");
  if (securityOnly && (ci || browser))
    throw new Error("Security-only mode cannot replace a full CI/browser run");
  if (ci && browser === "chrome")
    throw new Error("CI must use pinned Chromium, not an installed Chrome");
  const history = ci || requireHistory;
  const securitySteps = [
    ["audit", "scripts/check-audit.mjs"],
    [
      "secrets",
      "scripts/check-secrets.mjs",
      ...(history ? ["--require-history"] : []),
    ],
  ];
  const selectedBrowser = ci ? "chromium" : browser;
  const browserSteps = selectedBrowser
    ? [
        ...(selectedBrowser === "chromium"
          ? [["browser-setup", "scripts/setup-browser.mjs"]]
          : []),
        ["browser-e2e", "scripts/run-e2e.mjs", `--browser=${selectedBrowser}`],
      ]
    : [];
  return securityOnly
    ? [["ci-tools", "scripts/setup-ci-tools.mjs"], ...securitySteps]
    : ci
      ? [...steps, ...browserSteps, ...securitySteps]
      : [...steps, ...browserSteps];
}

if (isMain(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  const securityOnly = process.argv.includes("--security");
  const ci = process.argv.includes("--ci");
  const browser = process.argv
    .find((argument) => argument.startsWith("--browser="))
    ?.slice("--browser=".length);
  const selected = selectSteps({
    securityOnly,
    ci,
    browser,
    requireHistory: process.argv.includes("--require-history"),
  });
  const results = runVerification(root, spawnSync, selected);
  fs.mkdirSync(path.join(root, ".harness-artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(
      root,
      `.harness-artifacts/${securityOnly ? "security-results" : "verify-results"}.json`,
    ),
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        browser: ci ? "chromium" : (browser ?? null),
        timestamp: new Date().toISOString(),
        results,
      },
      null,
      2,
    ),
  );
  console.table(
    results.map(({ name, status, exitCode }) => ({ name, status, exitCode })),
  );
  if (results.some((result) => result.status !== "passed"))
    process.exitCode = 1;
}
