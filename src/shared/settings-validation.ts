import { isAppLocale } from "./i18n/locale-meta";

type Rule = ((value: unknown) => boolean) | { [key: string]: Rule };
export const MAX_SETTINGS_BYTES = 1024 * 1024;
export const SETTINGS_WRITE_TYPE = "fce:settings-write";
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const bool = (v: unknown) => typeof v === "boolean";
const range =
  (min: number, max: number, integer = false) =>
  (v: unknown) =>
    typeof v === "number" &&
    Number.isFinite(v) &&
    v >= min &&
    v <= max &&
    (!integer || Number.isInteger(v));
const choice =
  (...values: string[]) =>
  (v: unknown) =>
    typeof v === "string" && values.includes(v);
const strings = (v: unknown) =>
  Array.isArray(v) &&
  v.length <= 1000 &&
  v.every((s) => typeof s === "string" && s.length <= 2000);
const panelBounds: Rule = {
  x: range(0, 1e6),
  y: range(0, 1e6),
  w: range(1, 32768),
  h: range(1, 32768),
};
const windowBounds: Rule = {
  left: range(-1e6, 1e6),
  top: range(-1e6, 1e6),
  width: range(280, 32768),
  height: range(360, 32768),
};
const complete = (rule: Rule) => (v: unknown) =>
  isRecord(v) &&
  typeof rule !== "function" &&
  Object.keys(rule).every((k) => Object.hasOwn(v, k)) &&
  valid(v, rule);
const schema: Rule = {
  enabled: bool,
  uiLocale: (v) => typeof v === "string" && (v === "auto" || isAppLocale(v)),
  displayMode: choice("panel", "popout", "danmaku"),
  danmakuOverlayOnPanel: bool,
  panel: {
    anchor: choice("left", "right"),
    widthRatio: range(0.15, 0.4),
    opacity: range(0.2, 1),
    fontSizePx: range(10, 28),
    showAuthor: bool,
    showBadges: bool,
    idleFade: bool,
    allowPointer: bool,
    useNativeChat: bool,
    position: complete(panelBounds),
  },
  danmaku: {
    enabled: bool,
    speed: range(2, 20),
    opacity: range(0.3, 1),
    fontSizePx: range(16, 64),
    maxLines: range(8, 60, true),
    density: choice("low", "mid", "high"),
    outline: bool,
    showAuthor: bool,
    safeZoneBottomRatio: range(0, 0.25),
  },
  popout: {
    bounds: complete(windowBounds),
    boundsBySite: {
      youtube: complete(windowBounds),
      twitch: complete(windowBounds),
    },
    alwaysOnTop: bool,
    rememberPerSite: bool,
    openPolicy: choice("currentLive", "anyWatchPage"),
  },
  filter: {
    ngWords: strings,
    ngRegex: bool,
    blockedUsers: strings,
    hideCommands: bool,
    hideBots: bool,
    protectRoles: bool,
    maxVisible: range(1, 500, true),
    applyToNativeChat: bool,
  },
  youtubeLive: { enabled: bool },
  twitch: { enabled: bool, thirdPartyEmotes: bool },
  archive: { syncOffsetSec: range(-30, 30), maxSkewSec: range(0.5, 15) },
  compose: { enabled: bool, stealShortcuts: bool },
};
function valid(value: unknown, rule: Rule): boolean {
  if (typeof rule === "function") return rule(value);
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, entry]) => Object.hasOwn(rule, key) && valid(entry, rule[key]!),
    )
  );
}
export function isWithinSettingsSize(value: unknown): boolean {
  try {
    const encoded = JSON.stringify(value);
    return (
      typeof encoded === "string" &&
      new TextEncoder().encode(encoded).byteLength <= MAX_SETTINGS_BYTES
    );
  } catch {
    return false;
  }
}
export function isSettingsPatch(
  value: unknown,
): value is Record<string, unknown> {
  return isWithinSettingsSize(value) && valid(value, schema);
}
/** Drop corrupt/unknown stored fields; reject them entirely at import/write boundaries. */
export function cleanSettingsPatch(
  value: unknown,
  rule: Rule = schema,
): Record<string, unknown> {
  if (!isRecord(value) || typeof rule === "function") return {};
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.hasOwn(rule, key)) continue;
    const child = rule[key]!;
    if (typeof child !== "function")
      out[key] = cleanSettingsPatch(entry, child);
    else if (child(entry)) out[key] = Array.isArray(entry) ? [...entry] : entry;
  }
  return out;
}
/** Compare only UI-owned fields, so an old form cannot overwrite other contexts. */
export function changedSettings<T extends object>(base: unknown, patch: T): T {
  const out: Record<string, unknown> = {};
  if (!isRecord(patch)) return out as T;
  for (const [key, value] of Object.entries(patch)) {
    const old = isRecord(base) ? base[key] : undefined;
    if (isRecord(value)) {
      const nested = changedSettings(old, value);
      if (Object.keys(nested).length) out[key] = nested;
    } else if (JSON.stringify(old) !== JSON.stringify(value)) out[key] = value;
  }
  return out as T;
}
