import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { checkManifest } from "./verify-manifests.mjs";
import { isMain, report } from "./lib/check-utils.mjs";

export const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ZIP_PACKAGE_TEMPLATE = (version, browser) =>
  `fullscreen-chat-extension-${version}-${browser}.zip`;

function normalizeZipPath(rawName) {
  if (!rawName || rawName.includes("\0"))
    throw new Error(`Invalid ZIP entry name: ${JSON.stringify(rawName)}`);
  if (
    rawName.startsWith("/") ||
    rawName.startsWith("\\") ||
    /^[A-Za-z]:/.test(rawName)
  )
    throw new Error(`Unsafe absolute ZIP entry path: ${rawName}`);
  const normalized = rawName.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.includes(".."))
    throw new Error(`Unsafe parent traversal in ZIP entry: ${rawName}`);
  return normalized;
}

/** Parse ZIP central directory and validate entry paths without spawning external unzip tools / 外部展開ツールを使わず ZIP 中央ディレクトリとパスの安全性を検証。 */
export function readZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22)
    throw new Error("Invalid ZIP archive: buffer too small");
  const minOffset = Math.max(0, buffer.length - (65536 + 22));
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0)
    throw new Error("Invalid ZIP archive: end of central directory not found");

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const cdDisk = buffer.readUInt16LE(eocdOffset + 6);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0 ||
    cdDisk !== 0 ||
    totalEntries === 0xffff ||
    cdOffset === 0xffffffff ||
    cdSize === 0xffffffff ||
    cdOffset + cdSize > eocdOffset
  )
    throw new Error("Unsupported or corrupt ZIP central directory layout");

  const entries = [];
  let cursor = cdOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > cdOffset + cdSize)
      throw new Error("Truncated ZIP central directory entry");
    if (buffer.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error("Invalid ZIP central directory signature");

    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const nextCursor = cursor + 46 + nameLength + extraLength + commentLength;
    if (nextCursor > cdOffset + cdSize)
      throw new Error("Truncated ZIP entry metadata");

    const rawName = buffer.toString(
      "utf8",
      cursor + 46,
      cursor + 46 + nameLength,
    );
    const name = normalizeZipPath(rawName);
    entries.push({
      name,
      isDirectory: name.endsWith("/"),
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    cursor = nextCursor;
  }
  return entries;
}

/** Extract a single stored (0) or deflated (8) ZIP entry after verifying local header bounds / Stored・Deflate 方式の ZIP エントリを境界検証付きで展開。 */
export function extractZipEntry(buffer, entry) {
  if (!entry || typeof entry.localHeaderOffset !== "number")
    throw new Error("Missing ZIP entry descriptor");
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50)
    throw new Error(`Invalid local file header for ${entry.name}`);

  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length)
    throw new Error(`Truncated payload for ZIP entry ${entry.name}`);

  const payload = buffer.subarray(dataStart, dataEnd);
  let extracted;
  if (entry.compressionMethod === 0) extracted = Buffer.from(payload);
  else if (entry.compressionMethod === 8) extracted = inflateRawSync(payload);
  else
    throw new Error(
      `Unsupported ZIP compression method ${entry.compressionMethod} for ${entry.name}`,
    );
  if (extracted.length !== entry.uncompressedSize)
    throw new Error(`ZIP uncompressed size mismatch for ${entry.name}`);
  return extracted;
}

/** Parse owner/repo from a GitHub HTTPS or SSH remote URL / GitHub リモート URL から owner/repo を抽出。 */
export function parseGitHubRepo(remoteUrl) {
  const match = String(remoteUrl ?? "")
    .trim()
    .match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i);
  return match ? match[1] : null;
}

/** Extract filename -> sha256 pairs from Markdown tables or SHA256SUMS lines in release notes / リリースノートからファイル別の SHA-256 を抽出。 */
export function parseReleaseChecksums(body) {
  const text = String(body ?? "");
  const checksums = {};
  for (const match of text.matchAll(
    /\|\s*`?([A-Za-z0-9._-]+)`?\s*\|\s*`?([a-f0-9]{64})`?\s*\|/gi,
  ))
    checksums[match[1]] = match[2].toLowerCase();
  for (const match of text.matchAll(
    /^([a-f0-9]{64})\s+\*?([A-Za-z0-9._-]+)$/gim,
  ))
    checksums[match[2]] = match[1].toLowerCase();
  return checksums;
}

