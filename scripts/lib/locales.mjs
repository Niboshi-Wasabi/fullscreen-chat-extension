import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

function placeholders(text) {
  return [...text.matchAll(/\{([\w]+)\}|\$([A-Z][A-Z0-9_]*)\$/g)]
    .map((match) => match[0])
    .sort();
}

/** Read catalogs under root and return errors plus fallback counts / 辞書を変更せず整合性と例外を検査。 */
export function checkLocales(root) {
  const errors = [];
  const directory = path.join(root, "src/shared/i18n/locales");
  const source = ts.createSourceFile(
    "locale-meta.ts",
    fs.readFileSync(path.join(root, "src/shared/i18n/locale-meta.ts"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const codes = [];
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "APP_LOCALES"
    ) {
      const collect = (child) => {
        if (
          ts.isPropertyAssignment(child) &&
          child.name.getText(source) === "code" &&
          ts.isStringLiteral(child.initializer)
        )
          codes.push(child.initializer.text);
        ts.forEachChild(child, collect);
      };
      collect(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (
    !codes.length ||
    new Set(codes).size !== codes.length ||
    !codes.includes("en")
  )
    errors.push("locale-meta.ts: empty, duplicate or missing en locale codes");
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5));
  const fallback = JSON.parse(
    fs.readFileSync(
      path.join(root, "docs/quality/locale-fallbacks.json"),
      "utf8",
    ),
  );
  if (!fallback || Array.isArray(fallback) || typeof fallback !== "object")
    throw new Error("fallback policy must be an object");
  const readCatalog = (code) => {
    try {
      const value = JSON.parse(
        fs.readFileSync(path.join(directory, `${code}.json`), "utf8"),
      );
      if (
        !value ||
        Array.isArray(value) ||
        typeof value !== "object" ||
        Object.values(value).some((text) => typeof text !== "string")
      )
        throw new Error("catalog must be an object of strings");
      return value;
    } catch (error) {
      errors.push(`${code}: ${error.message}`);
      return {};
    }
  };
  const en = readCatalog("en");
  const keys = Object.keys(en);
  if (!keys.length) errors.push("en: catalog is empty");
  for (const code of codes)
    if (!files.includes(code)) errors.push(`${code}: missing catalog file`);
  for (const code of files)
    if (!codes.includes(code)) errors.push(`${code}: missing locale metadata`);
  for (const code of Object.keys(fallback)) {
    if (!codes.includes(code) || code === "en")
      errors.push(`${code}: invalid fallback locale`);
    if (
      !Array.isArray(fallback[code]) ||
      fallback[code].some((key) => typeof key !== "string") ||
      new Set(fallback[code]).size !== fallback[code].length
    )
      errors.push(`${code}: fallback must be unique string keys`);
  }
  let fallbackCount = 0;
  for (const code of files) {
    const catalog = code === "en" ? en : readCatalog(code);
    const allowed = Array.isArray(fallback[code]) ? fallback[code] : [];
    for (const key of keys) {
      if (!Object.hasOwn(catalog, key)) {
        if (allowed.includes(key)) fallbackCount += 1;
        else
          errors.push(
            `${code}.${key}: missing translation; translate or explicitly review an English fallback`,
          );
      } else if (
        JSON.stringify(placeholders(catalog[key])) !==
        JSON.stringify(placeholders(en[key]))
      )
        errors.push(
          `${code}.${key}: interpolation placeholders differ from English`,
        );
    }
    for (const key of Object.keys(catalog))
      if (!Object.hasOwn(en, key))
        errors.push(`${code}.${key}: unknown translation key`);
    for (const key of allowed)
      if (!Object.hasOwn(en, key) || Object.hasOwn(catalog, key))
        errors.push(`${code}.${key}: stale fallback entry; remove it`);
  }
  return { errors, locales: codes.length, keys: keys.length, fallbackCount };
}
