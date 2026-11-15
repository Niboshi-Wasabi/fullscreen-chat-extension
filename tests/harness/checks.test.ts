import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { checkLocales } from "../../scripts/verify-locales.mjs";
import { checkDocumentation } from "../../scripts/verify-docs.mjs";
import { checkManifest } from "../../scripts/verify-manifests.mjs";
import { runVerification } from "../../scripts/verify.mjs";

const repository = path.resolve(import.meta.dirname, "../..");
const artifacts = path.join(repository, ".harness-artifacts");
const temporary: string[] = [];

function fixture(files: Record<string, string>) {
  fs.mkdirSync(artifacts, { recursive: true });
  const root = fs.mkdtempSync(path.join(artifacts, "fixture-"));
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
    if (path.dirname(path.resolve(directory)) !== artifacts)
      throw new Error("Unsafe fixture cleanup path");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("locale gate", () => {
  const files = {
    "src/shared/i18n/locale-meta.ts":
      'export const APP_LOCALES = [{code:"en"},{code:"ja"}] as const;',
    "src/shared/i18n/locales/en.json": JSON.stringify({
      greeting: "Hi {name}",
      state: "On",
    }),
    "src/shared/i18n/locales/ja.json": JSON.stringify({
      greeting: "こんにちは {name}",
      state: "オン",
    }),
    "docs/quality/locale-fallbacks.json": "{}",
  };

  it("accepts matching catalogs and rejects equal-sized catalogs with different keys", () => {
    const root = fixture(files);
    expect(checkLocales(root).errors).toEqual([]);
    fs.writeFileSync(
      path.join(root, "src/shared/i18n/locales/ja.json"),
      JSON.stringify({ greeting: "こんにちは {name}", wrong: "オン" }),
    );
    expect(checkLocales(root).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("missing translation"),
        expect.stringContaining("unknown translation key"),
      ]),
    );
  });

  it("rejects changed interpolation variables and stale fallback exceptions", () => {
    const root = fixture({
      ...files,
      "src/shared/i18n/locales/ja.json": JSON.stringify({
        greeting: "Hi {other}",
        state: "オン",
      }),
      "docs/quality/locale-fallbacks.json": '{"ja":["state"]}',
    });
    expect(checkLocales(root).errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("interpolation placeholders"),
        expect.stringContaining("stale fallback"),
      ]),
    );
  });

  it("allows only specifically recorded missing translations", () => {
    const root = fixture({
      ...files,
      "src/shared/i18n/locales/ja.json": '{"greeting":"Hi {name}"}',
      "docs/quality/locale-fallbacks.json": '{"ja":["state"]}',
    });
    expect(checkLocales(root)).toMatchObject({ errors: [], fallbackCount: 1 });
    fs.writeFileSync(
      path.join(root, "docs/quality/locale-fallbacks.json"),
      "{}",
    );
    expect(checkLocales(root).errors).toContainEqual(
      expect.stringContaining("ja.state: missing"),
    );
  });
});

describe("documentation gate", () => {
  it("rejects broken links and malformed skill metadata", () => {
    const root = fixture({
      "AGENTS.md": "# Agent\n[missing](docs/missing.md)",
      "README.md": "# Readme",
      "docs/index.md": "# Index",
      ".agents/skills/broken/SKILL.md":
        "---\nname: broken\ndescription: [\n---\n",
    });
    const result = checkDocumentation(root);
    expect(result.errors).toContainEqual(
      expect.stringContaining("broken link"),
    );
    expect(result.errors).toContainEqual(expect.stringContaining("SKILL.md:"));
  });
});

describe("manifest gate", () => {
  const policy = {
    permissions: ["storage", "windows"],
    host_permissions: ["*://www.youtube.com/*"],
    content_matches: ["*://www.youtube.com/*"],
    content_js: ["content.js"],
    gecko: { id: "fixture@example.test", strict_min_version: "121.0" },
    bundled_assets: [],
  };
  function manifest() {
    return {
      manifest_version: 3,
      version: "0.1.0",
      icons: { "16": "icon.png" },
      permissions: [...policy.permissions],
      host_permissions: [...policy.host_permissions],
      background: { service_worker: "background.js" },
      content_scripts: [
        {
          matches: [...policy.content_matches],
          all_frames: true,
          run_at: "document_idle",
          js: ["content.js"],
        },
      ],
      action: { default_popup: "popup.html" },
      options_ui: { page: "options.html", open_in_tab: true },
    };
  }
  const files = {
    "background.js": "fixture",
    "icon.png": "fixture",
    "content.js": "fixture",
    "popup.html": "fixture",
    "options.html": "fixture",
    "privacy.html": "fixture",
  };

  it("accepts the recorded bundle and rejects widened hosts and missing assets", () => {
    const root = fixture(files);
    const value = manifest();
    expect(checkManifest(value, "chrome", policy, root, "0.1.0")).toEqual([]);
    value.host_permissions.push("<all_urls>");
    fs.unlinkSync(path.join(root, "background.js"));
    expect(checkManifest(value, "chrome", policy, root, "0.1.0")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("host_permissions changed"),
        expect.stringContaining("missing or unsafe bundled asset"),
      ]),
    );
  });

  it("rejects a manifest with no injected script even if other assets exist", () => {
    const root = fixture(files);
    const value = manifest();
    value.content_scripts[0]!.js = [];
    expect(
      checkManifest(value, "chrome", policy, root, "0.1.0"),
    ).toContainEqual(expect.stringContaining("entry assets"));
  });
});

describe("static constraints", () => {
  it.each([
    "browser.windows.create({})",
    "browser['windows'].create({})",
    "const { windows } = browser; void windows",
  ])("rejects content-side windows access: %s", async (code) => {
    const lint = new ESLint({ cwd: repository });
    const result = await lint.lintText(code, {
      filePath: "src/shared/fixture.ts",
    });
    expect(result.flatMap((entry) => entry.messages)).toContainEqual(
      expect.objectContaining({ ruleId: "no-restricted-syntax", severity: 2 }),
    );
  });

  it("detects a dynamic reverse dependency and a cycle", () => {
    const root = fixture({
      "src/core/a.ts": 'export const run = () => import("../views/b");',
      "src/views/b.ts": 'export {run} from "../core/a";',
      "tsconfig.json":
        '{"compilerOptions":{"moduleResolution":"bundler","module":"esnext"}}',
    });
    const result = spawnSync(
      process.execPath,
      [
        path.join(
          repository,
          "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
        ),
        "src",
        "--config",
        path.join(repository, ".dependency-cruiser.cjs"),
        "--output-type",
        "err-long",
      ],
      { cwd: root, encoding: "utf8", timeout: 15000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("core-must-not-import-runtime");
    expect(result.stdout).toContain("no-cycles");
  }, 20000);
});

describe("verification orchestration", () => {
  it("halts on failure and records remaining work as not-run", () => {
    const root = fixture({
      "fail.mjs": "process.exit(7)",
      "must-not-run.mjs": 'throw new Error("should not execute")',
    });
    const result = runVerification(root, spawnSync, [
      ["failure", "fail.mjs"],
      ["later", "must-not-run.mjs"],
    ]);
    expect(result).toMatchObject([
      { name: "failure", status: "failed", exitCode: 7 },
      { name: "later", status: "not-run" },
    ]);
  });
});
