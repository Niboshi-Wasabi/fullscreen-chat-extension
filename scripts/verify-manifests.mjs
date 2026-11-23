import fs from "node:fs";
import path from "node:path";
import { isMain, report } from "./lib/check-utils.mjs";

const equalSets = (left, right) =>
  Array.isArray(left) &&
  Array.isArray(right) &&
  new Set(left).size === left.length &&
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

/** Compare one bundle to the recorded policy and existing assets / 1ビルドの比較基準と実資産を検査。 */
export function checkManifest(manifest, browser, policy, directory, version) {
  const errors = [];
  const fail = (message) => errors.push(`${browser}: ${message}`);
  if (manifest.manifest_version !== 3 || manifest.version !== version)
    fail("expected MV3 and the package.json version");
  for (const key of ["permissions", "host_permissions"])
    if (!equalSets(manifest[key], policy[key]))
      fail(
        `${key} changed; review security impact and update the recorded baseline explicitly`,
      );
  for (const key of ["optional_permissions", "optional_host_permissions"])
    if (manifest[key]?.length)
      fail(`${key} must be reviewed before introduction`);
  if (
    manifest.content_security_policy ||
    manifest.externally_connectable ||
    manifest.web_accessible_resources
  )
    fail(
      "CSP, externally_connectable or web_accessible_resources changed; review before introducing it",
    );
  const scripts = manifest.content_scripts;
  if (!Array.isArray(scripts) || scripts.length !== 1)
    fail("expected one content script configuration");
  else if (
    !equalSets(scripts[0].matches, policy.content_matches) ||
    !equalSets(scripts[0].js, policy.content_js) ||
    (scripts[0].css?.length ?? 0) !== 0 ||
    scripts[0].all_frames !== true ||
    scripts[0].run_at !== "document_idle"
  )
    fail("content script matches, entry assets, frame scope or timing changed");
  if (!Object.keys(manifest.icons ?? {}).length)
    fail("icons declaration missing");
  if (browser === "chrome") {
    if (
      manifest.background?.service_worker !== "background.js" ||
      manifest.background?.scripts
    )
      fail("expected MV3 background service worker");
  } else {
    if (
      !equalSets(manifest.background?.scripts, ["background.js"]) ||
      manifest.background?.service_worker
    )
      fail("expected Firefox background script");
    const gecko = manifest.browser_specific_settings?.gecko;
    if (
      gecko?.id !== policy.gecko.id ||
      gecko?.strict_min_version !== policy.gecko.strict_min_version ||
      !equalSets(gecko?.data_collection_permissions?.required, ["none"])
    )
      fail(
        "Firefox identity, minimum version or data-collection declaration changed",
      );
  }
  const assets = [
    manifest.background?.service_worker,
    ...(manifest.background?.scripts ?? []),
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    ...(Array.isArray(scripts) ? scripts : []).flatMap((script) => [
      ...(script.js ?? []),
      ...(script.css ?? []),
    ]),
    "privacy.html",
    ...policy.bundled_assets,
  ];
  if (
    manifest.action?.default_popup !== "popup.html" ||
    manifest.options_ui?.page !== "options.html" ||
    manifest.options_ui?.open_in_tab !== true
  )
    fail("popup/options entry point changed");
  if (policy.commands) {
    const commands = manifest.commands ?? {};
    if (!equalSets(Object.keys(commands), policy.commands.names))
      fail("manifest commands changed");
    const suggestedCount = Object.values(commands).filter(
      (entry) => entry && typeof entry === "object" && entry.suggested_key,
    ).length;
    if (suggestedCount > policy.commands.maxSuggestedKeys)
      fail("manifest commands exceeded suggested_key limit");
    for (const unmapped of policy.commands.unmapped ?? [])
      if (commands[unmapped]?.suggested_key)
        fail(`command ${unmapped} must remain unmapped by default`);
  }
  for (const asset of assets.filter(Boolean)) {
    const resolved = path.resolve(directory, asset);
    const relative = path.relative(directory, resolved);
    if (
      path.isAbsolute(relative) ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      !fs.existsSync(resolved) ||
      !fs.statSync(resolved).isFile()
    )
      fail(`missing or unsafe bundled asset ${asset}`);
  }
  return errors;
}

/** Inspect both build outputs; missing output is a failure / 両ブラウザの出力を検査し、出力がなければ失敗とする。 */
export function checkManifests(root) {
  const policy = JSON.parse(
    fs.readFileSync(
      path.join(root, "docs/quality/manifest-baseline.json"),
      "utf8",
    ),
  );
  const { version } = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const errors = [];
  for (const browser of ["chrome", "firefox"]) {
    const directory = path.join(root, ".output", `${browser}-mv3`);
    try {
      errors.push(
        ...checkManifest(
          JSON.parse(
            fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
          ),
          browser,
          policy,
          directory,
          version,
        ),
      );
    } catch (error) {
      errors.push(
        `${browser}: build output unavailable or invalid: ${error.message}`,
      );
    }
  }
  return errors;
}

if (isMain(import.meta.url)) {
  try {
    report(
      "manifests",
      checkManifests(path.resolve(import.meta.dirname, "..")),
    );
  } catch (error) {
    report("manifests", [error.message]);
  }
}
