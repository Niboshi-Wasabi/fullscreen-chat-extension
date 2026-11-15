import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { Page } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../../src/shared/settings";

/** Run original modules in an isolated synthetic page; no production test API. */
export async function exerciseSource(
  page: Page,
  entry: string,
  scenario: string,
): Promise<unknown> {
  const root = path.resolve(import.meta.dirname, "../..");
  const modules = new Map<string, string>();
  function collect(file: string): string {
    const absolute = path.resolve(root, file);
    const id = path.relative(root, absolute).replaceAll("\\", "/");
    if (modules.has(id)) return id;
    modules.set(id, "");
    if (absolute.endsWith(".json")) {
      modules.set(id, `module.exports=${fs.readFileSync(absolute, "utf8")};`);
      return id;
    }
    let code = ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText;
    code = code.replace(/require\("([^"]+)"\)/g, (_, specifier: string) => {
      if (!specifier.startsWith("."))
        throw new Error(`Unsupported fixture dependency ${specifier}`);
      const base = path.resolve(path.dirname(absolute), specifier);
      const target = [base, `${base}.ts`, path.join(base, "index.ts")].find(
        (candidate) =>
          fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
      );
      if (!target) throw new Error(`Missing ${specifier}`);
      return `require(${JSON.stringify(collect(target))})`;
    });
    modules.set(id, code);
    return id;
  }
  const id = collect(entry);
  const definitions = [...modules]
    .map(
      ([key, code]) =>
        `${JSON.stringify(key)}:function(require,module,exports){${code}\n}`,
    )
    .join(",");
  return page.evaluate(`(async()=>{
    const initial=${JSON.stringify(DEFAULT_SETTINGS)};
    const browser={ i18n:{getUILanguage:()=>"en"}, storage:{local:{get:async()=>({settings:initial})},onChanged:{addListener(){},removeListener(){}}} };
    const definitions={${definitions}};
    const cache={};
    const require=id=>{if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;definitions[id](require,module,module.exports);return module.exports;};
    const api=require(${JSON.stringify(id)});
    ${scenario}
  })()`);
}
