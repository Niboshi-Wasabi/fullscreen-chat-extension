import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  SEMVER_RE,
  checkReleasePackages,
  fetchGitHubReleases,
  parseGitHubRepo,
} from "./check-release.mjs";
import { isMain, report } from "./lib/check-utils.mjs";

/** Validate tag/branch, SemVer and main ancestry before creating or updating a Draft Release / タグ・ブランチ・SemVer・main 到達性を検証。
 * @param {{ version: string, githubRef: string, prereleaseInput?: boolean | string, headOnMain?: boolean }} context
 */
export function validateReleaseContext({
  version,
  githubRef,
  prereleaseInput = undefined,
  headOnMain = undefined,
}) {
  const errors = [];
  const rawVersion = String(version ?? "");
  const expectedTag = SEMVER_RE.test(rawVersion) ? `v${rawVersion}` : null;
  if (!expectedTag)
    errors.push(
      `package.json version must be valid SemVer (got ${JSON.stringify(version)})`,
    );

  if (!githubRef) {
    errors.push("Missing Git ref context (GITHUB_REF)");
  } else if (githubRef.startsWith("refs/tags/")) {
    const tagName = githubRef.slice("refs/tags/".length);
    if (expectedTag && tagName !== expectedTag)
      errors.push(
        `Tag ${tagName} does not match package.json version (${expectedTag})`,
      );
    if (headOnMain !== true)
      errors.push(
        "Release tag commit must be verified as reachable from origin/main",
      );
  } else if (githubRef !== "refs/heads/main") {
    errors.push(
      `Draft release must run from refs/heads/main or a matching version tag (got ${githubRef})`,
    );
  }

  let prerelease;
  if (prereleaseInput === true || prereleaseInput === "true") prerelease = true;
  else if (prereleaseInput === false || prereleaseInput === "false")
    prerelease = false;
  else prerelease = rawVersion.includes("-");

  return { expectedTag, prerelease, errors };
}

/** Decide whether to create a new Draft, update an existing Draft, or refuse modifying a published release / 既存リリース状況に応じて Draft 作成・更新・公開済み保護を判定。 */
export function planDraftReleaseAction({ existingReleases, tag }) {
  const matching = (
    Array.isArray(existingReleases) ? existingReleases : []
  ).filter((entry) => entry?.tag_name === tag);
  const published = matching.find((entry) => !entry.draft);
  if (published)
    return {
      action: "blocked",
      error: `Published GitHub Release ${tag} already exists; refusing to overwrite`,
      existing: published,
    };
  const draft = matching.find((entry) => Boolean(entry.draft));
  if (draft) return { action: "update-draft", error: null, existing: draft };
  return { action: "create-draft", error: null, existing: null };
}

/** Format Japanese release notes consistent with existing Draft releases / 既存のリリース体裁に揃えた公開用ノートを生成。 */
export function buildReleaseNotes({
  version,
  tag,
  commitSha,
  repo,
  packages,
  runUrl,
}) {
  const chrome = packages?.chrome;
  const firefox = packages?.firefox;
  const lines = [
    "YouTube と Twitch のチャットを、動画を全画面で見ながら表示できるブラウザ拡張機能です。",
    "",
    "- チャットパネル、弾幕、別窓表示に対応します。",
    "- YouTube と Twitch でライブ配信を開くと、両方のチャットを一つの表示にまとめられます。混合チャットは読み取り専用です。",
    "- 接続先のチャットは 0〜120 秒遅らせられます。映像の場面とチャットの反応を選んで、調整値の候補も出せます。",
    "",
    "## 試用方法",
    "",
    "- **Chrome** は Chrome 用 ZIP を展開し、`chrome://extensions` のデベロッパーモードで「パッケージ化されていない拡張機能を読み込む」を選びます。`manifest.json` が入っているフォルダーを指定してください。",
    "- **Firefox** は `about:debugging#/runtime/this-firefox` の「一時的なアドオンを読み込む」から Firefox 用 ZIP を指定します。Firefox を終了すると一時インストールは解除されます。",
    "",
    "このリリース候補にはストア提出用の ZIP を添付しています。ストア公開後は、通常のインストールと自動更新にストア版を利用できます。",
    "",
    "## SHA-256",
    "",
    "| ファイル | SHA-256 |",
    "| --- | --- |",
    `| \`${chrome?.fileName ?? `fullscreen-chat-extension-${version}-chrome.zip`}\` | \`${chrome?.sha256 ?? ""}\` |`,
    `| \`${firefox?.fileName ?? `fullscreen-chat-extension-${version}-firefox.zip`}\` | \`${firefox?.sha256 ?? ""}\` |`,
    "",
    `- バージョン / タグ: \`${version}\` / \`${tag}\``,
    `- 対象コミット: \`${commitSha ?? "unknown"}\``,
  ];
  if (runUrl) lines.push(`- ビルド検証実行: ${runUrl}`);
  if (repo && repo.includes("/")) {
    const [owner, name] = repo.split("/");
    lines.push(
      "",
      `[不具合報告](https://github.com/${repo}/issues) · [プライバシーポリシー](https://${owner.toLowerCase()}.github.io/${name}/)`,
    );
  }
  return lines.join("\n") + "\n";
}