/** Format deterministic SHA256SUMS lines sorted by filename / ファイル名昇順の SHA256SUMS 形式を生成。 */
export function formatSha256Sums(packages) {
  const list = Array.isArray(packages) ? packages : Object.values(packages);
  return (
    list
      .filter((entry) => entry?.fileName && entry?.sha256)
      .slice()
      .sort((a, b) =>
        a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
      )
      .map((entry) => `${entry.sha256.toLowerCase()}  ${entry.fileName}`)
      .join("\n") + "\n"
  );
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJson(value[key])]),
    );
  return value;
}

/** Verify built Chrome and Firefox release ZIP archives against manifest policy and optionally emit SHA256SUMS / ZIP 成果物の manifest・同梱資産・ビルド一致を検証。
 * @param {string} root
 * @param {{ requirePackages?: boolean, writeChecksums?: boolean }} [options]
 * @returns {{ version: string, expectedTag: string | null, packages: Record<"chrome" | "firefox", { status: string, fileName: string, path: string, size: number | null, sha256: string | null, entryCount: number } | undefined>, sha256SumsPath: string | null, errors: string[] }}
 */
export function checkReleasePackages(
  root,
  { requirePackages = false, writeChecksums = false } = {},
) {
  const errors = [];
  const { version } = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    return {
      version: String(version ?? ""),
      expectedTag: null,
      packages: { chrome: undefined, firefox: undefined },
      sha256SumsPath: null,
      errors: [
        `package.json version must be valid SemVer (got ${JSON.stringify(version)})`,
      ],
    };
  }
  const expectedTag = `v${version}`;
  const policy = JSON.parse(
    fs.readFileSync(
      path.join(root, "docs/quality/manifest-baseline.json"),
      "utf8",
    ),
  );
  /** @type {Record<"chrome" | "firefox", any>} */
  const packages = { chrome: undefined, firefox: undefined };

  for (const browser of ["chrome", "firefox"]) {
    const fileName = ZIP_PACKAGE_TEMPLATE(version, browser);
    const zipPath = path.join(root, ".output", fileName);
    if (!fs.existsSync(zipPath)) {
      packages[browser] = {
        status: "missing",
        fileName,
        path: path.relative(root, zipPath).replace(/\\/g, "/"),
        size: null,
        sha256: null,
        entryCount: 0,
      };
      if (requirePackages)
        errors.push(
          `${browser}: release package is missing (${packages[browser].path})`,
        );
      continue;
    }

    const bytes = fs.readFileSync(zipPath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    let entries;
    try {
      entries = readZipEntries(bytes);
    } catch (error) {
      errors.push(
        `${browser}: invalid ZIP archive ${fileName}: ${error.message}`,
      );
      packages[browser] = {
        status: "failed",
        fileName,
        path: path.relative(root, zipPath).replace(/\\/g, "/"),
        size: bytes.length,
        sha256,
        entryCount: 0,
      };
      continue;
    }

    const fileEntries = entries.filter((entry) => !entry.isDirectory);
    const entryMap = new Map(fileEntries.map((entry) => [entry.name, entry]));
    const manifestEntry = entryMap.get("manifest.json");
    if (!manifestEntry) {
      errors.push(`${browser}: manifest.json missing inside ${fileName}`);
      packages[browser] = {
        status: "failed",
        fileName,
        path: path.relative(root, zipPath).replace(/\\/g, "/"),
        size: bytes.length,
        sha256,
        entryCount: fileEntries.length,
      };
      continue;
    }

    let zipManifest;
    try {
      zipManifest = JSON.parse(
        extractZipEntry(bytes, manifestEntry).toString("utf8"),
      );
      if (
        !zipManifest ||
        typeof zipManifest !== "object" ||
        Array.isArray(zipManifest)
      )
        throw new Error("manifest.json must be a JSON object");
    } catch (error) {
      errors.push(
        `${browser}: invalid manifest.json inside ${fileName}: ${error.message}`,
      );
      packages[browser] = {
        status: "failed",
        fileName,
        path: path.relative(root, zipPath).replace(/\\/g, "/"),
        size: bytes.length,
        sha256,
        entryCount: fileEntries.length,
      };
      continue;
    }

    const manifestErrors = checkManifest(
      zipManifest,
      browser,
      policy,
      ".",
      version,
      (asset) => entryMap.has(asset),
    );
    errors.push(...manifestErrors);

    const buildManifestPath = path.join(
      root,
      ".output",
      `${browser}-mv3`,
      "manifest.json",
    );
    let buildMismatch = false;
    if (fs.existsSync(buildManifestPath)) {
      try {
        const buildManifest = JSON.parse(
          fs.readFileSync(buildManifestPath, "utf8"),
        );
        if (
          !buildManifest ||
          typeof buildManifest !== "object" ||
          Array.isArray(buildManifest)
        )
          throw new Error("manifest.json must be a JSON object");
        if (
          JSON.stringify(stableJson(zipManifest)) !==
          JSON.stringify(stableJson(buildManifest))
        ) {
          buildMismatch = true;
          errors.push(
            `${browser}: ZIP manifest.json differs from .output/${browser}-mv3/manifest.json`,
          );
        }
      } catch (error) {
        buildMismatch = true;
        errors.push(
          `${browser}: invalid .output/${browser}-mv3/manifest.json: ${error.message}`,
        );
      }
    }

    packages[browser] = {
      status:
        manifestErrors.length === 0 && !buildMismatch ? "passed" : "failed",
      fileName,
      path: path.relative(root, zipPath).replace(/\\/g, "/"),
      size: bytes.length,
      sha256,
      entryCount: fileEntries.length,
    };
  }

  let sha256SumsPath = null;
  const bothValid =
    errors.length === 0 &&
    packages.chrome?.status === "passed" &&
    packages.firefox?.status === "passed";
  if (writeChecksums && bothValid) {
    const outFile = path.join(root, ".output", "SHA256SUMS.txt");
    fs.writeFileSync(
      outFile,
      formatSha256Sums([packages.chrome, packages.firefox]),
      "utf8",
    );
    sha256SumsPath = path.relative(root, outFile).replace(/\\/g, "/");
  }

  return {
    version,
    expectedTag,
    packages,
    sha256SumsPath,
    errors,
  };
}

