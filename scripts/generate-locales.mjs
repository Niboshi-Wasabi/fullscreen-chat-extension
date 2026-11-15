/**
 * Writes remaining locale JSON files. Source of truth for keys: en.json
 * Usage: node scripts/generate-locales.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "../src/shared/i18n/locales");
const en = JSON.parse(fs.readFileSync(path.join(outDir, "en.json"), "utf8"));
const keys = Object.keys(en);

const packsDir = path.join(__dirname, "locale-packs");
const packFiles = fs.existsSync(packsDir)
  ? fs.readdirSync(packsDir).filter((name) => name.endsWith(".json"))
  : [];

let written = 0;
for (const file of packFiles) {
  const code = file.replace(/\.json$/, "");
  const rows = JSON.parse(fs.readFileSync(path.join(packsDir, file), "utf8"));
  const missing = keys.filter(
    (key) => typeof rows[key] !== "string" || !rows[key],
  );
  if (missing.length) {
    throw new Error(`${code} missing/empty: ${missing.join(", ")}`);
  }
  const ordered = Object.fromEntries(keys.map((key) => [key, rows[key]]));
  fs.writeFileSync(
    path.join(outDir, `${code}.json`),
    `${JSON.stringify(ordered, null, 2)}\n`,
    "utf8",
  );
  written += 1;
  console.log("wrote", code);
}

// Validate all locale files against en keys
const localeFiles = fs
  .readdirSync(outDir)
  .filter((name) => name.endsWith(".json"));
for (const file of localeFiles) {
  const rows = JSON.parse(fs.readFileSync(path.join(outDir, file), "utf8"));
  const missing = keys.filter((key) => !(key in rows));
  const extra = Object.keys(rows).filter((key) => !keys.includes(key));
  if (missing.length || extra.length) {
    console.error(file, { missing, extra });
    process.exitCode = 1;
  }
}

console.log(
  `packs applied=${written}; locale files=${localeFiles.length}; keys=${keys.length}`,
);
