import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isMain, report } from "./lib/check-utils.mjs";

const configuration = JSON.parse(
  fs.readFileSync(new URL("./ci-tools.json", import.meta.url), "utf8"),
);
const root = path.resolve(import.meta.dirname, "..");

/** Compare bytes with a pinned digest; never run unverified tools / 固定ハッシュと一致するバイナリだけを実行。 */
export function verifyDigest(bytes, expected) {
  if (
    !/^[a-f0-9]{64}$/.test(expected) ||
    createHash("sha256").update(bytes).digest("hex") !== expected
  )
    throw new Error("Tool SHA-256 mismatch; refusing to execute");
}

/** Return an existing verified tool; missing tools require setup / 検証済みツールの絶対パスを返す。 */
export function toolPath(name) {
  if (
    process.platform !== configuration.platform ||
    process.arch !== configuration.arch
  )
    throw new Error(
      "CI tools currently support Windows x64 only; other platforms are not silently skipped",
    );
  const tool = configuration.tools[name];
  if (!tool) throw new Error(`Unknown tool ${name}`);
  const binary = path.join(
    root,
    ".harness-tools",
    `${name}-${tool.version}-win32-x64`,
    `${name}.exe`,
  );
  if (!fs.existsSync(binary))
    throw new Error(`${name} is missing; run pnpm tools:setup`);
  verifyDigest(fs.readFileSync(binary), tool.binarySha256);
  return binary;
}

/** Download pinned official archives and verify the extracted executables / 公式配布物と展開後exeを二重照合。 */
export async function setupTools() {
  if (
    process.platform !== configuration.platform ||
    process.arch !== configuration.arch
  )
    throw new Error("CI tools currently require Windows x64");
  for (const [name, tool] of Object.entries(configuration.tools)) {
    const directory = path.join(
      root,
      ".harness-tools",
      `${name}-${tool.version}-win32-x64`,
    );
    if (fs.existsSync(path.join(directory, `${name}.exe`))) {
      toolPath(name);
      continue;
    }
    if (
      !/^https:\/\/github\.com\/(gitleaks\/gitleaks|rhysd\/actionlint)\/releases\/download\/v[\d.]+\/[\w.]+\.zip$/.test(
        tool.url,
      )
    )
      throw new Error("Unexpected tool download URL");
    const response = await fetch(tool.url, {
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(`${name} download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    verifyDigest(bytes, tool.archiveSha256);
    fs.mkdirSync(directory, { recursive: true });
    const archive = path.join(directory, "verified.zip");
    fs.writeFileSync(archive, bytes);
    const extracted = spawnSync(
      "tar",
      ["-xf", archive, "-C", directory, `${name}.exe`],
      { encoding: "utf8", shell: false, timeout: 30000 },
    );
    if (extracted.error || extracted.status !== 0)
      throw new Error(
        `${name} extraction failed: ${extracted.error?.message ?? extracted.stderr}`,
      );
    toolPath(name);
    fs.unlinkSync(archive);
  }
}

if (isMain(import.meta.url)) {
  try {
    await setupTools();
    report("ci-tools", [], {
      versions: Object.fromEntries(
        Object.entries(configuration.tools).map(([name, tool]) => [
          name,
          tool.version,
        ]),
      ),
    });
  } catch (error) {
    report("ci-tools", [error.message]);
  }
}
