import {
  ensureLocale,
  isRtlLocale,
  resolveLocale,
  t,
  type AppLocale,
  type MessageKey,
} from "../shared/i18n";
import "../shared/i18n/register-lazy-locales";
import type { UiLocale } from "../shared/settings";

/** Apply data-i18n / data-i18n-title / data-i18n-placeholder and document lang/dir.
 *  data-i18n 等と document.lang / dir を反映する。 */
export async function applyDomI18n(
  uiLocale: UiLocale,
  titleKey?: MessageKey,
): Promise<AppLocale> {
  await ensureLocale(uiLocale);
  const resolved = resolveLocale(uiLocale);
  document.documentElement.lang = resolved;
  document.documentElement.dir = isRtlLocale(resolved) ? "rtl" : "ltr";
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n as MessageKey | undefined;
    if (!key) {
      return;
    }
    element.textContent = t(uiLocale, key);
  });
  document
    .querySelectorAll<HTMLElement>("[data-i18n-title]")
    .forEach((element) => {
      const key = element.dataset.i18nTitle as MessageKey | undefined;
      if (!key) {
        return;
      }
      const value = t(uiLocale, key);
      element.title = value;
      // Also drive aria-label when present (e.g. sidebar nav).
      // aria-label がある要素（サイドバー nav 等）にも同じ文言を載せる。
      if (element.hasAttribute("aria-label")) {
        element.setAttribute("aria-label", value);
      }
    });
  document
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "[data-i18n-placeholder]",
    )
    .forEach((element) => {
      const key = element.dataset.i18nPlaceholder as MessageKey | undefined;
      if (!key) {
        return;
      }
      element.placeholder = t(uiLocale, key);
    });
  if (titleKey) {
    document.title = t(uiLocale, titleKey);
  }
  return resolved;
}
