import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { walk, isMain, report } from "./lib/check-utils.mjs";

function withoutCode(text) {
  return text
    .replace(/^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$/gm, "")
    .replace(/`[^`\n]*`/g, "");
}

/** Read authored docs and metadata; return actionable errors / 文書とメタデータを読み込み、修正が必要な箇所を返す。 */
export function checkDocumentation(root) {
  const errors = [];
  const entries = ["AGENTS.md", "README.md", "docs/index.md"];
  for (const entry of entries)
    if (!fs.existsSync(path.join(root, entry)))
      errors.push(`${entry}: required entry point is missing`);
  const files = [
    ...new Set([
      ...entries
        .map((entry) => path.join(root, entry))
        .filter((file) => fs.existsSync(file)),
      ...["docs", ".agents/skills", ".cursor/rules", ".github"]
        .flatMap((directory) => walk(path.join(root, directory)))
        .filter((file) => /\.(md|mdc)$/.test(file)),
    ]),
  ];
  let links = 0;
  let skills = 0;
  for (const file of files) {
    const relative = path.relative(root, file);
    const text = fs.readFileSync(file, "utf8");
    const content = withoutCode(text);
    for (const match of content.matchAll(
      /!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g,
    )) {
      const raw = match[1].replace(/^<|>$/g, "");
      if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith("//")) continue;
      links += 1;
      let target;
      try {
        target = decodeURIComponent(raw).split("#")[0];
      } catch {
        errors.push(`${relative}: malformed link ${raw}`);
        continue;
      }
      // Same-document anchors (`#iss-021`) resolve to the current file, not its directory.
      // 同じ文書を指すアンカーは、現在のファイルへの参照として解決する。
      const resolved = target ? path.resolve(path.dirname(file), target) : file;
      const inside = path.relative(root, resolved);
      if (
        inside === ".." ||
        inside.startsWith(`..${path.sep}`) ||
        path.isAbsolute(inside)
      )
        errors.push(`${relative}: link escapes repository: ${raw}`);
      else if (!fs.existsSync(resolved))
        errors.push(`${relative}: broken link ${raw}`);
      else if (/#iss-\d+$/i.test(raw)) {
        if (!fs.statSync(resolved).isFile())
          errors.push(`${relative}: issue anchor target is not a file: ${raw}`);
        else if (
          !new RegExp(
            `^## ${raw.split("#")[1].toUpperCase()}(?:\\s|$)`,
            "m",
          ).test(fs.readFileSync(resolved, "utf8"))
        )
          errors.push(`${relative}: missing issue anchor ${raw}`);
      }
    }
    if (file.endsWith("SKILL.md") || file.endsWith(".mdc")) {
      const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!match) {
        errors.push(`${relative}: missing YAML frontmatter`);
        continue;
      }
      const document = parseDocument(match[1], { uniqueKeys: true });
      if (document.errors.length) {
        errors.push(`${relative}: ${document.errors[0].message}`);
        continue;
      }
      const data = document.toJS();
      if (
        !data ||
        typeof data.description !== "string" ||
        !data.description.trim()
      )
        errors.push(`${relative}: description is required`);
      if (file.endsWith("SKILL.md")) {
        skills += 1;
        if (
          !data ||
          typeof data.name !== "string" ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name) ||
          data.name.length > 64 ||
          data.name !== path.basename(path.dirname(file))
        )
          errors.push(
            `${relative}: skill name must match its folder and use lowercase hyphens`,
          );
        if ((data?.description?.length ?? 0) > 1024)
          errors.push(`${relative}: description exceeds 1024 characters`);
        for (const heading of [
          "使用条件",
          "参照資料",
          "入力",
          "手順",
          "制約",
          "完了条件",
          "出力形式",
        ])
          if (!content.includes(`## ${heading}`))
            errors.push(`${relative}: missing ${heading}`);
      } else if (typeof data?.alwaysApply !== "boolean")
        errors.push(`${relative}: alwaysApply must be boolean`);
    }
  }
  if (!skills) errors.push(".agents/skills: no skills found");
  const agents = path.join(root, "AGENTS.md");
  if (
    fs.existsSync(agents) &&
    fs.readFileSync(agents, "utf8").trimEnd().split(/\r?\n/).length > 100
  )
    errors.push(
      "AGENTS.md: exceeds the 100-line navigation budget; move details to docs",
    );
  return { errors, files: files.length, links, skills };
}

if (isMain(import.meta.url)) {
  try {
    const { errors, ...details } = checkDocumentation(
      path.resolve(import.meta.dirname, ".."),
    );
    report("docs", errors, details);
  } catch (error) {
    report("docs", [error.message]);
  }
}
