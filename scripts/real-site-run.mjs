import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib/check-utils.mjs";

const TARGETS = {
  chrome: {
    product: "chrome",
    target: "chrome-mv3",
    outputDir: ".output/chrome-mv3",
  },
  firefox: {
    product: "firefox",
    target: "firefox-mv3",
    outputDir: ".output/firefox-mv3",
  },
};

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex").toUpperCase();
}

function parseArgs(argv) {
  const tokens = argv.slice(2).filter((value) => value !== "--");
  const args = {
    command: tokens[0],
    browser: "chrome",
    runId: null,
    actor: "agent",
  };
  for (let i = 1; i < tokens.length; i += 1) {
    const value = tokens[i];
    if (value === "--browser" && tokens[i + 1]) {
      args.browser = tokens[++i];
    } else if (value.startsWith("--browser=")) {
      args.browser = value.slice("--browser=".length);
    } else if (value === "--run-id" && tokens[i + 1]) {
      args.runId = tokens[++i];
    } else if (value.startsWith("--run-id=")) {
      args.runId = value.slice("--run-id=".length);
    } else if (value === "--actor" && tokens[i + 1]) {
      args.actor = tokens[++i];
    } else if (value.startsWith("--actor=")) {
      args.actor = value.slice("--actor=".length);
    } else if (!value.startsWith("-") && !args.runId) {
      args.runId = value;
    }
  }
  return args;
}

function defaultRunId(browser) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${browser}`;
}

function resolveBuild(repositoryRoot, browserKey) {
  const meta = TARGETS[browserKey];
  if (!meta) {
    throw new Error(`unsupported browser "${browserKey}" (use chrome|firefox)`);
  }
  const outputDir = path.join(repositoryRoot, meta.outputDir);
  const manifestPath = path.join(outputDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `missing build output ${meta.outputDir}/manifest.json; run pnpm.cmd build` +
        (browserKey === "firefox" ? ":firefox" : "") +
        " first",
    );
  }
  const contentCandidates = [
    path.join(outputDir, "content-scripts", "content.js"),
    path.join(outputDir, "content-scripts", "content.ts.js"),
  ];
  const contentPath = contentCandidates.find((candidate) =>
    fs.existsSync(candidate),
  );
  return {
    ...meta,
    outputDir: meta.outputDir.replace(/\\/g, "/"),
    manifestSha256: sha256File(manifestPath),
    contentScriptSha256: contentPath ? sha256File(contentPath) : undefined,
  };
}

function assertValidRunId(runId) {
  if (!runId?.trim()) {
    throw new Error("runId is required");
  }
  const trimmed = runId.trim();
  if (
    trimmed.includes("..") ||
    trimmed.includes("/") ||
    trimmed.includes("\\")
  ) {
    throw new Error("runId must be a single path segment");
  }
  return trimmed;
}

/** Create a run directory and results.json skeleton / 実行用ディレクトリと results.json のひな型を作る。 */
export function initRealSiteRun(repositoryRoot, options = {}) {
  const browserKey = options.browser ?? "chrome";
  const actor = options.actor ?? "agent";
  if (actor !== "agent" && actor !== "human") {
    throw new Error(`actor must be agent|human (got ${actor})`);
  }
  const build = resolveBuild(repositoryRoot, browserKey);
  const runId = assertValidRunId(
    options.runId?.trim() || defaultRunId(browserKey),
  );

  const runDirectory = path.join(
    repositoryRoot,
    ".harness-artifacts",
    "real-site",
    runId,
  );
  fs.mkdirSync(path.join(runDirectory, "evidence"), { recursive: true });

  const results = {
    schemaVersion: 1,
    runId,
    startedAt: new Date().toISOString(),
    actor,
    environment: "live-site",
    browser: {
      product: build.product,
    },
    build: {
      target: build.target,
      outputDir: build.outputDir,
      manifestSha256: build.manifestSha256,
      ...(build.contentScriptSha256
        ? { contentScriptSha256: build.contentScriptSha256 }
        : {}),
    },
    loginState: "unknown",
    notes:
      "Fill items after observe→act→verify. Do not record chat bodies or credentials. Form check is not product pass.",
    items: [
      {
        id: "YL-1",
        status: "not-run",
        reason: "Initialized; not executed yet",
      },
    ],
  };

  const resultsPath = path.join(runDirectory, "results.json");
  if (fs.existsSync(resultsPath) && !options.force) {
    throw new Error(
      `results.json already exists for ${runId}; pass force:true to overwrite`,
    );
  }
  fs.writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
  fs.writeFileSync(
    path.join(runDirectory, "build.json"),
    `${JSON.stringify(
      {
        runId,
        capturedAt: results.startedAt,
        build: results.build,
      },
      null,
      2,
    )}\n`,
  );

  return { runId, runDirectory, resultsPath, results };
}

/** Stamp finishedAt on an existing run / 既存の実行記録に終了時刻を記録する。 */
export function finalizeRealSiteRun(repositoryRoot, runId) {
  const validRunId = assertValidRunId(runId);
  const runDirectory = path.join(
    repositoryRoot,
    ".harness-artifacts",
    "real-site",
    validRunId,
  );
  const resultsPath = path.join(runDirectory, "results.json");
  if (!fs.existsSync(resultsPath)) {
    throw new Error(`missing ${resultsPath}`);
  }
  const results = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
  return { runId: validRunId, runDirectory, resultsPath, results };
}

function usage() {
  return [
    "usage:",
    "  node scripts/real-site-run.mjs init --browser=chrome|firefox [--run-id=ID] [--actor=agent|human]",
    "  node scripts/real-site-run.mjs finalize <runId>",
  ].join("\n");
}

if (isMain(import.meta.url)) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const args = parseArgs(process.argv);
  try {
    if (args.command === "init") {
      const created = initRealSiteRun(repositoryRoot, {
        browser: args.browser,
        runId: args.runId,
        actor: args.actor,
      });
      console.log(
        JSON.stringify(
          {
            status: "initialized",
            runId: created.runId,
            runDirectory: created.runDirectory,
            resultsPath: created.resultsPath,
            build: created.results.build,
          },
          null,
          2,
        ),
      );
    } else if (args.command === "finalize") {
      const finished = finalizeRealSiteRun(repositoryRoot, args.runId);
      console.log(
        JSON.stringify(
          {
            status: "finalized",
            runId: finished.runId,
            finishedAt: finished.results.finishedAt,
            resultsPath: finished.resultsPath,
          },
          null,
          2,
        ),
      );
    } else {
      console.error(usage());
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
