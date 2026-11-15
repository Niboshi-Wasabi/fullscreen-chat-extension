import path from "node:path";
import { spawnSync } from "node:child_process";
import { browserEnvironment } from "./setup-browser.mjs";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const browserFlag = args.find((argument) => argument.startsWith("--browser="));
const channel = browserFlag?.slice("--browser=".length) ?? "chromium";
if (!["chromium", "chrome"].includes(channel))
  throw new Error("Use --browser=chromium or --browser=chrome");
const result = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/@playwright/test/cli.js"),
    "test",
    "--config",
    "playwright.config.ts",
    ...args.filter((argument) => argument !== browserFlag),
  ],
  {
    cwd: root,
    env: { ...browserEnvironment(root), E2E_BROWSER_CHANNEL: channel },
    stdio: "inherit",
    shell: false,
  },
);
if (result.error) console.error(result.error.message);
if (result.status !== 0 || result.error) process.exitCode = 1;
