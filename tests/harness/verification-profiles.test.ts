import { describe, expect, it } from "vitest";
import { selectSteps } from "../../scripts/verify.mjs";

describe("verification profiles", () => {
  it("requires pinned browser E2E and full-history security checks in CI", () => {
    const checks = selectSteps({ ci: true });
    expect(checks).toContainEqual([
      "browser-setup",
      "scripts/setup-browser.mjs",
    ]);
    expect(checks).toContainEqual([
      "browser-e2e",
      "scripts/run-e2e.mjs",
      "--browser=chromium",
    ]);
    expect(checks).toContainEqual([
      "secrets",
      "scripts/check-secrets.mjs",
      "--require-history",
    ]);
    expect(checks.findIndex(([name]) => name === "chrome-build")).toBeLessThan(
      checks.findIndex(([name]) => name === "browser-e2e"),
    );
  });
  it("allows an explicit installed-Chrome diagnostic run without claiming a pinned-browser run", () => {
    const checks = selectSteps({ browser: "chrome" });
    expect(checks).toContainEqual([
      "browser-e2e",
      "scripts/run-e2e.mjs",
      "--browser=chrome",
    ]);
    expect(checks.some(([name]) => name === "browser-setup")).toBe(false);
  });
  it("rejects modes that could silently replace the CI gate", () => {
    expect(() => selectSteps({ ci: true, securityOnly: true })).toThrow(
      "cannot replace",
    );
    expect(() => selectSteps({ ci: true, browser: "chrome" })).toThrow(
      "pinned Chromium",
    );
  });
});
