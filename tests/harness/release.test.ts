import fs from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkReleasePackages,
  evaluateReleaseDrift,
  extractZipEntry,
  formatSha256Sums,
  parseGitHubRepo,
  parseReleaseChecksums,
  readZipEntries,
} from "../../scripts/check-release.mjs";
import {
  buildGhReleaseCommands,
  buildReleaseNotes,
  planDraftReleaseAction,
  validateReleaseContext,
} from "../../scripts/publish-draft-release.mjs";

const repository = path.resolve(import.meta.dirname, "../..");
const artifacts = path.join(repository, ".harness-artifacts");
const baseline = JSON.parse(
  fs.readFileSync(
    path.join(repository, "docs/quality/manifest-baseline.json"),
    "utf8",
  ),
);
const temporary: string[] = [];

afterEach(() => {
  for (const root of temporary.splice(0)) {
    if (path.dirname(path.resolve(root)) !== artifacts)
      throw new Error("Unsafe fixture cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function buildTestZip(
  entries: Array<{ name: string; content: string | Buffer }>,
  { method = 8 } = {},
) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const { name, content } of entries) {
    const raw = Buffer.isBuffer(content)
      ? content
      : Buffer.from(content, "utf8");
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = method === 0 ? raw : deflateRawSync(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);

    localChunks.push(localHeader, nameBytes, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localChunks, centralDirectory, eocd]);
}

function validManifest(browser: "chrome" | "firefox", version = "0.1.0") {
  const commands = Object.fromEntries(
    baseline.commands.names.map((name: string) => [
      name,
      baseline.commands.unmapped.includes(name)
        ? { description: name }
        : { suggested_key: { default: "Alt+Shift+C" }, description: name },
    ]),
  );
  const base = {
    manifest_version: 3,
    name: "Fullscreen Chat Extension",
    version,
    icons: { "16": "icon/16.png" },
    permissions: [...baseline.permissions],
    host_permissions: [...baseline.host_permissions],
    action: {
      default_popup: "popup.html",
      default_icon: { "16": "icon/16.png" },
    },
    options_ui: { page: "options.html", open_in_tab: true },
    content_scripts: [
      {
        matches: [...baseline.content_matches],
        all_frames: true,
        run_at: "document_idle",
        js: [...baseline.content_js],
      },
    ],
    commands,
  };
  if (browser === "chrome")
    return { ...base, background: { service_worker: "background.js" } };
  return {
    ...base,
    background: { scripts: ["background.js"] },
    browser_specific_settings: {
      gecko: {
        id: baseline.gecko.id,
        strict_min_version: baseline.gecko.strict_min_version,
        data_collection_permissions: { required: ["none"] },
      },
    },
  };
}

function validBundleEntries(manifestObj: Record<string, unknown>) {
  return [
    { name: "manifest.json", content: JSON.stringify(manifestObj, null, 2) },
    { name: "background.js", content: "console.log('bg');" },
    { name: "icon/16.png", content: "png" },
    { name: "popup.html", content: "<html></html>" },
    { name: "options.html", content: "<html></html>" },
    { name: "privacy.html", content: "<html></html>" },
    ...baseline.content_js.map((file: string) => ({
      name: file,
      content: "content",
    })),
    ...baseline.bundled_assets.map((file: string) => ({
      name: file,
      content: "asset",
    })),
  ];
}

function createFixtureWorkspace() {
  fs.mkdirSync(artifacts, { recursive: true });
  const root = fs.mkdtempSync(path.join(artifacts, "release-fixture-"));
  temporary.push(root);
  fs.mkdirSync(path.join(root, "docs/quality"), { recursive: true });
  fs.mkdirSync(path.join(root, ".output"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fullscreen-chat-extension", version: "0.1.0" }),
  );
  fs.writeFileSync(
    path.join(root, "docs/quality/manifest-baseline.json"),
    JSON.stringify(baseline),
  );
  return root;
}

describe("release ZIP reader and package validation", () => {
  it("reads both stored and deflated entries and rejects path traversal", () => {
    const storedZip = buildTestZip(
      [{ name: "hello.txt", content: "stored-ok" }],
      { method: 0 },
    );
    const storedEntries = readZipEntries(storedZip);
    expect(extractZipEntry(storedZip, storedEntries[0]).toString("utf8")).toBe(
      "stored-ok",
    );

    const deflatedZip = buildTestZip(
      [{ name: "manifest.json", content: '{"ok":true}' }],
      { method: 8 },
    );
    const deflatedEntries = readZipEntries(deflatedZip);
    expect(
      extractZipEntry(deflatedZip, deflatedEntries[0]).toString("utf8"),
    ).toBe('{"ok":true}');

    for (const unsafeName of [
      "../evil.txt",
      "/abs.txt",
      "\\winabs.txt",
      "C:\\drive.txt",
      "a\0b",
      "dir\\..\\evil.txt",
    ])
      expect(() =>
        readZipEntries(buildTestZip([{ name: unsafeName, content: "bad" }])),
      ).toThrow();

    const sizeTampered = Buffer.from(
      buildTestZip([{ name: "ok.txt", content: "1234" }], { method: 0 }),
    );
    const cdSizeOffset = sizeTampered.indexOf(
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
    );
    sizeTampered.writeUInt32LE(99, cdSizeOffset + 24);
    const tamperedEntry = readZipEntries(sizeTampered)[0];
    expect(() => extractZipEntry(sizeTampered, tamperedEntry)).toThrow(
      "size mismatch",
    );
  });

  it("validates matching Chrome and Firefox release ZIPs and writes SHA256SUMS", () => {
    const root = createFixtureWorkspace();
    const chromeManifest = validManifest("chrome");
    const firefoxManifest = validManifest("firefox");

    fs.mkdirSync(path.join(root, ".output/chrome-mv3"), { recursive: true });
    fs.mkdirSync(path.join(root, ".output/firefox-mv3"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".output/chrome-mv3/manifest.json"),
      JSON.stringify(chromeManifest),
    );
    fs.writeFileSync(
      path.join(root, ".output/firefox-mv3/manifest.json"),
      JSON.stringify(firefoxManifest),
    );

    fs.writeFileSync(
      path.join(root, ".output/fullscreen-chat-extension-0.1.0-chrome.zip"),
      buildTestZip(validBundleEntries(chromeManifest), { method: 8 }),
    );
    fs.writeFileSync(
      path.join(root, ".output/fullscreen-chat-extension-0.1.0-firefox.zip"),
      buildTestZip(validBundleEntries(firefoxManifest), { method: 0 }),
    );

    const result = checkReleasePackages(root, {
      requirePackages: true,
      writeChecksums: true,
    });
    expect(result.errors).toEqual([]);
    expect(result.packages.chrome?.status).toBe("passed");
    expect(result.packages.firefox?.status).toBe("passed");
    expect(result.sha256SumsPath).toBe(".output/SHA256SUMS.txt");

    const sums = fs.readFileSync(
      path.join(root, ".output/SHA256SUMS.txt"),
      "utf8",
    );
    expect(sums).toBe(
      formatSha256Sums([result.packages.chrome!, result.packages.firefox!]),
    );
  });

  it("rejects version mismatch, widened permissions, missing assets and build drift", () => {
    const root = createFixtureWorkspace();
    const badChrome = validManifest("chrome", "0.2.0");
    badChrome.host_permissions.push("<all_urls>");
    const chromeEntries = validBundleEntries(badChrome).filter(
      (entry) => entry.name !== "privacy.html",
    );
    fs.writeFileSync(
      path.join(root, ".output/fullscreen-chat-extension-0.1.0-chrome.zip"),
      buildTestZip(chromeEntries),
    );

    const firefoxManifest = validManifest("firefox");
    fs.mkdirSync(path.join(root, ".output/firefox-mv3"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".output/firefox-mv3/manifest.json"),
      JSON.stringify({ ...firefoxManifest, description: "changed-build" }),
    );
    fs.writeFileSync(
      path.join(root, ".output/fullscreen-chat-extension-0.1.0-firefox.zip"),
      buildTestZip(validBundleEntries(firefoxManifest)),
    );

    const result = checkReleasePackages(root, {
      requirePackages: true,
      writeChecksums: true,
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "chrome: expected MV3 and the package.json version",
        ),
        expect.stringContaining("chrome: host_permissions changed"),
        expect.stringContaining(
          "chrome: missing or unsafe bundled asset privacy.html",
        ),
        expect.stringContaining("firefox: ZIP manifest.json differs"),
      ]),
    );
    expect(result.sha256SumsPath).toBeNull();
  });

  it("reports errors instead of throwing on missing ZIPs or non-object/corrupt manifests", () => {
    const missingRoot = createFixtureWorkspace();
    const missingResult = checkReleasePackages(missingRoot, {
      requirePackages: true,
    });
    expect(missingResult.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("chrome: release package is missing"),
        expect.stringContaining("firefox: release package is missing"),
      ]),
    );

    const corruptRoot = createFixtureWorkspace();
    fs.writeFileSync(
      path.join(
        corruptRoot,
        ".output/fullscreen-chat-extension-0.1.0-chrome.zip",
      ),
      buildTestZip([{ name: "manifest.json", content: "null" }]),
    );
    const firefoxManifest = validManifest("firefox");
    fs.mkdirSync(path.join(corruptRoot, ".output/firefox-mv3"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(corruptRoot, ".output/firefox-mv3/manifest.json"),
      "{not-json",
    );
    fs.writeFileSync(
      path.join(
        corruptRoot,
        ".output/fullscreen-chat-extension-0.1.0-firefox.zip",
      ),
      buildTestZip(validBundleEntries(firefoxManifest)),
    );
    const corruptResult = checkReleasePackages(corruptRoot, {
      requirePackages: true,
    });
    expect(corruptResult.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("JSON object"),
        expect.stringContaining("invalid .output/firefox-mv3/manifest.json"),
      ]),
    );
  });
});

