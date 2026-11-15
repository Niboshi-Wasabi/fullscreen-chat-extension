import path from "node:path";
import { spawnSync } from "node:child_process";
import { isMain, report } from "./lib/check-utils.mjs";

/** Keep the pinned Playwright browser inside this project / 固定版ブラウザを専用領域へ準備する。 */
export function browserEnvironment(root) {
  return {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: path.join(root, ".harness-tools/playwright"),
  };
}

if (isMain(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/@playwright/test/cli.js"),
      "install",
      "chromium",
      "--no-shell",
    ],
    {
      cwd: root,
      env: browserEnvironment(root),
      stdio: "inherit",
      shell: false,
    },
  );
  report(
    "browser-setup",
    result.status === 0 && !result.error
      ? []
      : [
          result.error?.message ??
            `Playwright install failed (${result.status})`,
        ],
  );
}
