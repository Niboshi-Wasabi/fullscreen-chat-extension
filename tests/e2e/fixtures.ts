import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Worker } from "@playwright/test";
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
} from "../../src/shared/settings";

const root = path.resolve(import.meta.dirname, "../..");
const fixtureHtml = fs.readFileSync(
  path.join(root, "tests/fixtures/youtube-comments.html"),
  "utf8",
);
export const fixtureUrl = "https://www.youtube.com/watch?v=harness-fixture";

declare const chrome: {
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(values: Record<string, unknown>): Promise<void>;
      clear(): Promise<void>;
    };
  };
};

/** Exercise real extension storage, not a fake browser API / 実際の拡張storageへ設定を書き込む。 */
export async function setSettings(
  worker: Worker,
  patch: Partial<ExtensionSettings>,
) {
  await worker.evaluate(async (change) => {
    const current = (await chrome.storage.local.get("settings"))
      .settings as ExtensionSettings;
    await chrome.storage.local.set({ settings: { ...current, ...change } });
  }, patch);
}

export async function readSettings(worker: Worker): Promise<ExtensionSettings> {
  return worker.evaluate(
    async () =>
      (await chrome.storage.local.get("settings"))
        .settings as ExtensionSettings,
  );
}

export const test = base.extend<{
  extensionId: string;
  extensionWorker: Worker;
}>({
  context: async ({ playwright }, use, testInfo) => {
    const profiles = path.join(root, ".harness-artifacts/e2e-profiles");
    fs.mkdirSync(profiles, { recursive: true });
    const profile = fs.mkdtempSync(path.join(profiles, "profile-"));
    const channel = process.env.E2E_BROWSER_CHANNEL ?? "chromium";
    if (channel !== "chromium" && channel !== "chrome")
      throw new Error("Unsupported browser channel");
    const context = await playwright.chromium
      .launchPersistentContext(profile, {
        channel,
        headless: true,
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
        colorScheme: "light",
        ignoreDefaultArgs:
          channel === "chrome" ? ["--disable-extensions"] : undefined,
        args:
          channel === "chrome"
            ? ["--enable-unsafe-extension-debugging"]
            : [
                `--disable-extensions-except=${path.join(root, ".output/chrome-mv3")}`,
                `--load-extension=${path.join(root, ".output/chrome-mv3")}`,
              ],
      })
      .catch((error: Error) => {
        fs.mkdirSync(testInfo.outputDir, { recursive: true });
        fs.writeFileSync(
          testInfo.outputPath("launch-error.json"),
          JSON.stringify(
            {
              stage: "launch",
              error: error.message,
              platform: process.platform,
              node: process.version,
            },
            null,
            2,
          ),
        );
        if (path.dirname(path.resolve(profile)) !== profiles)
          throw new Error("Unsafe profile cleanup path");
        fs.rmSync(profile, { recursive: true, force: true });
        throw error;
      });
    const consoleEvents: { level: string; text: string; url: string }[] = [];
    const pageErrors: string[] = [];
    const blockedRequests: string[] = [];
    const observe = (page: import("@playwright/test").Page) => {
      page.on("console", (message) =>
        consoleEvents.push({
          level: message.type(),
          text: message.text(),
          url: page.url(),
        }),
      );
      page.on("pageerror", (error) => pageErrors.push(error.message));
    };
    context.on("page", observe);
    context.pages().forEach(observe);
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      if (url === fixtureUrl)
        return route.fulfill({ contentType: "text/html", body: fixtureHtml });
      if (/^(chrome-extension:|data:|blob:|about:)/.test(url))
        return route.continue();
      blockedRequests.push(url);
      return route.abort("blockedbyclient");
    });
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
    try {
      if (channel === "chrome") {
        const browser = context.browser();
        if (!browser)
          throw new Error("Browser-level CDP session is unavailable");
        const session = await browser.newBrowserCDPSession();
        await session.send("Extensions.loadUnpacked", {
          path: path.join(root, ".output/chrome-mv3"),
        });
        await session.detach();
      }
      await use(context);
    } finally {
      const observations = [];
      for (const page of context.pages().filter((entry) => !entry.isClosed())) {
        try {
          observations.push(
            await page.evaluate(() => ({
              url: location.href,
              userAgent: navigator.userAgent,
              hardwareConcurrency: navigator.hardwareConcurrency,
              timeOrigin: performance.timeOrigin,
              observedAtMs: performance.now(),
              elementCount: document.querySelectorAll("*").length,
            })),
          );
        } catch (error) {
          pageErrors.push(`Observation failed: ${String(error)}`);
        }
      }
      const failed =
        testInfo.status !== testInfo.expectedStatus ||
        pageErrors.length > 0 ||
        blockedRequests.length > 0;
      if (failed) {
        for (const [index, page] of context.pages().entries()) {
          if (!page.isClosed()) {
            try {
              await page.screenshot({
                path: testInfo.outputPath(`failure-${index}.png`),
                fullPage: true,
              });
            } catch (error) {
              pageErrors.push(`Screenshot failed: ${String(error)}`);
            }
          }
        }
      }
      const trace = testInfo.outputPath("trace.zip");
      await context.tracing.stop(failed ? { path: trace } : {});
      if (failed)
        await testInfo.attach("trace", {
          path: trace,
          contentType: "application/zip",
        });
      const diagnostic = testInfo.outputPath("diagnostics.json");
      fs.writeFileSync(
        diagnostic,
        JSON.stringify(
          {
            channel,
            browser: context.browser()?.version(),
            node: process.version,
            platform: process.platform,
            observations,
            consoleEvents,
            pageErrors,
            blockedRequests,
          },
          null,
          2,
        ),
      );
      await testInfo.attach("diagnostics", {
        path: diagnostic,
        contentType: "application/json",
      });
      await context.close();
      if (path.dirname(path.resolve(profile)) !== profiles)
        throw new Error("Unsafe profile cleanup path");
      fs.rmSync(profile, { recursive: true, force: true });
      expect(
        pageErrors,
        "No unhandled page errors in the synthetic environment",
      ).toEqual([]);
      expect(
        blockedRequests,
        "Tests must not attempt external communication",
      ).toEqual([]);
    }
  },
  extensionWorker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    await worker.evaluate(() => chrome.storage.local.clear());
    await worker.evaluate(
      (settings) =>
        chrome.storage.local.set({
          settings,
          [["fce", "DanmakuDefaultsV2"].join("")]: true,
        }),
      {
        ...structuredClone(DEFAULT_SETTINGS),
        uiLocale: "en",
        panel: { ...DEFAULT_SETTINGS.panel, useNativeChat: false },
        compose: { ...DEFAULT_SETTINGS.compose, enabled: false },
        twitch: { ...DEFAULT_SETTINGS.twitch, thirdPartyEmotes: false },
      },
    );
    await use(worker);
  },
  extensionId: async ({ extensionWorker }, use) => {
    const id = new URL(extensionWorker.url()).host;
    expect(id).toMatch(/^[a-p]{32}$/);
    await use(id);
  },
  page: async ({ context, extensionId }, use) => {
    expect(extensionId).toBeTruthy();
    const page = await context.newPage();
    await use(page);
  },
});

export { expect };
