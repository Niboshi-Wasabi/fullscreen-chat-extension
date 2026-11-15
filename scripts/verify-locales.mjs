import path from "node:path";
import { checkLocales } from "./lib/locales.mjs";
import { isMain, report } from "./lib/check-utils.mjs";

export { checkLocales };

if (isMain(import.meta.url)) {
  try {
    const { errors, ...details } = checkLocales(
      path.resolve(import.meta.dirname, ".."),
    );
    report("locales", errors, details);
  } catch (error) {
    report("locales", [error.message]);
  }
}
