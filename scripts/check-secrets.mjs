import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { toolPath } from "./setup-ci-tools.mjs";
import { isMain, report } from "./lib/check-utils.mjs";

const repository = path.resolve(import.meta.dirname, "..");
const excludedRoots = new Set([
  ".git",
  "node_modules",
  ".output",
  ".wxt",
  ".tmp-extensions",
  ".harness-artifacts",
  ".harness-tools",
  "dist",
]);

function removeStaging(staging, artifacts) {
  if (path.dirname(path.resolve(staging)) !== path.resolve(artifacts))
    throw new Error("Unsafe scan cleanup path");
  fs.rmSync(staging, { recursive: true, force: true });
}

/** Run the pinned scanner with redaction and no inline/ignore-file bypass / redactを有効にし例外コメントで隠さない。 */
export function scanSecrets(target, reportFile, mode = "dir") {
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  const ignoreFile = path.join(
    repository,
    ".harness-artifacts/empty-gitleaksignore",
  );
  fs.mkdirSync(path.dirname(ignoreFile), { recursive: true });
  fs.writeFileSync(ignoreFile, "");
  const result = spawnSync(
    toolPath("gitleaks"),
    [
      mode,
      target,
      ...(mode === "git" ? ["--log-opts=--all"] : []),
      "--config",
      path.join(repository, "scripts/gitleaks.toml"),
      "--gitleaks-ignore-path",
      ignoreFile,
      "--ignore-gitleaks-allow",
      "--redact=100",
      "--no-banner",
      "--no-color",
      "--log-level=error",
      "--report-format=json",
      "--report-path",
      reportFile,
      "--exit-code=1",
      "--timeout=120",
    ],
    {
      cwd: repository,
      encoding: "utf8",
      shell: false,
      timeout: 125000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.error || result.signal || ![0, 1].includes(result.status))
    throw new Error("Gitleaks failed or timed out; scan is not a pass");
  const findings = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  if (!Array.isArray(findings)) throw new Error("Invalid Gitleaks report");
  return {
    passed: result.status === 0 && findings.length === 0,
    findings: findings.map((finding) => ({
      rule: finding.RuleID,
      file: finding.File,
      line: finding.StartLine,
    })),
  };
}

/** Gather authored files; Git tracks ignored-but-committed files as well / Git配置時は誤って追跡した生成物も走査する。 */
export function secretScanFiles(root, git = spawnSync) {
  const detected = git("git", ["-C", root, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    shell: false,
  });
  const hasGit =
    detected.status === 0 &&
    path.resolve(detected.stdout.trim()) === path.resolve(root);
  if (hasGit) {
    const listed = git(
      "git",
      [
        "-C",
        root,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ],
      { encoding: "utf8", shell: false },
    );
    if (listed.status !== 0 || listed.error)
      throw new Error("Cannot enumerate Git working files");
    return {
      hasGit,
      files: [...new Set(listed.stdout.split("\0").filter(Boolean))],
    };
  }
  const files = [];
  const walk = (directory, relative = "") => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!relative && excludedRoots.has(entry.name)) continue;
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(path.join(directory, entry.name), name);
      else if (entry.isFile()) files.push(name);
    }
  };
  walk(root);
  return { hasGit, files };
}

/** Scan a staged working copy, then all fetched history when available / 作業ファイルと取得済み履歴を別々に検査する。 */
export function checkSecrets(root, requireHistory = false) {
  const artifacts = path.join(root, ".harness-artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  const staging = fs.mkdtempSync(path.join(artifacts, "secret-staging-"));
  try {
    const { hasGit, files } = secretScanFiles(root);
    let copied = 0;
    for (const relative of files) {
      const source = path.resolve(root, relative);
      const target = path.resolve(staging, relative);
      const inside = path.relative(staging, target);
      if (
        path.isAbsolute(inside) ||
        inside === ".." ||
        inside.startsWith(`..${path.sep}`)
      )
        throw new Error("Unsafe scan path");
      if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      copied += 1;
    }
    if (!copied) throw new Error("No authored files available to scan");
    const working = scanSecrets(
      staging,
      path.join(artifacts, "secrets-working-redacted.json"),
    );
    working.findings = working.findings.map((finding) => ({
      ...finding,
      file: path.relative(staging, finding.file),
    }));
    let history = {
      status: "unavailable",
      reason: "Git repository is not configured",
    };
    if (hasGit) {
      const shallow = spawnSync(
        "git",
        ["-C", root, "rev-parse", "--is-shallow-repository"],
        { encoding: "utf8", shell: false },
      );
      if (shallow.status !== 0 || shallow.stdout.trim() !== "false")
        throw new Error("Full Git history is required; fetch-depth must be 0");
      const scanned = scanSecrets(
        root,
        path.join(artifacts, "secrets-history-redacted.json"),
        "git",
      );
      history = {
        status: scanned.passed ? "passed" : "failed",
        findings: scanned.findings,
      };
    }
    return {
      passed:
        working.passed &&
        history.status !== "failed" &&
        (!requireHistory || history.status === "passed"),
      working,
      history,
      files: copied,
      requireHistory,
    };
  } finally {
    removeStaging(staging, artifacts);
  }
}

if (isMain(import.meta.url)) {
  const destination = path.join(
    repository,
    ".harness-artifacts/secrets-summary.json",
  );
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    const summary = checkSecrets(
      repository,
      process.argv.includes("--require-history"),
    );
    fs.writeFileSync(destination, JSON.stringify(summary, null, 2));
    report(
      "secrets",
      summary.passed
        ? []
        : ["Secret findings or required history scan remain unresolved"],
      summary,
    );
  } catch (error) {
    fs.writeFileSync(
      destination,
      JSON.stringify({ passed: false, error: error.message }, null, 2),
    );
    report("secrets", [error.message]);
  }
}
