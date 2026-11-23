import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMain, report } from "./lib/check-utils.mjs";
import { loadItemCatalog } from "./check-real-site-results.mjs";

const LINK_ID = /^RL-[A-Za-z0-9-]+$/;
const ISSUE_ID = /^ISS-\d+$/;
const KINDS = new Set([
  "unit",
  "integration",
  "e2e-chrome",
  "e2e-firefox",
  "harness",
]);
const LIVE_STATUSES = new Set(["pending", "done", "blocked", "na"]);

/** Validate live→synthetic regression link registry / 実サイトの不具合と合成テストの対応表を検査。 */
export function checkRegressionLinks(repositoryRoot) {
  const errors = [];
  const registryPath = path.join(
    repositoryRoot,
    "docs/quality/regression-links.json",
  );
  if (!fs.existsSync(registryPath)) {
    return { errors: [`missing ${registryPath}`], registryPath };
  }

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch (error) {
    return {
      errors: [`regression-links.json is not valid JSON: ${error.message}`],
      registryPath,
    };
  }

  if (registry.schemaVersion !== 1) {
    errors.push(
      `schemaVersion must be 1 (got ${JSON.stringify(registry.schemaVersion)})`,
    );
  }
  if (!Array.isArray(registry.links)) {
    errors.push("links must be an array");
    return { errors, registryPath };
  }

  const { byId: checklistIds } = loadItemCatalog(repositoryRoot);
  const issuesText = fs.existsSync(
    path.join(repositoryRoot, "docs/quality/issues.md"),
  )
    ? fs.readFileSync(
        path.join(repositoryRoot, "docs/quality/issues.md"),
        "utf8",
      )
    : "";
  const seenLinkIds = new Set();
  const seenPairs = new Set();

  for (const [index, link] of registry.links.entries()) {
    const label = `links[${index}]`;
    if (!link || typeof link !== "object" || Array.isArray(link)) {
      errors.push(`${label} must be an object`);
      continue;
    }

    if (typeof link.id !== "string" || !LINK_ID.test(link.id)) {
      errors.push(`${label}.id must match RL-…`);
    } else if (seenLinkIds.has(link.id)) {
      errors.push(`${label}: duplicate id ${link.id}`);
    } else {
      seenLinkIds.add(link.id);
    }

    if (typeof link.issueId !== "string" || !ISSUE_ID.test(link.issueId)) {
      errors.push(`${label}.issueId must match ISS-<number>`);
    } else if (
      issuesText &&
      !new RegExp(`^## ${link.issueId}\\b`, "m").test(issuesText)
    ) {
      errors.push(
        `${label}.issueId ${link.issueId} is not a heading in docs/quality/issues.md`,
      );
    }

    if (typeof link.title !== "string" || !link.title.trim()) {
      errors.push(`${label}.title must be a non-empty string`);
    }
    if (link.foundIn !== "live-site" && link.foundIn !== "synthetic") {
      errors.push(
        `${label}.foundIn must be live-site|synthetic (got ${JSON.stringify(link.foundIn)})`,
      );
    }
    if (link.anonymized !== true) {
      errors.push(
        `${label}.anonymized must be true (chat bodies and identifiers are forbidden)`,
      );
    }

    if (!Array.isArray(link.checklistIds) || link.checklistIds.length < 1) {
      errors.push(`${label}.checklistIds must be a non-empty array`);
    } else {
      for (const checklistId of link.checklistIds) {
        if (!checklistIds.has(checklistId)) {
          errors.push(
            `${label}.checklistIds: unknown checklist id ${checklistId}`,
          );
        }
      }
    }

    const synthetic = link.synthetic;
    if (
      !synthetic ||
      typeof synthetic !== "object" ||
      Array.isArray(synthetic)
    ) {
      errors.push(`${label}.synthetic must be an object`);
    } else {
      if (!KINDS.has(synthetic.kind)) {
        errors.push(
          `${label}.synthetic.kind must be one of ${[...KINDS].join("|")}`,
        );
      }
      if (typeof synthetic.path !== "string" || !synthetic.path.trim()) {
        errors.push(`${label}.synthetic.path must be a non-empty string`);
      } else {
        if (
          path.isAbsolute(synthetic.path) ||
          synthetic.path.includes("..") ||
          !synthetic.path.startsWith("tests/")
        ) {
          errors.push(
            `${label}.synthetic.path must be a repo-relative tests/… path without ".."`,
          );
        }
        const filePath = path.join(repositoryRoot, synthetic.path);
        if (!fs.existsSync(filePath)) {
          errors.push(
            `${label}.synthetic.path missing file: ${synthetic.path}`,
          );
        } else if (
          typeof synthetic.testNameContains === "string" &&
          synthetic.testNameContains.trim()
        ) {
          const source = fs.readFileSync(filePath, "utf8");
          if (!source.includes(synthetic.testNameContains)) {
            errors.push(
              `${label}.synthetic.testNameContains not found in ${synthetic.path}`,
            );
          }
        } else {
          errors.push(
            `${label}.synthetic.testNameContains must be a non-empty string`,
          );
        }
      }
    }

    const live = link.liveRecheck;
    if (!live || typeof live !== "object" || Array.isArray(live)) {
      errors.push(`${label}.liveRecheck must be an object`);
    } else {
      if (!LIVE_STATUSES.has(live.status)) {
        errors.push(
          `${label}.liveRecheck.status must be pending|done|blocked|na`,
        );
      }
      if (typeof live.reason !== "string" || !live.reason.trim()) {
        errors.push(`${label}.liveRecheck.reason must be a non-empty string`);
      }
      if (
        live.status === "done" &&
        live.runId !== undefined &&
        (typeof live.runId !== "string" || !live.runId.trim())
      ) {
        errors.push(
          `${label}.liveRecheck.runId must be a non-empty string when present`,
        );
      }
    }

    if (link.issueId && synthetic?.path && synthetic?.testNameContains) {
      const pair = `${link.issueId}::${synthetic.path}::${synthetic.testNameContains}`;
      if (seenPairs.has(pair)) {
        errors.push(`${label}: duplicate issue/synthetic pair ${pair}`);
      }
      seenPairs.add(pair);
    }
  }

  const pending = registry.links.filter(
    (link) => link?.liveRecheck?.status === "pending",
  ).length;
  const blocked = registry.links.filter(
    (link) => link?.liveRecheck?.status === "blocked",
  ).length;

  return {
    errors,
    registryPath,
    summary: {
      links: registry.links.length,
      pendingLiveRecheck: pending,
      blockedLiveRecheck: blocked,
    },
  };
}

if (isMain(import.meta.url)) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const result = checkRegressionLinks(repositoryRoot);
  report("regression-links", result.errors, {
    registryPath: result.registryPath,
    summary: result.summary,
    note: "Link form check only; pending liveRecheck does not fail this gate.",
  });
}
