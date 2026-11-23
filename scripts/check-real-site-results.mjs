import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMain, report } from "./lib/check-utils.mjs";

const STATUSES_REQUIRING_EVIDENCE = new Set(["pass", "fail", "conditional"]);
const ALLOWED_STATUSES = new Set([
  "pass",
  "fail",
  "conditional",
  "not-run",
  "blocked",
  "na",
]);
const ALLOWED_PRODUCTS = new Set(["chrome", "firefox"]);
const ALLOWED_TARGETS = new Set(["chrome-mv3", "firefox-mv3"]);
const ALLOWED_ACTORS = new Set(["agent", "human"]);
const ALLOWED_LOGIN = new Set(["logged-out", "logged-in-permitted", "unknown"]);
const SHA256 = /^[A-Fa-f0-9]{64}$/;
const ITEM_ID = /^(YL|YA|YC|TL|TV|X)-[0-9]+$/;

/** Load catalog of known checklist item IDs / チェックリストの項目 ID 一覧を読み込む。 */
export function loadItemCatalog(repositoryRoot) {
  const catalogPath = path.join(
    repositoryRoot,
    "docs/quality/real-site-item-ids.json",
  );
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const byId = new Map();
  for (const item of catalog.items ?? []) {
    if (!item?.id) continue;
    byId.set(item.id, item);
  }
  return { catalogPath, byId };
}

/**
 * Validate one real-site results.json without treating form OK as product pass.
 * 記録の形式を検査する。機能の合否は別途判定する。
 */
