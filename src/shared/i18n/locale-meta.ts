/**
 * Supported UI locales — codes are BCP 47-ish tags used in settings.
 * 対応 UI 言語。設定に保存するタグ。
 */
export const APP_LOCALES = [
  { code: "en", nativeLabel: "English" },
  { code: "ja", nativeLabel: "日本語" },
  { code: "ko", nativeLabel: "한국어" },
  { code: "zh-Hans", nativeLabel: "简体中文" },
  { code: "zh-Hant", nativeLabel: "繁體中文" },
  { code: "es", nativeLabel: "Español" },
  { code: "pt-BR", nativeLabel: "Português (Brasil)" },
  { code: "pt-PT", nativeLabel: "Português (Portugal)" },
  { code: "fr", nativeLabel: "Français" },
  { code: "de", nativeLabel: "Deutsch" },
  { code: "it", nativeLabel: "Italiano" },
  { code: "nl", nativeLabel: "Nederlands" },
  { code: "pl", nativeLabel: "Polski" },
  { code: "ru", nativeLabel: "Русский" },
  { code: "uk", nativeLabel: "Українська" },
  { code: "ar", nativeLabel: "العربية" },
  { code: "he", nativeLabel: "עברית" },
  { code: "fa", nativeLabel: "فارسی" },
  { code: "hi", nativeLabel: "हिन्दी" },
  { code: "bn", nativeLabel: "বাংলা" },
  { code: "th", nativeLabel: "ไทย" },
  { code: "vi", nativeLabel: "Tiếng Việt" },
  { code: "id", nativeLabel: "Bahasa Indonesia" },
  { code: "ms", nativeLabel: "Bahasa Melayu" },
  { code: "fil", nativeLabel: "Filipino" },
  { code: "tr", nativeLabel: "Türkçe" },
  { code: "cs", nativeLabel: "Čeština" },
  { code: "sk", nativeLabel: "Slovenčina" },
  { code: "hu", nativeLabel: "Magyar" },
  { code: "ro", nativeLabel: "Română" },
  { code: "bg", nativeLabel: "Български" },
  { code: "hr", nativeLabel: "Hrvatski" },
  { code: "sr", nativeLabel: "Srpski" },
  { code: "sv", nativeLabel: "Svenska" },
  { code: "da", nativeLabel: "Dansk" },
  { code: "nb", nativeLabel: "Norsk bokmål" },
  { code: "fi", nativeLabel: "Suomi" },
  { code: "el", nativeLabel: "Ελληνικά" },
  { code: "ca", nativeLabel: "Català" },
  { code: "sw", nativeLabel: "Kiswahili" },
  { code: "lt", nativeLabel: "Lietuvių" },
  { code: "lv", nativeLabel: "Latviešu" },
  { code: "et", nativeLabel: "Eesti" },
  { code: "sl", nativeLabel: "Slovenščina" },
] as const;

export type AppLocale = (typeof APP_LOCALES)[number]["code"];

export const APP_LOCALE_CODES: readonly AppLocale[] = APP_LOCALES.map(
  (entry) => entry.code,
);

const APP_LOCALE_SET = new Set<string>(APP_LOCALE_CODES);

export function isAppLocale(value: string): value is AppLocale {
  return APP_LOCALE_SET.has(value);
}

const RTL_LOCALE_SET = new Set<AppLocale>(["ar", "he", "fa"]);

/** Right-to-left scripts / 右から左へ書く言語 */
export function isRtlLocale(locale: AppLocale): boolean {
  return RTL_LOCALE_SET.has(locale);
}

/** Map browser language tags to our catalog / ブラウザ言語タグをカタログへ */
const BROWSER_ALIASES: Record<string, AppLocale> = {
  en: "en",
  "en-us": "en",
  "en-gb": "en",
  ja: "ja",
  "ja-jp": "ja",
  ko: "ko",
  "ko-kr": "ko",
  zh: "zh-Hans",
  "zh-cn": "zh-Hans",
  "zh-sg": "zh-Hans",
  "zh-hans": "zh-Hans",
  "zh-tw": "zh-Hant",
  "zh-hk": "zh-Hant",
  "zh-mo": "zh-Hant",
  "zh-hant": "zh-Hant",
  es: "es",
  "es-es": "es",
  "es-mx": "es",
  "es-419": "es",
  pt: "pt-PT",
  "pt-pt": "pt-PT",
  "pt-br": "pt-BR",
  fr: "fr",
  de: "de",
  it: "it",
  nl: "nl",
  pl: "pl",
  ru: "ru",
  uk: "uk",
  ar: "ar",
  he: "he",
  iw: "he",
  fa: "fa",
  hi: "hi",
  bn: "bn",
  th: "th",
  vi: "vi",
  id: "id",
  ms: "ms",
  fil: "fil",
  tl: "fil",
  tr: "tr",
  cs: "cs",
  sk: "sk",
  hu: "hu",
  ro: "ro",
  bg: "bg",
  hr: "hr",
  sr: "sr",
  sv: "sv",
  da: "da",
  nb: "nb",
  no: "nb",
  nn: "nb",
  fi: "fi",
  el: "el",
  ca: "ca",
  sw: "sw",
  lt: "lt",
  lv: "lv",
  et: "et",
  sl: "sl",
};

export function matchBrowserLanguage(tag: string): AppLocale | null {
  const normalized = tag.trim().toLowerCase().replaceAll("_", "-");
  if (!normalized) {
    return null;
  }
  const exact = BROWSER_ALIASES[normalized];
  if (exact) {
    return exact;
  }
  const base = normalized.split("-")[0] ?? "";
  return BROWSER_ALIASES[base] ?? null;
}
