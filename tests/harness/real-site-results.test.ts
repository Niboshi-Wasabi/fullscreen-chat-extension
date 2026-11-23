import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkRealSiteResults } from "../../scripts/check-real-site-results.mjs";
import {
  finalizeRealSiteRun,
  initRealSiteRun,
} from "../../scripts/real-site-run.mjs";

const repository = path.resolve(import.meta.dirname, "../..");
const artifacts = path.join(repository, ".harness-artifacts");
const temporary: string[] = [];

const ITEM_CATALOG = fs.readFileSync(
  path.join(repository, "docs/quality/real-site-item-ids.json"),
  "utf8",
);

const MANIFEST_SHA =
  "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";

function fixtureRoot() {
  fs.mkdirSync(artifacts, { recursive: true });
  const root = fs.mkdtempSync(path.join(artifacts, "real-site-fixture-"));
  temporary.push(root);
  fs.mkdirSync(path.join(root, "docs/quality"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs/quality/real-site-item-ids.json"),
    ITEM_CATALOG,
  );
  return root;
}

function writeRun(
  root: string,
  runId: string,
  results: Record<string, unknown>,
  evidenceFiles: Record<string, string> = {},
) {
  const runDirectory = path.join(
    root,
    ".harness-artifacts",
    "real-site",
    runId,
  );
  fs.mkdirSync(path.join(runDirectory, "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(runDirectory, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  for (const [name, text] of Object.entries(evidenceFiles)) {
    const destination = path.join(runDirectory, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text);
  }
  return runDirectory;
}

function baseResults(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    runId: "sample-run",
    startedAt: "2026-11-19T00:00:00.000Z",
    actor: "agent",
    environment: "live-site",
    browser: {
      product: "chrome",
      version: "157.0.0.0",
      mcp: "chrome-devtools",
    },
    build: {
      target: "chrome-mv3",
      outputDir: ".output/chrome-mv3",
      manifestSha256: MANIFEST_SHA,
    },
    loginState: "logged-out",
    items: [
      {
        id: "YL-1",
        status: "pass",
        reason: "Panel remained after fullscreen toggle",
        evidence: ["evidence/yl-1.txt"],
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== artifacts) {
      throw new Error("Unsafe fixture cleanup path");
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("real-site results gate", () => {
  it("accepts a minimal valid pass record with evidence", () => {
    const root = fixtureRoot();
    const runDirectory = writeRun(root, "sample-run", baseResults(), {
      "evidence/yl-1.txt": "panel visible",
    });
    expect(checkRealSiteResults(runDirectory, root).errors).toEqual([]);
  });

  it("rejects malformed and unknown checklist ids", () => {
    const root = fixtureRoot();
    const malformed = writeRun(
      root,
      "sample-run",
      baseResults({
        items: [
          {
            id: "ZZ-1",
            status: "not-run",
            reason: "malformed",
          },
        ],
      }),
    );
    expect(checkRealSiteResults(malformed, root).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must match checklist id pattern"),
      ]),
    );

    const unknown = writeRun(
      root,
      "unknown-id-run",
      baseResults({
        runId: "unknown-id-run",
        items: [
          {
            id: "YL-99",
            status: "not-run",
            reason: "not in catalog",
          },
        ],
      }),
    );
    expect(checkRealSiteResults(unknown, root).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unknown checklist id YL-99"),
      ]),
    );
  });

  it("rejects pass without evidence files", () => {
    const root = fixtureRoot();
    const runDirectory = writeRun(root, "sample-run", baseResults());
    expect(checkRealSiteResults(runDirectory, root).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("missing file: evidence/yl-1.txt"),
      ]),
    );
  });

  it("rejects invalid status values", () => {
    const root = fixtureRoot();
    const runDirectory = writeRun(
      root,
      "sample-run",
      baseResults({
        items: [
          {
            id: "YL-1",
            status: "success",
            reason: "bad status",
            evidence: ["evidence/yl-1.txt"],
          },
        ],
      }),
      { "evidence/yl-1.txt": "x" },
    );
    expect(checkRealSiteResults(runDirectory, root).errors).toEqual(
      expect.arrayContaining([expect.stringContaining("status must be")]),
    );
  });

  it("rejects browser/build target mismatch", () => {
    const root = fixtureRoot();
    const runDirectory = writeRun(
      root,
      "sample-run",
      baseResults({
        browser: { product: "firefox" },
        build: {
          target: "chrome-mv3",
          manifestSha256: MANIFEST_SHA,
        },
        items: [
          {
            id: "YL-1",
            status: "not-run",
            reason: "mismatch case",
          },
        ],
      }),
    );
    expect(checkRealSiteResults(runDirectory, root).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("does not match browser.product"),
      ]),
    );
  });

  it("rejects na for items that are not naAllowed", () => {
    const root = fixtureRoot();
    const runDirectory = writeRun(
      root,
      "sample-run",
      baseResults({
        items: [
          {
            id: "YL-1",
            status: "na",
            reason: "incorrectly marked na",
          },
        ],
      }),
    );
    expect(checkRealSiteResults(runDirectory, root).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("status na is not allowed for YL-1"),
      ]),
    );
  });

  it("accepts na for catalog naAllowed items", () => {
    const root = fixtureRoot();
    const runDirectory = writeRun(
      root,
      "sample-run",
      baseResults({
        items: [
          {
            id: "YC-1",
            status: "na",
            reason: "ISS-027 retired youtube comments path",
          },
        ],
      }),
    );
    expect(checkRealSiteResults(runDirectory, root).errors).toEqual([]);
  });
});

describe("real-site run init", () => {
  it("writes build hashes and a checkable skeleton", () => {
    const root = fixtureRoot();
    const outputDir = path.join(root, ".output", "chrome-mv3");
    fs.mkdirSync(path.join(outputDir, "content-scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, "manifest.json"),
      JSON.stringify({ name: "fixture", version: "0.1.0" }),
    );
    fs.writeFileSync(
      path.join(outputDir, "content-scripts", "content.js"),
      "console.log('fixture');",
    );

    const created = initRealSiteRun(root, {
      browser: "chrome",
      runId: "init-smoke",
      actor: "agent",
    });
    expect(created.runId).toBe("init-smoke");
    expect(created.results.build.manifestSha256).toMatch(/^[A-F0-9]{64}$/);
    expect(created.results.build.contentScriptSha256).toMatch(/^[A-F0-9]{64}$/);

    const checked = checkRealSiteResults(created.runDirectory, root);
    expect(checked.errors).toEqual([]);

    const finished = finalizeRealSiteRun(root, "init-smoke");
    expect(finished.results.finishedAt).toMatch(/^\d{4}-/);

    expect(() => finalizeRealSiteRun(root, "../escape")).toThrow(
      "single path segment",
    );
  });
});
