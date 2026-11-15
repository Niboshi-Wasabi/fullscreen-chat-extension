import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { assessAudit } from "../../scripts/check-audit.mjs";
import { workflowPolicy } from "../../scripts/check-workflows.mjs";
import { verifyDigest } from "../../scripts/setup-ci-tools.mjs";
import {
  scanSecrets,
  checkSecrets,
  secretScanFiles,
} from "../../scripts/check-secrets.mjs";

const repository = path.resolve(import.meta.dirname, "../..");
const artifacts = path.join(repository, ".harness-artifacts");
const temporary: string[] = [];
function fixture(files: Record<string, string>) {
  fs.mkdirSync(artifacts, { recursive: true });
  const root = fs.mkdtempSync(path.join(artifacts, "security-fixture-"));
  temporary.push(root);
  for (const [name, content] of Object.entries(files)) {
    const destination = path.join(root, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  return root;
}
afterEach(() => {
  for (const root of temporary.splice(0)) {
    if (path.dirname(path.resolve(root)) !== artifacts)
      throw new Error("Unsafe fixture cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("audit failures are not passes", () => {
  const clean = () => ({
    advisories: {},
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
    },
  });
  const result = (value: unknown, status = 0) => ({
    stdout: JSON.stringify(value),
    status,
    signal: null,
  });
  it("accepts a complete clean registry response", () => {
    expect(assessAudit(result(clean())).passed).toBe(true);
  });
  it("fails a vulnerability even if the process falsely exits zero", () => {
    const value = clean();
    value.metadata.vulnerabilities.moderate = 1;
    expect(assessAudit(result(value)).passed).toBe(false);
  });
  it("fails nonzero exits, invalid JSON and incomplete responses", () => {
    expect(assessAudit(result(clean(), 1)).passed).toBe(false);
    expect(() =>
      assessAudit({ stdout: "not json", status: 0, signal: null }),
    ).toThrow("valid JSON");
    expect(() => assessAudit(result({ error: "network" }))).toThrow(
      "incomplete",
    );
    expect(() =>
      assessAudit({ stdout: "", status: null, signal: "SIGTERM" }),
    ).toThrow("timed out");
  });
});

describe("workflow trust boundary", () => {
  const workflow = () =>
    parse(
      fs.readFileSync(
        path.join(repository, ".github/workflows/verify.yml"),
        "utf8",
      ),
    );
  it("accepts the authored workflow", () => {
    expect(workflowPolicy(workflow())).toEqual([]);
  });
  it("rejects privileged events and mutable Action tags", () => {
    const value = workflow();
    value.on.pull_request_target = null;
    value.jobs.verify.steps[0].uses = "actions/checkout@main";
    expect(workflowPolicy(value)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("privileged"),
        expect.stringContaining("full action SHA"),
      ]),
    );
  });
  it("rejects credentials, hidden required gates and excessive artifacts", () => {
    const value = workflow();
    value.jobs.verify.steps[0].with["persist-credentials"] = true;
    value.jobs.verify.steps[4].if = false;
    value.jobs.verify.steps[5].with.path = ".";
    expect(workflowPolicy(value)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("persist-credentials"),
        expect.stringContaining("unconditionally"),
        expect.stringContaining("explicit summaries"),
      ]),
    );
  });

  it("does not allow failure diagnostics to be moved into a success-only upload", () => {
    const value = workflow();
    value.jobs.verify.steps[6].with.path +=
      "\n.harness-artifacts/verify-results.json";
    value.jobs.verify.env = { TOKEN: "${{ secrets.TOKEN }}" };
    expect(workflowPolicy(value)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("separate"),
        expect.stringContaining("Do not expose secrets"),
      ]),
    );
  });
});

describe("tool integrity and secret scans", () => {
  it("rejects altered executable bytes", () => {
    const original = Buffer.from("verified fixture");
    const digest = createHash("sha256").update(original).digest("hex");
    expect(() => verifyDigest(original, digest)).not.toThrow();
    expect(() => verifyDigest(Buffer.from("changed"), digest)).toThrow(
      "SHA-256",
    );
  });
  it("finds a synthetic token despite inline allow comments and redacts it", () => {
    const token = ["gh", "p_", randomBytes(18).toString("hex")].join("");
    const root = fixture({
      "fixture.env": `API_TOKEN=${token} # gitleaks:allow\n`,
    });
    const report = path.join(root, "report.json");
    expect(scanSecrets(root, report).passed).toBe(false);
    expect(fs.readFileSync(report, "utf8")).not.toContain(token);
  });
  it("accepts the exact storage marker while still detecting a token in that file", () => {
    const file = "src/shared/settings.ts";
    const marker =
      'const DANMAKU_DEFAULTS_MIGRATION_KEY = "' +
      ["fce", "DanmakuDefaultsV2"].join("") +
      '" as const;';
    const root = fixture({ [file]: marker });
    expect(scanSecrets(root, path.join(root, "report.json")).passed).toBe(true);
    fs.writeFileSync(
      path.join(root, file),
      marker +
        `\nconst token = "${["gh", "p_", randomBytes(18).toString("hex")].join("")}";`,
    );
    expect(scanSecrets(root, path.join(root, "report.json")).passed).toBe(
      false,
    );
  });
  it("includes hidden authored files and fails required history without Git", () => {
    const root = fixture({
      ".env": "public example",
      "node_modules/generated.txt": "external copy",
    });
    expect(secretScanFiles(root).files).toContain(".env");
    expect(secretScanFiles(root).files).not.toContain(
      path.join("node_modules", "generated.txt"),
    );
    expect(checkSecrets(root, true)).toMatchObject({
      passed: false,
      working: { passed: true },
      history: { status: "unavailable" },
    });
  });
});
