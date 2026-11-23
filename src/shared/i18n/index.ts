import type { UiLocale } from "../settings";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import {
  APP_LOCALES,
  isAppLocale,
  isRtlLocale,
  matchBrowserLanguage,
  type AppLocale,
} from "./locale-meta";

export type MessageKey = keyof typeof en;
export type MessageCatalog = Record<MessageKey, string>;

export { APP_LOCALES, isAppLocale, isRtlLocale, type AppLocale };

type LocaleLoader = (
  locale: AppLocale,
) => Promise<Partial<MessageCatalog> | null>;

// Content ships en+ja only (no dynamic chunks in content scripts).
// Ceiling: host-page UI (panel / player chrome / PiP) falls back to English when
// uiLocale is neither en nor ja. Next: fetch locale JSON via runtime.getURL.
// content は en/ja のみ（content script に動的 chunk を載せない）。
// ホストページの UI は en/ja 以外では英語を使う。今後は runtime.getURL での読み込みを検討する。
let extraLocaleLoader: LocaleLoader | null = null;

const CATALOG: Partial<Record<AppLocale, MessageCatalog>> = {
  en: en as MessageCatalog,
  ja: { ...en, ...ja } as MessageCatalog,
};

const loading = new Map<AppLocale, Promise<void>>();

/** Used by extension pages to attach import.meta.glob loaders / 拡張ページが glob ローダーを接続 */
export function registerExtraLocaleLoader(loader: LocaleLoader): void {
  extraLocaleLoader = loader;
}

export function resolveLocale(uiLocale: UiLocale): AppLocale {
  if (uiLocale !== "auto" && isAppLocale(uiLocale)) {
    return uiLocale;
  }
  let language: string | undefined;
  try {
    language = browser.i18n?.getUILanguage?.();
  } catch {
    language = undefined;
  }
  return matchBrowserLanguage(language ?? navigator.language) ?? "en";
}

/**
 * Ensure the resolved locale catalog is in memory (no-op for en/ja).
 * 解決済みロケールのカタログをメモリに載せる（en/ja は何もしない）。
 */
export async function ensureLocale(uiLocale: UiLocale): Promise<AppLocale> {
  const locale = resolveLocale(uiLocale);
  if (CATALOG[locale]) {
    return locale;
  }
  let pending = loading.get(locale);
  if (!pending) {
    pending = loadExtraLocale(locale).finally(() => {
      loading.delete(locale);
    });
    loading.set(locale, pending);
  }
  await pending;
  return locale;
}

async function loadExtraLocale(locale: AppLocale): Promise<void> {
  if (CATALOG[locale] || !extraLocaleLoader) {
    return;
  }
  try {
    const partial = await extraLocaleLoader(locale);
    if (!partial) {
      return;
    }
    CATALOG[locale] = { ...en, ...partial } as MessageCatalog;
  } catch {
    // Missing loader or failed fetch — callers keep English fallback.
    // ローダー無し／失敗時は英語フォールバックのまま。
  }
}

export function t(uiLocale: UiLocale, key: MessageKey): string {
  const locale = resolveLocale(uiLocale);
  const catalog = CATALOG[locale] ?? CATALOG.en ?? en;
  return catalog[key] ?? en[key] ?? key;
}

/** Native-labeled list for the language select / 言語セレクト用（各言語での言語名） */
export function listLocaleOptions(): ReadonlyArray<{
  code: AppLocale;
  label: string;
}> {
  return APP_LOCALES.map((entry) => ({
    code: entry.code,
    label: entry.nativeLabel,
  }));
}
