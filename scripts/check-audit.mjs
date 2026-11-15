import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isMain, report } from "./lib/check-utils.mjs";

/** Locate the installed pnpm CLI without executing a command shell / シェルを介さずpnpmの実体を探す。 */
function pnpmCommand() {
  const candidates = [
    process.env.npm_execpath,
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .flatMap((directory) => [
        path.join(directory, "node_modules/pnpm/bin/pnpm.mjs"),
        path.join(directory, "node_modules/pnpm/bin/pnpm.cjs"),
      ]),
  ];
  const file = candidates.find(
    (candidate) =>
      candidate &&
      /pnpm\.(mjs|cjs)$/.test(candidate) &&
      fs.existsSync(candidate),
  );
  if (!file)
    throw new Error(
      "Cannot locate pnpm CLI; install the packageManager version and add it to PATH",
    );
  return [process.execPath, file];
}

/** Require a complete advisory response and successful process / 照会失敗や壊れた応答は合格にしない。 */
export function assessAudit(result) {
  if (result.error || result.signal || result.status === null)
    throw new Error("Audit process failed or timed out");
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw new Error("Audit did not return valid JSON");
  }
  const counts = data.metadata?.vulnerabilities;
  const severities = ["info", "low", "moderate", "high", "critical"];
  if (
    data.error ||
    !counts ||
    severities.some(
      (severity) =>
        !Number.isSafeInteger(counts[severity]) || counts[severity] < 0,
    ) ||
    !data.advisories ||
    typeof data.advisories !== "object" ||
    Array.isArray(data.advisories)
  )
    throw new Error("Audit response is incomplete or reports a registry error");
  const findings = Object.values(data.advisories).map((entry) => ({
    id: entry.github_advisory_id ?? entry.id,
    severity: entry.severity,
    module: entry.module_name,
    title: entry.title,
    url: entry.url,
  }));
  return {
    passed:
      result.status === 0 &&
      Object.values(counts).every((count) => count === 0) &&
      findings.length === 0,
    counts,
    findings,
  };
}

if (isMain(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  const destination = path.join(root, ".harness-artifacts/audit-summary.json");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    const [command, cli] = pnpmCommand();
    const result = spawnSync(
      command,
      [cli, "audit", "--audit-level", "low", "--json"],
      {
        cwd: root,
        encoding: "utf8",
        shell: false,
        timeout: 60000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    const summary = assessAudit(result);
    fs.writeFileSync(destination, JSON.stringify(summary, null, 2));
    report(
      "audit",
      summary.passed
        ? []
        : [
            "Known advisories remain; update dependencies rather than suppressing the gate",
          ],
      summary,
    );
  } catch (error) {
    fs.writeFileSync(
      destination,
      JSON.stringify({ passed: false, error: error.message }, null, 2),
    );
    report("audit", [error.message]);
  }
}