describe("release parsing and drift detection", () => {
  it("parses GitHub repo slugs and checksums from release notes", () => {
    expect(
      parseGitHubRepo(
        "https://github.com/Niboshi-Wasabi/fullscreen-chat-extension.git",
      ),
    ).toBe("Niboshi-Wasabi/fullscreen-chat-extension");
    expect(
      parseGitHubRepo(
        "git@github.com:Niboshi-Wasabi/fullscreen-chat-extension.git",
      ),
    ).toBe("Niboshi-Wasabi/fullscreen-chat-extension");

    const chromeHash = "a".repeat(64);
    const firefoxHash = "b".repeat(64);
    const notes = `
| ファイル | SHA-256 |
| --- | --- |
| \`fullscreen-chat-extension-0.1.0-chrome.zip\` | \`${chromeHash}\` |
${firefoxHash}  fullscreen-chat-extension-0.1.0-firefox.zip
`;
    expect(parseReleaseChecksums(notes)).toEqual({
      "fullscreen-chat-extension-0.1.0-chrome.zip": chromeHash,
      "fullscreen-chat-extension-0.1.0-firefox.zip": firefoxHash,
    });
  });

  it("classifies all five GitHub Release drift states accurately", () => {
    const baseInput = {
      version: "0.1.0",
      expectedTag: "v0.1.0",
      headSha: "6d2794f409db600a8de65dd8b1bc67d4e1556564",
      mainCommitDate: "2026-11-23T15:50:08Z",
      commitsSincePublishedTag: 0,
      packages: {
        chrome: {
          fileName: "fullscreen-chat-extension-0.1.0-chrome.zip",
          sha256: "a".repeat(64),
        },
        firefox: {
          fileName: "fullscreen-chat-extension-0.1.0-firefox.zip",
          sha256: "b".repeat(64),
        },
      },
    };
    const matchingBody = `| \`fullscreen-chat-extension-0.1.0-chrome.zip\` | \`${"a".repeat(64)}\` |\n| \`fullscreen-chat-extension-0.1.0-firefox.zip\` | \`${"b".repeat(64)}\` |`;
    const draftAssets = [
      {
        name: "fullscreen-chat-extension-0.1.0-chrome.zip",
        updated_at: "2026-11-23T15:55:00Z",
      },
      {
        name: "fullscreen-chat-extension-0.1.0-firefox.zip",
        updated_at: "2026-11-23T15:55:00Z",
      },
    ];

    expect(evaluateReleaseDrift({ ...baseInput, releases: [] }).status).toBe(
      "no-release",
    );

    expect(
      evaluateReleaseDrift({
        ...baseInput,
        releases: [
          {
            tag_name: "v0.1.0",
            draft: false,
            published_at: "2026-11-23T15:55:00Z",
          },
        ],
      }).status,
    ).toBe("up-to-date");

    expect(
      evaluateReleaseDrift({
        ...baseInput,
        commitsSincePublishedTag: 2,
        releases: [
          {
            tag_name: "v0.1.0",
            draft: false,
            published_at: "2026-11-23T15:00:00Z",
          },
        ],
      }).status,
    ).toBe("drift");

    expect(
      evaluateReleaseDrift({
        ...baseInput,
        releases: [
          {
            tag_name: "v0.1.0",
            draft: true,
            created_at: "2026-11-23T15:55:00Z",
            assets: draftAssets,
            body: matchingBody,
          },
        ],
      }).status,
    ).toBe("draft-only");

    const staleByTime = evaluateReleaseDrift({
      ...baseInput,
      releases: [
        {
          tag_name: "v0.1.0",
          draft: true,
          created_at: "2026-11-23T15:08:50Z",
          assets: [
            {
              name: "fullscreen-chat-extension-0.1.0-chrome.zip",
              updated_at: "2026-11-23T15:08:50Z",
            },
            {
              name: "fullscreen-chat-extension-0.1.0-firefox.zip",
              updated_at: "2026-11-23T15:08:50Z",
            },
          ],
          body: matchingBody,
        },
      ],
    });
    expect(staleByTime.status).toBe("draft-stale");
    expect(staleByTime.warnings).toContainEqual(
      expect.stringContaining("newer commits than Draft release"),
    );

    const staleByHash = evaluateReleaseDrift({
      ...baseInput,
      releases: [
        {
          tag_name: "v0.1.0",
          draft: true,
          created_at: "2026-11-23T15:55:00Z",
          assets: draftAssets,
          body: matchingBody.replace("a".repeat(64), "c".repeat(64)),
        },
      ],
    });
    expect(staleByHash.status).toBe("draft-stale");
    expect(staleByHash.draftChecksumMismatch).toBe(true);

    const unknownState = evaluateReleaseDrift({
      ...baseInput,
      commitsSincePublishedTag: null,
      releases: [
        {
          tag_name: "v0.1.0",
          draft: false,
          published_at: "2026-11-23T15:55:00Z",
        },
      ],
    });
    expect(unknownState.status).toBe("unknown");
    expect(unknownState.warnings).toContainEqual(
      expect.stringContaining("Cannot count commits since published tag"),
    );
  });
});