function latestTimestamp(release) {
  const candidates = [
    ...(Array.isArray(release?.assets)
      ? release.assets.map((asset) => asset?.updated_at)
      : []),
    release?.updated_at,
    release?.created_at,
  ]
    .filter(Boolean)
    .map((value) => ({ raw: value, ms: Date.parse(value) }))
    .filter((entry) => Number.isFinite(entry.ms));
  candidates.sort((a, b) => b.ms - a.ms);
  return candidates[0]?.raw ?? null;
}

/** Compare main branch state and local packages against GitHub Releases (published and Draft) / GitHub Release と main ブランチの乖離を分類。 */
export function evaluateReleaseDrift({
  version,
  expectedTag,
  headSha,
  mainCommitDate,
  commitsSincePublishedTag,
  packages,
  releases,
}) {
  const list = Array.isArray(releases) ? releases : [];
  const published = list
    .filter((entry) => !entry.draft)
    .slice()
    .sort(
      (a, b) =>
        Date.parse(b.published_at ?? b.created_at ?? 0) -
        Date.parse(a.published_at ?? a.created_at ?? 0),
    );
  const drafts = list
    .filter((entry) => Boolean(entry.draft))
    .slice()
    .sort(
      (a, b) =>
        Date.parse(b.updated_at ?? b.created_at ?? 0) -
        Date.parse(a.updated_at ?? a.created_at ?? 0),
    );

  const latestPublished = published[0] ?? null;
  const draftRelease =
    drafts.find((entry) => entry.tag_name === expectedTag) ?? drafts[0] ?? null;
  const warnings = [];

  if (!latestPublished && !draftRelease) {
    warnings.push("No published or draft GitHub Release exists yet");
    return {
      status: "no-release",
      expectedTag,
      headSha: headSha ?? null,
      mainCommitDate: mainCommitDate ?? null,
      commitsSincePublishedTag: null,
      publishedTag: null,
      draftTag: null,
      draftTimestamp: null,
      missingAssets: [],
      draftChecksumMismatch: false,
      warnings,
    };
  }

  const publishedTag = latestPublished?.tag_name ?? null;
  const publishedVersionMatch = publishedTag === expectedTag;
  if (latestPublished && !publishedVersionMatch)
    warnings.push(
      `Latest published release tag (${publishedTag}) differs from package.json (${expectedTag})`,
    );
  if (
    typeof commitsSincePublishedTag === "number" &&
    commitsSincePublishedTag > 0
  )
    warnings.push(
      `origin/main has ${commitsSincePublishedTag} commit(s) after published tag ${publishedTag}`,
    );
  if (latestPublished && commitsSincePublishedTag === null)
    warnings.push(
      `Cannot count commits since published tag ${publishedTag} (run git fetch --tags or check origin/main)`,
    );

  let missingAssets = [];
  let draftTimestamp = null;
  let draftStale = false;
  let draftChecksumMismatch = false;

  if (draftRelease) {
    draftTimestamp = latestTimestamp(draftRelease);
    const assetNames = new Set(
      (draftRelease.assets ?? []).map((asset) => asset?.name).filter(Boolean),
    );
    const requiredZips = [
      ZIP_PACKAGE_TEMPLATE(version, "chrome"),
      ZIP_PACKAGE_TEMPLATE(version, "firefox"),
    ];
    missingAssets = requiredZips.filter((name) => !assetNames.has(name));
    if (missingAssets.length) {
      draftStale = true;
      warnings.push(
        `Draft release ${draftRelease.tag_name ?? "(untagged)"} is missing ZIP asset(s): ${missingAssets.join(", ")}`,
      );
    }
    if (draftRelease.tag_name !== expectedTag) {
      draftStale = true;
      warnings.push(
        `Draft release tag (${draftRelease.tag_name ?? "(none)"}) differs from expected tag ${expectedTag}`,
      );
    }
    const mainMs = mainCommitDate ? Date.parse(mainCommitDate) : NaN;
    const draftMs = draftTimestamp ? Date.parse(draftTimestamp) : NaN;
    if (
      Number.isFinite(mainMs) &&
      Number.isFinite(draftMs) &&
      mainMs > draftMs
    ) {
      draftStale = true;
      warnings.push(
        `main (${mainCommitDate}) has newer commits than Draft release (${draftTimestamp})`,
      );
    }

    const bodyChecksums = parseReleaseChecksums(draftRelease.body ?? "");
    const hasChecksums = Object.keys(bodyChecksums).length > 0;
    for (const browser of ["chrome", "firefox"]) {
      const pkg = packages?.[browser];
      if (!pkg?.sha256) continue;
      const recorded = bodyChecksums[pkg.fileName];
      if (
        (recorded && recorded !== pkg.sha256.toLowerCase()) ||
        (hasChecksums && !recorded)
      ) {
        draftChecksumMismatch = true;
        draftStale = true;
        warnings.push(
          `Local ${pkg.fileName} SHA-256 does not match Draft release notes`,
        );
      }
    }
  }

  let status;
  if (!latestPublished) {
    status = draftStale ? "draft-stale" : "draft-only";
  } else if (draftRelease && draftStale) {
    status = "draft-stale";
  } else if (
    !publishedVersionMatch ||
    (typeof commitsSincePublishedTag === "number" &&
      commitsSincePublishedTag > 0)
  ) {
    status = "drift";
  } else if (commitsSincePublishedTag === null) {
    status = "unknown";
  } else {
    status = "up-to-date";
  }

  return {
    status,
    expectedTag,
    headSha: headSha ?? null,
    mainCommitDate: mainCommitDate ?? null,
    commitsSincePublishedTag:
      typeof commitsSincePublishedTag === "number"
        ? commitsSincePublishedTag
        : null,
    publishedTag,
    draftTag: draftRelease?.tag_name ?? null,
    draftTimestamp,
    missingAssets,
    draftChecksumMismatch,
    warnings,
  };
}

