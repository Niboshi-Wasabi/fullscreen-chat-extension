/**
 * Builds complete locale JSON for all AppLocales from embedded catalogs.
 * node scripts/build-all-locales.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "src/shared/i18n/locales");
const en = JSON.parse(fs.readFileSync(path.join(outDir, "en.json"), "utf8"));
const keys = Object.keys(en);

/** Load extra catalogs from scripts/locale-catalogs/*.mjs default exports */
const catalogDir = path.join(root, "scripts/locale-catalogs");
fs.mkdirSync(catalogDir, { recursive: true });

const catalogs = {};
for (const file of fs.readdirSync(catalogDir)) {
  if (!file.endsWith(".mjs")) continue;
  // pathToFileURL — Windows ESM import needs file:// / Windows の ESM import は file:// が必要
  const mod = await import(pathToFileURL(path.join(catalogDir, file)).href);
  Object.assign(catalogs, mod.default ?? mod.catalogs ?? {});
}

// Keep already-authored JSON locales in outDir as catalogs too
for (const file of fs.readdirSync(outDir)) {
  if (!file.endsWith(".json") || file === "en.json") continue;
  const code = file.replace(/\.json$/, "");
  if (!catalogs[code]) {
    catalogs[code] = JSON.parse(
      fs.readFileSync(path.join(outDir, file), "utf8"),
    );
  }
}

let ok = 0;
const failures = [];
for (const [code, rows] of Object.entries(catalogs)) {
  const missing = keys.filter(
    (k) => typeof rows[k] !== "string" || rows[k].length === 0,
  );
  if (missing.length) {
    failures.push(`${code}: ${missing.join(",")}`);
    continue;
  }
  const ordered = Object.fromEntries(keys.map((k) => [k, rows[k]]));
  fs.writeFileSync(
    path.join(outDir, `${code}.json`),
    JSON.stringify(ordered, null, 2) + "\n",
  );
  ok += 1;
}

console.log(
  JSON.stringify(
    {
      ok,
      failures,
      totalKeys: keys.length,
      locales: Object.keys(catalogs).sort(),
    },
    null,
    2,
  ),
);
if (failures.length) process.exit(1);
