import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib/check-utils.mjs";
import {
  closeTab,
  evaluate,
  launchFirefoxBidi,
  navigate,
  newTab,
  until,
} from "./lib/firefox-bidi.mjs";

const FIXTURE_URL = "https://www.youtube.com/watch?v=harness-fixture";

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")
    .toUpperCase();
}

function parseArgs(argv) {
  const tokens = argv.slice(2).filter((value) => value !== "--");
  const args = { headless: true, firefoxBinary: null };
  for (let i = 0; i < tokens.length; i += 1) {
    const value = tokens[i];
    if (value === "--headed") args.headless = false;
    else if (value === "--firefox" && tokens[i + 1])
      args.firefoxBinary = tokens[++i];
    else if (value.startsWith("--firefox="))
      args.firefoxBinary = value.slice("--firefox=".length);
  }
  return args;
}

function htmlResponse(body) {
  return {
    statusCode: 200,
    reasonPhrase: "OK",
    headers: [
      {
        name: "Content-Type",
        value: { type: "string", value: "text/html; charset=utf-8" },
      },
    ],
    body: { type: "base64", value: Buffer.from(body).toString("base64") },
  };
}

/** Minimal permanent Firefox synthetic regression / Firefox 向けの最小限の合成回帰テスト一式。 */
export async function runFirefoxSynthetic(repositoryRoot, options = {}) {
  const artifactsDir = path.join(
    repositoryRoot,
    ".harness-artifacts",
    "firefox-synthetic",
  );
  fs.mkdirSync(artifactsDir, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(artifactsDir, "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });

  const extensionPath = path.join(repositoryRoot, ".output", "firefox-mv3");
  const manifestPath = path.join(extensionPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      "Missing .output/firefox-mv3/manifest.json; run pnpm.cmd build:firefox first",
    );
  }

  const fixtureHtml = fs.readFileSync(
    path.join(repositoryRoot, "tests/fixtures/youtube-live.html"),
    "utf8",
  );
  const liveChatHtml = `<!doctype html><html><body><div id="items"><yt-live-chat-text-message-renderer id="first"><span id="author-name">Fixture viewer</span><span id="message">Synthetic hello message</span></yt-live-chat-text-message-renderer><yt-live-chat-text-message-renderer id="blocked"><span id="author-name">Fixture viewer</span><span id="message">Synthetic blocked marker</span></yt-live-chat-text-message-renderer></div></body></html>`;

  const summary = {
    schemaVersion: 1,
    environment: "synthetic",
    actor: "automatic",
    startedAt: new Date().toISOString(),
    runId,
    browser: null,
    build: {
      target: "firefox-mv3",
      outputDir: ".output/firefox-mv3",
      manifestSha256: sha256File(manifestPath),
    },
    mode: "installed Firefox / WebDriver BiDi / dedicated temp profile",
    results: [],
    blockedRequests: [],
    protocolErrors: [],
    logs: [],
  };

  const writeSummary = () => {
    fs.writeFileSync(
      path.join(runDir, "results.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  };

  let session;
  let control;

  const check = async (name, action) => {
    const started = Date.now();
    const logStart = session?.getBrowserLog().length ?? 0;
    try {
      const details = await action();
      summary.results.push({
        name,
        status: "passed",
        durationMs: Date.now() - started,
        details,
      });
      console.log(`PASS ${name}`);
    } catch (error) {
      summary.results.push({
        name,
        status: "failed",
        durationMs: Date.now() - started,
        error: error.stack ?? String(error),
      });
      console.log(`FAIL ${name}: ${error.message}`);
    }
    const warnings = (session?.getBrowserLog().slice(logStart) ?? "")
      .split("\n")
      .filter((line) =>
        /Script terminated|JavaScript (error|warning)|Handler function threw/.test(
          line,
        ),
      );
    summary.results.at(-1).browserWarnings = warnings;
    writeSummary();
  };

  const patchSettings = async (settings, operation = "patch") => {
    const result = await evaluate(
      session,
      control,
      `browser.runtime.sendMessage(${JSON.stringify({
        type: "fce:settings-write",
        operation,
        settings,
      })})`,
    );
    assert.equal(result?.ok, true, "settings write must succeed");
    return result.settings;
  };

  const resetSettings = () =>
    patchSettings(
      {
        uiLocale: "en",
        enabled: true,
        displayMode: "panel",
        panel: { useNativeChat: false },
        compose: { enabled: false },
        twitch: { thirdPartyEmotes: false },
        filter: { ngWords: ["blocked marker"] },
      },
      "replace",
    );

  try {
    session = await launchFirefoxBidi({
      artifactsDir,
      firefoxBinary: options.firefoxBinary,
      headless: options.headless !== false,
    });

    session.on("network.beforeRequestSent", async (params) => {
      if (!params.isBlocked) return;
      const request = params.request.request;
      const url = params.request.url;
      try {
        if (url === FIXTURE_URL) {
          await session.send("network.provideResponse", {
            request,
            ...htmlResponse(fixtureHtml),
          });
          return;
        }
        if (url.startsWith("https://www.youtube.com/live_chat?")) {
          await session.send("network.provideResponse", {
            request,
            ...htmlResponse(liveChatHtml),
          });
          return;
        }
        if (/^(moz-extension:|data:|about:)/.test(url)) {
          await session.send("network.continueRequest", { request });
          return;
        }
        summary.blockedRequests.push({ url, context: params.context });
        await session.send("network.failRequest", { request });
      } catch (error) {
        summary.protocolErrors.push(error.message);
      }
    });
    session.on("log.entryAdded", (params) => {
      summary.logs.push(params);
    });

    const created = await session.send("session.new", { capabilities: {} });
    summary.browser = {
      product: "firefox",
      version: created.capabilities?.browserVersion,
      userAgent: created.capabilities?.userAgent,
      capabilities: created.capabilities,
    };

    await session.send("session.subscribe", {
      events: ["log.entryAdded", "network.beforeRequestSent"],
    });
    await session.send("network.addIntercept", {
      phases: ["beforeRequestSent"],
    });

    await check("temporary extension install", async () => {
      const install = await session.send("webExtension.install", {
        extensionData: { type: "path", path: extensionPath },
      });
      summary.install = install;
      control = (await session.send("browsingContext.getTree")).contexts[0]
        .context;
      await navigate(
        session,
        control,
        `${session.mozExtensionBase}/popup.html`,
      );
      await until(
        session,
        control,
        'document.documentElement.lang === "en" || document.querySelector("#enabled")',
      );
      const settings = await resetSettings();
      const apis = await evaluate(
        session,
        control,
        `({
          session: !!browser.storage.session,
          windows: !!browser.windows,
          enabled: (await browser.storage.local.get("settings")).settings.enabled
        })`,
      );
      assert.equal(apis.windows, true);
      assert.equal(apis.session, true);
      assert.equal(apis.enabled, true);
      assert.equal(settings.enabled, true);
      return { extension: install.extension, apis };
    });

    if (
      !control ||
      summary.results.some((result) => result.status !== "passed")
    ) {
      throw new Error("Firefox install/setup failed; skipping content checks");
    }

    await check("synthetic YouTube live receive", async () => {
      await resetSettings();
      const tab = await newTab(session, FIXTURE_URL);
      try {
        await until(
          session,
          tab,
          'document.querySelector(".fce-panel-list")?.textContent.includes("Synthetic hello message")',
        );
        const blockedVisible = await evaluate(
          session,
          tab,
          'document.querySelector(".fce-panel-list").textContent.includes("Synthetic blocked marker")',
        );
        assert.equal(blockedVisible, false);
        const { data } = await session.send(
          "browsingContext.captureScreenshot",
          {
            context: tab,
            origin: "viewport",
            format: { type: "image/png" },
          },
        );
        fs.writeFileSync(
          path.join(runDir, "synthetic-receive.png"),
          Buffer.from(data, "base64"),
        );
        return { received: true, ngFiltered: true };
      } finally {
        await closeTab(session, tab);
      }
    });

    await check("extension OFF then ON", async () => {
      await resetSettings();
      const tab = await newTab(session, FIXTURE_URL);
      try {
        await until(
          session,
          tab,
          '!!document.querySelector("#fce-overlay-panel-host")',
        );
        await patchSettings({ enabled: false });
        await until(
          session,
          tab,
          'document.querySelectorAll("#fce-overlay-panel-host").length === 0',
        );
        await patchSettings({ enabled: true });
        await until(
          session,
          tab,
          'document.querySelector(".fce-panel-list")?.textContent.includes("Synthetic hello message")',
        );
        return { disabled: true, reenabled: true };
      } finally {
        await closeTab(session, tab);
      }
    });
  } catch (error) {
    summary.fatal = error.stack ?? String(error);
    console.error(error);
  } finally {
    summary.warningsBeforeShutdown = (session?.getBrowserLog() ?? "")
      .split("\n")
      .filter((line) =>
        /Script terminated|JavaScript (error|warning)|Handler function threw|can't access property "id", context is null|ContentPrefs|RunListener/.test(
          line,
        ),
      );
    summary.productErrors = summary.logs.filter(
      (entry) => entry.level === "error" && entry.type === "javascript",
    );
    if (session) {
      fs.writeFileSync(
        path.join(runDir, "browser.log"),
        session.getBrowserLog(),
      );
      await session.close();
    }
    summary.finishedAt = new Date().toISOString();
    const failedChecks = summary.results.filter(
      (result) => result.status !== "passed",
    );
    summary.passed =
      !summary.fatal &&
      failedChecks.length === 0 &&
      summary.protocolErrors.length === 0 &&
      summary.productErrors.length === 0 &&
      summary.results.length > 0;
    // Teardown warnings (ISS-015 class) do not flip functional pass by themselves.
    summary.status = summary.passed
      ? summary.warningsBeforeShutdown.length
        ? "functional-checks-passed-with-teardown-warnings"
        : "passed"
      : "failed";
    writeSummary();
    fs.writeFileSync(
      path.join(artifactsDir, "latest.json"),
      `${JSON.stringify(
        {
          runId,
          runDir: path.relative(repositoryRoot, runDir).replace(/\\/g, "/"),
          status: summary.status,
          passed: summary.passed,
          checks: summary.results.length,
          failed: failedChecks.map((result) => result.name),
        },
        null,
        2,
      )}\n`,
    );
  }

  return summary;
}

if (isMain(import.meta.url)) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const args = parseArgs(process.argv);
  try {
    const summary = await runFirefoxSynthetic(repositoryRoot, args);
    console.log(
      JSON.stringify(
        {
          passed: summary.passed,
          status: summary.status,
          checks: summary.results.length,
          failed: summary.results
            .filter((result) => result.status !== "passed")
            .map((result) => result.name),
          blocked: summary.blockedRequests.length,
          protocolErrors: summary.protocolErrors,
          productErrors: summary.productErrors.length,
          warnings: summary.warningsBeforeShutdown?.length ?? 0,
          note: "Synthetic Firefox only; not live-site or CI gate.",
        },
        null,
        2,
      ),
    );
    if (!summary.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message ?? error);
    process.exitCode = 1;
  }
}