/** Build gh CLI argument arrays for creating or updating a Draft Release with pinned target commit / Draft 作成・更新用 gh コマンド引数を組み立て。
 * @param {{ action: string, tag: string, repo: string, prerelease: boolean, commitSha: string, title: string, notesPath: string, assets: string[] }} spec
 * @returns {string[][]}
 */
export function buildGhReleaseCommands({
  action,
  tag,
  repo,
  prerelease,
  commitSha,
  title,
  notesPath,
  assets,
}) {
  if (action === "create-draft") {
    return [
      [
        "release",
        "create",
        tag,
        "--repo",
        repo,
        "--draft",
        ...(prerelease ? ["--prerelease"] : []),
        "--target",
        commitSha,
        "--title",
        title,
        "--notes-file",
        notesPath,
        ...assets,
      ],
    ];
  }
  if (action === "update-draft") {
    return [
      [
        "release",
        "edit",
        tag,
        "--repo",
        repo,
        "--draft",
        `--prerelease=${Boolean(prerelease)}`,
        "--target",
        commitSha,
        "--title",
        title,
        "--notes-file",
        notesPath,
      ],
      ["release", "upload", tag, "--repo", repo, "--clobber", ...assets],
    ];
  }
  throw new Error(`Unsupported draft release action: ${String(action)}`);
}

function runCommand(command, args, cwd, timeout = 120000) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout,
  });
}

function runPackOnly(root) {
  const wxtCli = path.join(root, "node_modules/wxt/bin/wxt.mjs");
  for (const args of [["zip"], ["zip", "-b", "firefox"]]) {
    const result = runCommand(
      process.execPath,
      [wxtCli, ...args],
      root,
      180000,
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error || result.status !== 0) {
      report("release-pack", [
        `wxt ${args.join(" ")} failed: ${result.error?.message ?? `exit ${result.status}`}`,
      ]);
      return false;
    }
  }
  report("release-pack", []);
  return true;
}

function resolveGitContext(root) {
  const rev = runCommand("git", ["rev-parse", "HEAD"], root, 15000);
  const commitSha = rev.status === 0 ? rev.stdout.trim() : null;
  const remote = runCommand(
    "git",
    ["remote", "get-url", "origin"],
    root,
    15000,
  );
  const repo = remote.status === 0 ? parseGitHubRepo(remote.stdout) : null;
  const sym = runCommand("git", ["symbolic-ref", "-q", "HEAD"], root, 15000);
  const githubRef =
    process.env.GITHUB_REF || (sym.status === 0 ? sym.stdout.trim() : "");

  const candidates =
    process.env.GITHUB_ACTIONS === "true"
      ? ["origin/main"]
      : ["origin/main", "main"];
  let mainRef = null;
  for (const candidate of candidates) {
    const check = runCommand(
      "git",
      ["rev-parse", "--verify", "--quiet", candidate],
      root,
      15000,
    );
    if (check.status === 0) {
      mainRef = candidate;
      break;
    }
  }
  let headOnMain;
  if (mainRef) {
    const ancestor = runCommand(
      "git",
      ["merge-base", "--is-ancestor", "HEAD", mainRef],
      root,
      15000,
    );
    headOnMain = ancestor.status === 0;
  }
  return { commitSha, repo, githubRef, headOnMain };
}

