import { describe, expect, it } from "vitest";
import { resolveFirefoxBinary } from "../../scripts/lib/firefox-bidi.mjs";
import { runFirefoxSynthetic } from "../../scripts/run-firefox-synthetic.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("firefox synthetic harness helpers", () => {
  it("resolves the installed Firefox binary on this machine", () => {
    const binary = resolveFirefoxBinary();
    expect(fs.existsSync(binary)).toBe(true);
  });

  it("fails clearly when the Firefox build output is missing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fce-ff-missing-"));
    try {
      await expect(runFirefoxSynthetic(root)).rejects.toThrow(
        /Missing \.output\/firefox-mv3\/manifest\.json/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