function runCommand(command, args, cwd, timeout = 15000) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout,
  });
}

/** Fetch all GitHub Releases with pagination via gh api / gh api --paginate --slurp で全リリースを取得。 */
export function fetchGitHubReleases(repo, root) {
  const api = runCommand(
    "gh",
    ["api", "--paginate", "--slurp", `repos/${repo}/releases?per_page=100`],
    root,
    30000,
  );
  if (api.error || api.status !== 0)
    return {
      releases: null,
      error: `Failed to query GitHub releases via gh: ${api.error?.message ?? api.stderr?.trim() ?? "unknown error"}`,
    };
  try {
    const parsed = JSON.parse(api.stdout);
    if (!Array.isArray(parsed))
      return {
        releases: null,
        error: "Unexpected non-array releases payload",
      };
    const releases = parsed.every((entry) => Array.isArray(entry))
      ? parsed.flat()
      : parsed;
    return { releases, error: null };
  } catch (error) {
    return {
      releases: null,
      error: `Invalid GitHub releases response: ${error.message}`,
    };
  }
}

function readGitState(root) {
  const rev = runCommand("git", ["rev-parse", "HEAD"], root);
  const headSha = rev.status === 0 ? rev.stdout.trim() : null;
  const br = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], root);
  const branch = br.status === 0 ? br.stdout.trim() : null;
  const remote = runCommand("git", ["remote", "get-url", "origin"], root);
  const repo = remote.status === 0 ? parseGitHubRepo(remote.stdout) : null;

  let mainRef = null;
  for (const candidate of ["origin/main", "main", "HEAD"]) {
    const check = runCommand(
      "git",
      ["rev-parse", "--verify", "--quiet", candidate],
      root,
    );
    if (check.status === 0) {
      mainRef = candidate;
      break;
    }
  }
  const dateResult = mainRef
    ? runCommand("git", ["log", "-1", "--format=%cI", mainRef], root)
    : null;
  const mainCommitDate =
    dateResult?.status === 0 ? dateResult.stdout.trim() : null;
  return { headSha, branch, repo, mainRef, mainCommitDate };
}

