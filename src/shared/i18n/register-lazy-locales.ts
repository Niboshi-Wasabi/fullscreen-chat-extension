import {
  registerExtraLocaleLoader,
  type AppLocale,
  type MessageCatalog,
} from "./index";

const localeLoaders = import.meta.glob<{ default: Partial<MessageCatalog> }>([
  "./locales/*.json",
  "!./locales/en.json",
  "!./locales/ja.json",
]);

/**
 * Register lazy locale JSON loaders for extension pages (popup / options).
 * Not imported from content scripts — keeps content.js free of locale chunks.
 * 拡張ページ用の翻訳カタログを必要なときに読み込む処理を登録する。content からは import しない。
 */
export function registerLazyLocales(): void {
  registerExtraLocaleLoader(async (locale: AppLocale) => {
    if (locale === "en" || locale === "ja") {
      return null;
    }
    const loader = localeLoaders[`./locales/${locale}.json`];
    if (!loader) {
      return null;
    }
    const module = await loader();
    return module.default ?? module;
  });
}

registerLazyLocales();