describe("draft release safety guards", () => {
  it("validates tag/version matching, main ancestry and feature branch refusal", () => {
    expect(
      validateReleaseContext({
        version: "0.1.0",
        githubRef: "refs/tags/v0.1.0",
        prereleaseInput: "",
        headOnMain: true,
      }),
    ).toEqual({ expectedTag: "v0.1.0", prerelease: false, errors: [] });

    expect(
      validateReleaseContext({
        version: "0.2.0-rc.1",
        githubRef: "refs/heads/main",
        prereleaseInput: undefined,
        headOnMain: true,
      }),
    ).toEqual({ expectedTag: "v0.2.0-rc.1", prerelease: true, errors: [] });

    const mismatch = validateReleaseContext({
      version: "0.1.0",
      githubRef: "refs/tags/v0.2.0",
      headOnMain: false,
    });
    expect(mismatch.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("does not match package.json version"),
        expect.stringContaining("reachable from origin/main"),
      ]),
    );

    const unverifiedAncestry = validateReleaseContext({
      version: "0.1.0",
      githubRef: "refs/tags/v0.1.0",
      headOnMain: undefined,
    });
    expect(unverifiedAncestry.errors).toContainEqual(
      expect.stringContaining("reachable from origin/main"),
    );

    const featureBranch = validateReleaseContext({
      version: "0.1.0",
      githubRef: "refs/heads/feature/release-harness",
    });
    expect(featureBranch.errors).toContainEqual(
      expect.stringContaining("must run from refs/heads/main"),
    );
  });

  it("always keeps --draft and --target on both create-draft and update-draft commands", () => {
    const createCmds = buildGhReleaseCommands({
      action: "create-draft",
      tag: "v0.1.0",
      repo: "Niboshi-Wasabi/fullscreen-chat-extension",
      prerelease: true,
      commitSha: "6d2794f409db600a8de65dd8b1bc67d4e1556564",
      title: "Fullscreen Chat Extension 0.1.0",
      notesPath: ".harness-artifacts/release-notes-v0.1.0.md",
      assets: ["chrome.zip", "firefox.zip", "SHA256SUMS.txt"],
    });
    expect(createCmds).toHaveLength(1);
    expect(createCmds[0]).toEqual(
      expect.arrayContaining([
        "create",
        "--draft",
        "--prerelease",
        "--target",
        "6d2794f409db600a8de65dd8b1bc67d4e1556564",
      ]),
    );

    const updateCmds = buildGhReleaseCommands({
      action: "update-draft",
      tag: "v0.1.0",
      repo: "Niboshi-Wasabi/fullscreen-chat-extension",
      prerelease: false,
      commitSha: "6d2794f409db600a8de65dd8b1bc67d4e1556564",
      title: "Fullscreen Chat Extension 0.1.0",
      notesPath: ".harness-artifacts/release-notes-v0.1.0.md",
      assets: ["chrome.zip", "firefox.zip", "SHA256SUMS.txt"],
    });
    expect(updateCmds).toHaveLength(2);
    expect(updateCmds[0]).toEqual(
      expect.arrayContaining([
        "edit",
        "--draft",
        "--prerelease=false",
        "--target",
        "6d2794f409db600a8de65dd8b1bc67d4e1556564",
      ]),
    );
    expect(updateCmds.flat()).not.toContain("--draft=false");
    expect(updateCmds[1]).toEqual(
      expect.arrayContaining(["upload", "--clobber"]),
    );
  });

  it("refuses overwriting published releases and selects create or update for Drafts", () => {
    expect(
      planDraftReleaseAction({
        existingReleases: [{ tag_name: "v0.1.0", draft: false }],
        tag: "v0.1.0",
      }),
    ).toMatchObject({
      action: "blocked",
      error: expect.stringContaining("refusing to overwrite"),
    });

    expect(
      planDraftReleaseAction({
        existingReleases: [{ tag_name: "v0.1.0", draft: true }],
        tag: "v0.1.0",
      }),
    ).toMatchObject({ action: "update-draft", error: null });

    expect(
      planDraftReleaseAction({ existingReleases: [], tag: "v0.1.0" }),
    ).toMatchObject({ action: "create-draft", error: null });
  });

  it("generates release notes with ZIP SHA-256 digests and commit metadata", () => {
    const notes = buildReleaseNotes({
      version: "0.1.0",
      tag: "v0.1.0",
      commitSha: "6d2794f",
      repo: "Niboshi-Wasabi/fullscreen-chat-extension",
      packages: {
        chrome: {
          fileName: "fullscreen-chat-extension-0.1.0-chrome.zip",
          sha256: "a".repeat(64),
        },
        firefox: {
          fileName: "fullscreen-chat-extension-0.1.0-firefox.zip",
          sha256: "b".repeat(64),
        },
      },
      runUrl:
        "https://github.com/Niboshi-Wasabi/fullscreen-chat-extension/actions/runs/1",
    });
    expect(notes).toContain("fullscreen-chat-extension-0.1.0-chrome.zip");
    expect(notes).toContain("a".repeat(64));
    expect(notes).toContain("6d2794f");
    expect(notes).toContain(
      "niboshi-wasabi.github.io/fullscreen-chat-extension/",
    );
  });
});