export function checkRealSiteResults(runDirectory, repositoryRoot) {
  const errors = [];
  const resultsPath = path.join(runDirectory, "results.json");
  if (!fs.existsSync(resultsPath)) {
    return {
      errors: [`missing results.json in ${runDirectory}`],
      resultsPath,
    };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
  } catch (error) {
    return {
      errors: [`results.json is not valid JSON: ${error.message}`],
      resultsPath,
    };
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { errors: ["results.json root must be an object"], resultsPath };
  }

  if (data.schemaVersion !== 1) {
    errors.push(
      `schemaVersion must be 1 (got ${JSON.stringify(data.schemaVersion)})`,
    );
  }
  for (const key of [
    "runId",
    "startedAt",
    "actor",
    "environment",
    "browser",
    "build",
    "loginState",
    "items",
  ]) {
    if (!(key in data)) errors.push(`missing required field: ${key}`);
  }

  if (data.environment !== "live-site") {
    errors.push(
      `environment must be "live-site" (got ${JSON.stringify(data.environment)})`,
    );
  }
  if (data.actor !== undefined && !ALLOWED_ACTORS.has(data.actor)) {
    errors.push(
      `actor must be agent|human (got ${JSON.stringify(data.actor)})`,
    );
  }
  if (data.loginState !== undefined && !ALLOWED_LOGIN.has(data.loginState)) {
    errors.push(
      `loginState must be logged-out|logged-in-permitted|unknown (got ${JSON.stringify(data.loginState)})`,
    );
  }
  if (typeof data.runId !== "string" || !data.runId.trim()) {
    errors.push("runId must be a non-empty string");
  } else {
    const dirName = path.basename(path.resolve(runDirectory));
    if (dirName !== data.runId) {
      errors.push(
        `runId "${data.runId}" does not match run directory name "${dirName}"`,
      );
    }
  }
  if (typeof data.startedAt !== "string" || !data.startedAt.trim()) {
    errors.push("startedAt must be a non-empty string");
  }
  if (
    data.finishedAt !== undefined &&
    (typeof data.finishedAt !== "string" || !data.finishedAt.trim())
  ) {
    errors.push("finishedAt must be a non-empty string when present");
  }

  const browser = data.browser;
  if (!browser || typeof browser !== "object" || Array.isArray(browser)) {
    errors.push("browser must be an object");
  } else {
    if (!ALLOWED_PRODUCTS.has(browser.product)) {
      errors.push(
        `browser.product must be chrome|firefox (got ${JSON.stringify(browser.product)})`,
      );
    }
    if (
      browser.version !== undefined &&
      (typeof browser.version !== "string" || !browser.version.trim())
    ) {
      errors.push("browser.version must be a non-empty string when present");
    }
    if (
      browser.mcp !== undefined &&
      (typeof browser.mcp !== "string" || !browser.mcp.trim())
    ) {
      errors.push("browser.mcp must be a non-empty string when present");
    }
  }

  const build = data.build;
  if (!build || typeof build !== "object" || Array.isArray(build)) {
    errors.push("build must be an object");
  } else {
    if (!ALLOWED_TARGETS.has(build.target)) {
      errors.push(
        `build.target must be chrome-mv3|firefox-mv3 (got ${JSON.stringify(build.target)})`,
      );
    }
    if (browser?.product && build.target) {
      const expected =
        browser.product === "chrome" ? "chrome-mv3" : "firefox-mv3";
      if (build.target !== expected) {
        errors.push(
          `build.target "${build.target}" does not match browser.product "${browser.product}" (expected ${expected})`,
        );
      }
    }
    if (
      typeof build.manifestSha256 !== "string" ||
      !SHA256.test(build.manifestSha256)
    ) {
      errors.push("build.manifestSha256 must be a 64-char hex SHA-256");
    }
    if (
      build.contentScriptSha256 !== undefined &&
      (typeof build.contentScriptSha256 !== "string" ||
        !SHA256.test(build.contentScriptSha256))
    ) {
      errors.push("build.contentScriptSha256 must be a 64-char hex SHA-256");
    }
  }

  const { byId } = loadItemCatalog(repositoryRoot);
  if (!Array.isArray(data.items) || data.items.length < 1) {
    errors.push("items must be a non-empty array");
  } else {
    const seen = new Set();
    for (const [index, item] of data.items.entries()) {
      const label = `items[${index}]`;
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`${label} must be an object`);
        continue;
      }
      if (typeof item.id !== "string" || !ITEM_ID.test(item.id)) {
        errors.push(`${label}.id must match checklist id pattern`);
        continue;
      }
      if (seen.has(item.id)) {
        errors.push(`${label}: duplicate item id ${item.id}`);
      }
      seen.add(item.id);

      const catalogItem = byId.get(item.id);
      if (!catalogItem) {
        errors.push(`${label}: unknown checklist id ${item.id}`);
      }

      if (!ALLOWED_STATUSES.has(item.status)) {
        errors.push(
          `${label}.status must be pass|fail|conditional|not-run|blocked|na (got ${JSON.stringify(item.status)})`,
        );
      }
      if (typeof item.reason !== "string" || !item.reason.trim()) {
        errors.push(`${label}.reason must be a non-empty string`);
      }

      if (item.status === "na" && catalogItem && !catalogItem.naAllowed) {
        errors.push(
          `${label}: status na is not allowed for ${item.id} in the current catalog`,
        );
      }

      const evidence = item.evidence;
      if (STATUSES_REQUIRING_EVIDENCE.has(item.status)) {
        if (!Array.isArray(evidence) || evidence.length < 1) {
          errors.push(
            `${label}: status ${item.status} requires a non-empty evidence array`,
          );
        } else {
          for (const [eIndex, entry] of evidence.entries()) {
            if (typeof entry !== "string" || !entry.trim()) {
              errors.push(
                `${label}.evidence[${eIndex}] must be a non-empty string`,
              );
              continue;
            }
            if (path.isAbsolute(entry) || entry.includes("..")) {
              errors.push(
                `${label}.evidence[${eIndex}] must be a relative path without "..": ${entry}`,
              );
              continue;
            }
            const evidencePath = path.join(runDirectory, entry);
            if (!fs.existsSync(evidencePath)) {
              errors.push(
                `${label}.evidence[${eIndex}] missing file: ${entry}`,
              );
            }
          }
        }
      } else if (evidence !== undefined) {
        if (!Array.isArray(evidence)) {
          errors.push(`${label}.evidence must be an array when present`);
        } else {
          for (const [eIndex, entry] of evidence.entries()) {
            if (typeof entry !== "string" || !entry.trim()) {
              errors.push(
                `${label}.evidence[${eIndex}] must be a non-empty string`,
              );
              continue;
            }
            if (path.isAbsolute(entry) || entry.includes("..")) {
              errors.push(
                `${label}.evidence[${eIndex}] must be a relative path without "..": ${entry}`,
              );
            }
          }
        }
      }
    }
  }

  return {
    errors,
    resultsPath,
    summary: summarize(data),
  };
}

function summarize(data) {
  const counts = {
    pass: 0,
    fail: 0,
    conditional: 0,
    "not-run": 0,
    blocked: 0,
    na: 0,
  };
  if (!Array.isArray(data?.items)) return counts;
  for (const item of data.items) {
    if (item?.status && counts[item.status] !== undefined) {
      counts[item.status] += 1;
    }
  }
  return counts;
}

function resolveRunDirectory(argument, repositoryRoot) {
  if (!argument) {
    throw new Error(
      "usage: node scripts/check-real-site-results.mjs <runId|runDirectory>",
    );
  }
  if (
    path.isAbsolute(argument) ||
    argument.includes(path.sep) ||
    argument.includes("/")
  ) {
    return path.resolve(argument);
  }
  return path.join(repositoryRoot, ".harness-artifacts", "real-site", argument);
}

/** Drop pnpm's extra "--" separator / pnpm が付ける "--" を除く。 */
function cliArgs(argv) {
  return argv.slice(2).filter((value) => value !== "--");
}

if (isMain(import.meta.url)) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const target = cliArgs(process.argv)[0];
  let runDirectory;
  try {
    runDirectory = resolveRunDirectory(target, repositoryRoot);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  if (runDirectory) {
    const result = checkRealSiteResults(runDirectory, repositoryRoot);
    report("real-site-results", result.errors, {
      runDirectory,
      resultsPath: result.resultsPath,
      summary: result.summary,
      note: "Form check only; not a product pass judgment.",
    });
  }
}