if (isMain(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  const requirePackages = process.argv.includes("--require-packages");
  const writeChecksums = process.argv.includes("--write-checksums");
  const checkRemote = process.argv.includes("--remote");
  const failOnDrift = process.argv.includes("--fail-on-drift");

  const pkgCheck = checkReleasePackages(root, {
    requirePackages,
    writeChecksums,
  });
  const errors = [...pkgCheck.errors];
  const gitState = readGitState(root);
  let drift = null;

  if (checkRemote) {
    if (!gitState.repo) {
      errors.push("Cannot determine GitHub repository from origin remote");
    } else {
      const { releases, error } = fetchGitHubReleases(gitState.repo, root);
      if (error) {
        errors.push(error);
      } else if (releases) {
        const published = releases
          .filter((entry) => !entry.draft)
          .slice()
          .sort(
            (a, b) =>
              Date.parse(b.published_at ?? b.created_at ?? 0) -
              Date.parse(a.published_at ?? a.created_at ?? 0),
          )[0];
        let commitsSincePublishedTag = null;
        if (published?.tag_name) {
          if (gitState.mainRef) {
            const count = runCommand(
              "git",
              [
                "rev-list",
                "--count",
                `${published.tag_name}..${gitState.mainRef}`,
              ],
              root,
            );
            if (count.status === 0 && /^\d+$/.test(count.stdout.trim()))
              commitsSincePublishedTag = Number.parseInt(
                count.stdout.trim(),
                10,
              );
          }
          if (commitsSincePublishedTag === null) {
            const compare = runCommand(
              "gh",
              [
                "api",
                `repos/${gitState.repo}/compare/${encodeURIComponent(published.tag_name)}...main`,
                "--jq",
                ".ahead_by",
              ],
              root,
              15000,
            );
            if (compare.status === 0 && /^\d+$/.test(compare.stdout.trim()))
              commitsSincePublishedTag = Number.parseInt(
                compare.stdout.trim(),
                10,
              );
          }
        }
        drift = evaluateReleaseDrift({
          version: pkgCheck.version,
          expectedTag: pkgCheck.expectedTag,
          headSha: gitState.headSha,
          mainCommitDate: gitState.mainCommitDate,
          commitsSincePublishedTag,
          packages: pkgCheck.packages,
          releases,
        });
        if (failOnDrift && drift.status !== "up-to-date")
          errors.push(
            `GitHub Release drift detected (${drift.status}): ${drift.warnings.join("; ")}`,
          );
      }
    }
  }

  const output = {
    version: pkgCheck.version,
    expectedTag: pkgCheck.expectedTag,
    git: gitState,
    packages: pkgCheck.packages,
    sha256SumsPath: pkgCheck.sha256SumsPath,
    drift,
    timestamp: new Date().toISOString(),
  };
  const destination = path.join(root, ".harness-artifacts/release-status.json");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(
    destination,
    JSON.stringify({ passed: errors.length === 0, ...output, errors }, null, 2),
  );
  report("release", errors, output);
}
