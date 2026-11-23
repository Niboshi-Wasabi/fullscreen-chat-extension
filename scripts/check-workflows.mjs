import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseDocument } from "yaml";
import { toolPath } from "./setup-ci-tools.mjs";
import { isMain, report } from "./lib/check-utils.mjs";

const actions = {
  "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node": "949feb2413d6458794dcd2491c4babbbce0c15c1",
  "actions/upload-artifact": "cf430e030ddbb5b0abf93d22962f4752f3646cd9",
};
const commands = [
  "npm.cmd install --global pnpm@11.9.0 --ignore-scripts",
  "pnpm.cmd install --frozen-lockfile --ignore-scripts",
  "pnpm.cmd verify:ci",
];
const diagnostics = [
  ".harness-artifacts/verify-results.json",
  ".harness-artifacts/test-results.xml",
  ".harness-artifacts/audit-summary.json",
  ".harness-artifacts/secrets-summary.json",
  ".harness-artifacts/workflow-summary.json",
  ".harness-artifacts/e2e-results.json",
  ".harness-artifacts/e2e-junit.xml",
  ".harness-artifacts/e2e-results/",
  ".harness-artifacts/e2e-report/",
];

const releaseCommands = [
  "npm.cmd install --global pnpm@11.9.0 --ignore-scripts",
  "pnpm.cmd install --frozen-lockfile --ignore-scripts",
  "pnpm.cmd verify:ci",
  "pnpm.cmd release:pack",
  "pnpm.cmd check:release:pack",
  "pnpm.cmd release:draft",
];
const releaseArtifacts = [
  ".output/fullscreen-chat-extension-*-chrome.zip",
  ".output/fullscreen-chat-extension-*-firefox.zip",
  ".output/SHA256SUMS.txt",
  ".harness-artifacts/release-status.json",
];