if (isMain(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, "..");
  if (process.argv.includes("--pack-only")) {
    runPackOnly(root);
  } else {
    const dryRun = process.argv.includes("--dry-run");
    const { version } = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    );
    const git = resolveGitContext(root);
    const context = validateReleaseContext({
      version,
      githubRef: git.githubRef,
      prereleaseInput: process.env.RELEASE_PRERELEASE,
      headOnMain: git.headOnMain,
    });
    const nonMainRefError =
      git.githubRef.startsWith("refs/heads/") &&
      git.githubRef !== "refs/heads/main"
        ? `Draft release must run from refs/heads/main or a matching version tag (got ${git.githubRef})`
        : null;
    const localNonMainPreview =
      dryRun && !process.env.GITHUB_REF && Boolean(nonMainRefError);
    const contextWarnings = [];
    const errors = [];
    for (const err of context.errors) {
      if (localNonMainPreview && err === nonMainRefError)
        contextWarnings.push(err);
      else errors.push(err);
    }

    const pkgCheck = checkReleasePackages(root, {
      requirePackages: true,
      writeChecksums: true,
    });
    errors.push(...pkgCheck.errors);
    if (!git.repo)
      errors.push("Cannot determine GitHub repository from origin remote");
    if (!git.commitSha) errors.push("Cannot resolve current Git HEAD SHA");

    let plan = null;
    let notesPath = null;
    if (errors.length === 0) {
      const { releases, error } = fetchGitHubReleases(git.repo, root);
      if (error) {
        errors.push(error);
      } else if (releases) {
        plan = planDraftReleaseAction({
          existingReleases: releases,
          tag: context.expectedTag,
        });
        if (plan.error) errors.push(plan.error);
      }
    }

    if (errors.length === 0 && plan) {
      const runUrl =
        process.env.GITHUB_SERVER_URL &&
        process.env.GITHUB_REPOSITORY &&
        process.env.GITHUB_RUN_ID
          ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : null;
      const notes = buildReleaseNotes({
        version: pkgCheck.version,
        tag: context.expectedTag,
        commitSha: git.commitSha,
        repo: git.repo,
        packages: pkgCheck.packages,
        runUrl,
      });
      notesPath = path.join(
        root,
        ".harness-artifacts",
        `release-notes-${context.expectedTag}.md`,
      );
      fs.mkdirSync(path.dirname(notesPath), { recursive: true });
      fs.writeFileSync(notesPath, notes, "utf8");

      if (!dryRun) {
        const chromeZip = path.join(root, pkgCheck.packages.chrome.path);
        const firefoxZip = path.join(root, pkgCheck.packages.firefox.path);
        const checksums = path.join(root, pkgCheck.sha256SumsPath);
        const title = `Fullscreen Chat Extension ${pkgCheck.version}`;
        const ghCommands = buildGhReleaseCommands({
          action: plan.action,
          tag: context.expectedTag,
          repo: git.repo,
          prerelease: context.prerelease,
          commitSha: git.commitSha,
          title,
          notesPath,
          assets: [chromeZip, firefoxZip, checksums],
        });
        for (const args of ghCommands) {
          const result = runCommand("gh", args, root, 120000);
          if (result.stdout) process.stdout.write(result.stdout);
          if (result.stderr) process.stderr.write(result.stderr);
          if (result.error || result.status !== 0) {
            errors.push(
              `gh ${args.slice(0, 2).join(" ")} failed: ${result.error?.message ?? `exit ${result.status}`}`,
            );
            break;
          }
        }
      }
    }

    report("release-draft", errors, {
      dryRun,
      action: plan?.action ?? null,
      tag: context.expectedTag,
      prerelease: context.prerelease,
      commitSha: git.commitSha,
      notesPath: notesPath
        ? path.relative(root, notesPath).replace(/\\/g, "/")
        : null,
      sha256SumsPath: pkgCheck.sha256SumsPath,
      contextWarnings,
    });
  }
}
