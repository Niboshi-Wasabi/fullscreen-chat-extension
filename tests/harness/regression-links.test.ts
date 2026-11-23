import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkRegressionLinks } from "../../scripts/check-regression-links.mjs";

const repository = path.resolve(import.meta.dirname, "../..");
const artifacts = path.join(repository, ".harness-artifacts");
const temporary: string[] = [];

function fixtureRoot(files: Record<string, string>) {
  fs.mkdirSync(artifacts, { recursive: true });
  const root = fs.mkdtempSync(path.join(artifacts, "regression-links-"));
  temporary.push(root);
  for (const [name, text] of Object.entries(files)) {
    const destination = path.join(root, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text);
  }
  return root;
}

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    if (path.dirname(path.resolve(directory)) !== artifacts) {
      throw new Error("Unsafe fixture cleanup path");
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const catalog = fs.readFileSync(
  path.join(repository, "docs/quality/real-site-item-ids.json"),
  "utf8",
);

function validLink(overrides: Record<string, unknown> = {}) {
  return {
    id: "RL-TEST",
    issueId: "ISS-028",
    checklistIds: ["YL-6"],
    title: "Example link",
    foundIn: "live-site",
    anonymized: true,
    synthetic: {
      kind: "unit",
      path: "tests/unit/example.test.ts",
      testNameContains: "example assertion name",
    },
    liveRecheck: {
      status: "pending",
      reason: "awaiting live window",
    },
    ...overrides,
  };
}

describe("regression-links gate", () => {
  it("accepts the repository registry", () => {
    expect(checkRegressionLinks(repository).errors).toEqual([]);
  });

  it("rejects unknown checklist ids and missing synthetic files", () => {
    const root = fixtureRoot({
      "docs/quality/real-site-item-ids.json": catalog,
      "docs/quality/issues.md": "## ISS-028\n\n- note\n",
      "docs/quality/regression-links.json": JSON.stringify({
        schemaVersion: 1,
        links: [
          validLink({
            checklistIds: ["ZZ-9"],
            synthetic: {
              kind: "unit",
              path: "tests/unit/missing.test.ts",
              testNameContains: "nope",
            },
          }),
        ],
      }),
    });
    expect(checkRegressionLinks(root).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unknown checklist id ZZ-9"),
        expect.stringContaining("missing file: tests/unit/missing.test.ts"),
      ]),
    );
  });

  it("rejects non-anonymized entries and unmatched test names", () => {
    const root = fixtureRoot({
      "docs/quality/real-site-item-ids.json": catalog,
      "docs/quality/issues.md": "## ISS-028\n\n- note\n",
      "tests/unit/example.test.ts":
        'it("example assertion name", () => undefined);\n',
      "docs/quality/regression-links.json": JSON.stringify({
        schemaVersion: 1,
        links: [
          validLink({ anonymized: false }),
          validLink({
            id: "RL-TEST-2",
            synthetic: {
              kind: "unit",
              path: "tests/unit/example.test.ts",
              testNameContains: "does not exist in file",
            },
          }),
        ],
      }),
    });
    expect(checkRegressionLinks(root).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("anonymized must be true"),
        expect.stringContaining("testNameContains not found"),
      ]),
    );
  });

  it("accepts a minimal valid fixture registry", () => {
    const root = fixtureRoot({
      "docs/quality/real-site-item-ids.json": catalog,
      "docs/quality/issues.md": "## ISS-028\n\n- note\n",
      "tests/unit/example.test.ts":
        'it("example assertion name", () => undefined);\n',
      "docs/quality/regression-links.json": JSON.stringify({
        schemaVersion: 1,
        links: [validLink()],
      }),
    });
    expect(checkRegressionLinks(root).errors).toEqual([]);
  });
});