function hasSecretsExpression(workflow) {
  return /\$\{\{[^}]*\bsecrets\b/.test(JSON.stringify(workflow));
}

function checkFixedActions(steps, errors) {
  for (const step of steps.filter((entry) => entry.uses)) {
    const [name, sha] = step.uses.split("@");
    if (name !== "actions/upload-artifact" && Object.hasOwn(step, "if"))
      errors.push("Checkout and Node setup must be unconditional");
    if (
      !actions[name] ||
      !/^[a-f0-9]{40}$/.test(sha ?? "") ||
      actions[name] !== sha
    )
      errors.push(`Use a reviewed full action SHA: ${step.uses}`);
    if (
      name === "actions/checkout" &&
      (step.with?.["persist-credentials"] !== false ||
        step.with?.["fetch-depth"] !== 0)
    )
      errors.push(
        "Checkout requires fetch-depth: 0 and persist-credentials: false",
      );
    if (
      name === "actions/setup-node" &&
      (step.with?.["node-version"] !== "22.23.2" ||
        step.with?.["package-manager-cache"] !== false)
    )
      errors.push(
        "Use pinned Node 22.23.2 and disable automatic package-manager caching",
      );
  }
  for (const name of Object.keys(actions))
    if (!steps.some((step) => step.uses?.startsWith(`${name}@`)))
      errors.push(`Missing required action ${name}`);
}

/** Enforce this project's CI trust boundary in addition to Actionlint / 構文に加えて、権限と必須の検証ステップも確認する。 */
export function workflowPolicy(workflow) {
  const errors = [];
  if (!workflow || typeof workflow !== "object")
    return ["Workflow must be a YAML object"];
  if (
    JSON.stringify(workflow.permissions) !==
    JSON.stringify({ contents: "read" })
  )
    errors.push("Workflow permissions must be exactly contents: read");
  if (
    JSON.stringify(Object.keys(workflow.on ?? {}).sort()) !==
    JSON.stringify(["pull_request", "push", "workflow_dispatch"])
  )
    errors.push(
      "Use pull_request, push, workflow_dispatch only; privileged events are prohibited",
    );
  for (const event of Object.values(workflow.on ?? {}))
    if (event && Object.keys(event).length)
      errors.push(
        "Do not filter required workflow triggers; every PR needs a check",
      );
  if (hasSecretsExpression(workflow))
    errors.push("Do not expose secrets to PR workflows");
  const jobs = workflow.jobs;
  if (!jobs || Object.keys(jobs).length !== 1 || !jobs.verify)
    return [
      ...errors,
      "Expected one verify job with a stable required-check name",
    ];
  const job = jobs.verify;
  if (
    job.name !== "verify-windows" ||
    job["runs-on"] !== "windows-2025" ||
    Object.hasOwn(job, "if") ||
    job.permissions
  )
    errors.push(
      "Keep the unconditional verify-windows job on windows-2025 with inherited read-only permissions",
    );
  if (
    !Number.isInteger(job["timeout-minutes"]) ||
    job["timeout-minutes"] < 1 ||
    job["timeout-minutes"] > 30
  )
    errors.push("Set a job timeout between 1 and 30 minutes");
  if (job.defaults?.run?.shell !== "pwsh")
    errors.push("Use the recorded PowerShell runner shell");
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const runs = steps.filter((step) => step.run);
  if (
    JSON.stringify(runs.map((step) => step.run)) !== JSON.stringify(commands) ||
    runs.some(
      (step) =>
        Object.hasOwn(step, "if") || step["continue-on-error"] || step.shell,
    )
  )
    errors.push(
      "Install pinned pnpm, frozen dependencies and run verify:ci unconditionally in order",
    );
  if (
    job["continue-on-error"] ||
    steps.some((step) => step["continue-on-error"])
  )
    errors.push("Mandatory checks must not continue on error");
  checkFixedActions(steps, errors);
  const uploads = steps.filter((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  const allowedPaths = new Set([
    ...diagnostics,
    ".output/chrome-mv3/",
    ".output/firefox-mv3/",
  ]);
  for (const step of uploads) {
    const paths = String(step.with?.path ?? "")
      .trim()
      .split(/\s+/);
    const isDiagnostic = paths.every((entry) => diagnostics.includes(entry));
    if (!isDiagnostic && paths.some((entry) => diagnostics.includes(entry)))
      errors.push("Keep failure diagnostics separate from success-only builds");
    if (
      step.if !== (isDiagnostic ? "${{ !cancelled() }}" : "${{ success() }}") ||
      step.with?.["if-no-files-found"] !== (isDiagnostic ? "warn" : "error")
    )
      errors.push(
        "Preserve failure diagnostics and upload builds only after success",
      );
    if (
      paths.some((entry) => !allowedPaths.has(entry)) ||
      step.with?.["include-hidden-files"] !== true ||
      step.with?.["retention-days"] !== 7
    )
      errors.push(
        "Upload only explicit summaries/builds, with hidden files enabled and 7-day retention",
      );
  }
  const saved = uploads.flatMap((step) =>
    String(step.with?.path ?? "")
      .trim()
      .split(/\s+/),
  );
  for (const required of allowedPaths)
    if (!saved.includes(required))
      errors.push(`Missing diagnostic/build artifact path ${required}`);
  return errors;
}

/** Enforce trust boundaries on the Draft GitHub Release workflow / Draft Release 生成ワークフローのトリガー・権限・署名シークレット禁止・成果物を検証。 */
export function releaseWorkflowPolicy(workflow) {
  const errors = [];
  if (!workflow || typeof workflow !== "object")
    return ["Workflow must be a YAML object"];
  if (
    JSON.stringify(workflow.permissions) !==
    JSON.stringify({ contents: "write" })
  )
    errors.push("Release workflow permissions must be exactly contents: write");
  if (
    JSON.stringify(Object.keys(workflow.on ?? {}).sort()) !==
    JSON.stringify(["push", "workflow_dispatch"])
  )
    errors.push(
      "Release workflow may only run on version tag push and workflow_dispatch",
    );
  const pushConfig = workflow.on?.push;
  if (
    !pushConfig ||
    typeof pushConfig !== "object" ||
    JSON.stringify(Object.keys(pushConfig)) !== JSON.stringify(["tags"]) ||
    JSON.stringify(pushConfig.tags) !== JSON.stringify(["v*"])
  )
    errors.push(
      "Release workflow push trigger must be limited to v* tags only",
    );
  if (hasSecretsExpression(workflow))
    errors.push("Do not expose custom or store secrets in release workflows");
  if (workflow.concurrency?.["cancel-in-progress"] !== false)
    errors.push("Do not cancel in-progress draft release runs");

  const jobs = workflow.jobs;
  if (!jobs || Object.keys(jobs).length !== 1 || !jobs["release-draft"])
    return [
      ...errors,
      "Expected one release-draft job in the release workflow",
    ];
  const job = jobs["release-draft"];
  if (
    job.name !== "release-draft-windows" ||
    job["runs-on"] !== "windows-2025" ||
    Object.hasOwn(job, "if") ||
    job.permissions
  )
    errors.push(
      "Keep the unconditional release-draft-windows job on windows-2025 without overridden permissions",
    );
  if (
    !Number.isInteger(job["timeout-minutes"]) ||
    job["timeout-minutes"] < 1 ||
    job["timeout-minutes"] > 30
  )
    errors.push("Set a release job timeout between 1 and 30 minutes");
  if (job.defaults?.run?.shell !== "pwsh")
    errors.push("Use the recorded PowerShell runner shell");

  const steps = Array.isArray(job.steps) ? job.steps : [];
  const runs = steps.filter((step) => step.run);
  if (
    JSON.stringify(runs.map((step) => step.run)) !==
      JSON.stringify(releaseCommands) ||
    runs.some(
      (step) =>
        Object.hasOwn(step, "if") || step["continue-on-error"] || step.shell,
    )
  )
    errors.push(
      "Run verify:ci, release:pack, check:release:pack and release:draft unconditionally in order",
    );
  const draftStep = runs.find((step) => step.run === "pnpm.cmd release:draft");
  if (draftStep?.env?.GH_TOKEN !== "${{ github.token }}")
    errors.push("Pass built-in github.token to GH_TOKEN for release:draft");
  if (
    job["continue-on-error"] ||
    steps.some((step) => step["continue-on-error"])
  )
    errors.push("Release workflow steps must not continue on error");
  checkFixedActions(steps, errors);

  const uploads = steps.filter((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  const allowedPaths = new Set(releaseArtifacts);
  for (const step of uploads) {
    const paths = String(step.with?.path ?? "")
      .trim()
      .split(/\s+/);
    if (
      step.if !== "${{ success() }}" ||
      step.with?.["if-no-files-found"] !== "error"
    )
      errors.push("Upload release artifacts only after full success");
    if (
      paths.some((entry) => !allowedPaths.has(entry)) ||
      step.with?.["include-hidden-files"] !== true ||
      step.with?.["retention-days"] !== 7
    )
      errors.push(
        "Upload only explicit release archives/checksums/status with hidden files and 7-day retention",
      );
  }
  const saved = uploads.flatMap((step) =>
    String(step.with?.path ?? "")
      .trim()
      .split(/\s+/),
  );
  for (const required of allowedPaths)
    if (!saved.includes(required))
      errors.push(`Missing release artifact path ${required}`);
  return errors;
}

const workflowPolicies = {
  "verify.yml": workflowPolicy,
  "release.yml": releaseWorkflowPolicy,
};

if (isMain(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  const destination = path.join(
    root,
    ".harness-artifacts/workflow-summary.json",
  );
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    const directory = path.join(root, ".github/workflows");
    const files = fs
      .readdirSync(directory)
      .filter((file) => /\.ya?ml$/.test(file))
      .sort()
      .map((file) => path.join(directory, file));
    const names = files.map((file) => path.basename(file));
    if (
      JSON.stringify(names) !==
      JSON.stringify(Object.keys(workflowPolicies).sort())
    )
      throw new Error(
        "Review workflow-policy changes before introducing or removing workflows",
      );
    const errors = [];
    for (const file of files) {
      const parsed = parseDocument(fs.readFileSync(file, "utf8"), {
        uniqueKeys: true,
      });
      if (parsed.errors.length)
        errors.push(...parsed.errors.map((error) => error.message));
      else errors.push(...workflowPolicies[path.basename(file)](parsed.toJS()));
    }
    const checked = spawnSync(
      toolPath("actionlint"),
      ["-no-color", "-shellcheck=", "-pyflakes=", ...files],
      { cwd: root, encoding: "utf8", shell: false, timeout: 30000 },
    );
    if (checked.error || checked.status !== 0)
      errors.push(
        `Actionlint failed: ${checked.error?.message ?? checked.stdout + checked.stderr}`,
      );
    fs.writeFileSync(
      destination,
      JSON.stringify(
        { passed: !errors.length, files: files.length, errors },
        null,
        2,
      ),
    );
    report("workflows", errors);
  } catch (error) {
    fs.writeFileSync(
      destination,
      JSON.stringify({ passed: false, error: error.message }, null, 2),
    );
    report("workflows", [error.message]);
  }
}
