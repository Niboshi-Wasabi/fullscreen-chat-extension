import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const en = JSON.parse(
  fs.readFileSync(path.join(root, "src/shared/i18n/locales/en.json"), "utf8"),
);
const keys = Object.keys(en);

/**
 * Each array MUST follow en.json key order exactly (79 entries).
 * @type {Record<string, string[]>}
 */
const ROWS = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "rows.json"), "utf8"),
);

/** @type {Record<string, Record<string, string>>} */
const catalogs = {};
for (const [code, values] of Object.entries(ROWS)) {
  if (values.length !== keys.length) {
    throw new Error(`${code}: expected ${keys.length} values, got ${values.length}`);
  }
  catalogs[code] = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
}

export default catalogs;
