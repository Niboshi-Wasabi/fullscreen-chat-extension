import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** List regular files without following links / リンクをたどらず通常ファイルを列挙。 */
export function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : entry.isFile() ? [target] : [];
  });
}

/** Match a script URL against the process entry point / CLIの直接実行だけを判定。 */
export function isMain(url) {
  return (
    Boolean(process.argv[1]) &&
    url === pathToFileURL(path.resolve(process.argv[1])).href
  );
}

/** Print findings and mark failures via exitCode / 結果を出力し失敗時の終了値を設定。 */
export function report(name, errors, details = {}) {
  console.log(
    JSON.stringify(
      {
        check: name,
        status: errors.length ? "failed" : "passed",
        ...details,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
}
