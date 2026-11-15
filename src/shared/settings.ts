/**
 * Extension settings schema — mirrors docs/settings-inventory.md.
 * 設定スキーマ。docs/settings-inventory.md と対応させる。
 */

import {
  cleanSettingsPatch,
  isSettingsPatch,
  SETTINGS_WRITE_TYPE,
} from "./settings-validation";

import type { AppLocale } from "./i18n/locale-meta";
import { isAppLocale } from "./i18n/locale-meta";

export type UiLocale = "auto" | AppLocale;

export function parseUiLocale(value: unknown): UiLocale {
  if (value === "auto") {
    return "auto";
  }
  if (typeof value === "string" && isAppLocale(value)) {
    return value;
  }
  return "auto";
}
export type DisplayMode = "panel" | "popout" | "danmaku";
export type PanelAnchor = "left" | "right";
export type DanmakuDensity = "low" | "mid" | "high";
/** currentLive = only the live you're watching; anyWatchPage = previous broader open.
 * currentLive = 今見ているライブのみ。anyWatchPage = 従来どおり広めに開く。 */
export type PopoutOpenPolicy = "currentLive" | "anyWatchPage";

export interface PanelBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PopoutBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ExtensionSettings {
  enabled: boolean;
  uiLocale: UiLocale;
  displayMode: DisplayMode;
  danmakuOverlayOnPanel: boolean;

  panel: {
    anchor: PanelAnchor;
    widthRatio: number;
    opacity: number;
    fontSizePx: number;
    showAuthor: boolean;
    showBadges: boolean;
    idleFade: boolean;
    allowPointer: boolean;
    /** Prefer official chat UI inside the panel / パネル内で公式チャット UI を優先 */
    useNativeChat: boolean;
    position?: PanelBounds;
  };

  danmaku: {
    enabled: boolean;
    /** Cross-screen duration in seconds / 画面横断に要する秒数 */
    speed: number;
    opacity: number;
    fontSizePx: number;
    maxLines: number;
    density: DanmakuDensity;
    outline: boolean;
    showAuthor: boolean;
    safeZoneBottomRatio: number;
  };

  popout: {
    bounds?: PopoutBounds;
    /** Per-site bounds when rememberPerSite is on / サイト別記憶時の bounds */
    boundsBySite?: Partial<Record<"youtube" | "twitch", PopoutBounds>>;
    alwaysOnTop: boolean;
    rememberPerSite: boolean;
    openPolicy: PopoutOpenPolicy;
  };

  filter: {
    ngWords: string[];
    ngRegex: boolean;
    blockedUsers: string[];
    hideCommands: boolean;
    hideBots: boolean;
    protectRoles: boolean;
    maxVisible: number;
    /** Also hide matching lines inside official chat iframe / embed.
     * 公式チャット iframe／埋め込み内の該当行も隠す。 */
    applyToNativeChat: boolean;
  };

  youtubeLive: { enabled: boolean };
  youtubeComments: {
    enabled: boolean;
    /** Prefer Top or Newest via native sort control / 公式の並び替えを踏襲 */
    sort: "top" | "newest";
    /** Keep clicking continuation / show-more controls / 続き・返信をもっと見るを押し続ける */
    autoLoadMore: boolean;
  };
  twitch: {
    enabled: boolean;
    /** Resolve BTTV / FFZ / 7TV codes in scraped chat / 取得チャット内の第三者エモートを解決 */
    thirdPartyEmotes: boolean;
  };
  archive: {
    syncOffsetSec: number;
    maxSkewSec: number;
  };

  compose: {
    enabled: boolean;
    stealShortcuts: boolean;
  };
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  uiLocale: "auto",
  displayMode: "panel",
  danmakuOverlayOnPanel: false,
  panel: {
    anchor: "right",
    widthRatio: 0.22,
    opacity: 0.85,
    fontSizePx: 14,
    showAuthor: true,
    showBadges: true,
    idleFade: true,
    allowPointer: true,
    useNativeChat: true,
  },
  danmaku: {
    enabled: false,
    speed: 8,
    opacity: 0.92,
    fontSizePx: 32,
    maxLines: 40,
    density: "high",
    outline: true,
    showAuthor: false,
    // Keep most of the player usable; tiny bottom pad for controls.
    // プレイヤーほぼ全面を使い、下部コントロール分だけ少し空ける。
    safeZoneBottomRatio: 0.06,
  },
  popout: {
    alwaysOnTop: false,
    rememberPerSite: true,
    openPolicy: "currentLive",
  },
  filter: {
    ngWords: [],
    ngRegex: false,
    blockedUsers: [],
    hideCommands: true,
    hideBots: false,
    protectRoles: true,
    maxVisible: 100,
    applyToNativeChat: true,
  },
  youtubeLive: { enabled: true },
  youtubeComments: {
    enabled: true,
    sort: "top",
    autoLoadMore: true,
  },
  twitch: { enabled: true, thirdPartyEmotes: true },
  archive: {
    syncOffsetSec: 0,
    maxSkewSec: 2,
  },
  compose: {
    enabled: true,
    stealShortcuts: true,
  },
};

export type SettingsPatch = {
  [K in keyof ExtensionSettings]?: ExtensionSettings[K] extends object
    ? Partial<ExtensionSettings[K]>
    : ExtensionSettings[K];
};

const STORAGE_KEY = "settings" as const;
/** Bumps legacy danmaku defaults (font/lanes/density/safe zone) once.
 * 旧弾幕デフォルト（フォント／レーン／密度／安全域）を一度だけ更新する。 */
const DANMAKU_DEFAULTS_MIGRATION_KEY = "fceDanmakuDefaultsV2" as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergePopout(
  base: ExtensionSettings["popout"],
  patch: unknown,
): ExtensionSettings["popout"] {
  if (!isRecord(patch)) {
    return { ...base, boundsBySite: { ...base.boundsBySite } };
  }
  const nextBoundsBySite = {
    ...base.boundsBySite,
    ...(isRecord(patch.boundsBySite) ? patch.boundsBySite : {}),
  } as ExtensionSettings["popout"]["boundsBySite"];
  return {
    ...base,
    ...patch,
    boundsBySite: nextBoundsBySite,
  };
}

/** Shallow-merge nested settings bags / ネストした設定袋を浅いマージ */
export function mergeSettings(
  base: ExtensionSettings,
  patch: SettingsPatch | Record<string, unknown>,
): ExtensionSettings {
  patch = cleanSettingsPatch(patch);
  const next: ExtensionSettings = {
    ...base,
    ...patch,
    panel: { ...base.panel, ...(isRecord(patch.panel) ? patch.panel : {}) },
    danmaku: {
      ...base.danmaku,
      ...(isRecord(patch.danmaku) ? patch.danmaku : {}),
    },
    popout: mergePopout(base.popout, patch.popout),
    filter: { ...base.filter, ...(isRecord(patch.filter) ? patch.filter : {}) },
    youtubeLive: {
      ...base.youtubeLive,
      ...(isRecord(patch.youtubeLive) ? patch.youtubeLive : {}),
    },
    youtubeComments: {
      ...base.youtubeComments,
      ...(isRecord(patch.youtubeComments) ? patch.youtubeComments : {}),
    },
    twitch: {
      ...base.twitch,
      ...(isRecord(patch.twitch) ? patch.twitch : {}),
    },
    archive: {
      ...base.archive,
      ...(isRecord(patch.archive) ? patch.archive : {}),
    },
    compose: {
      ...base.compose,
      ...(isRecord(patch.compose) ? patch.compose : {}),
    },
  };
  return next;
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await browser.storage.local.get([
    STORAGE_KEY,
    DANMAKU_DEFAULTS_MIGRATION_KEY,
  ]);
  const raw = stored[STORAGE_KEY];
  if (!isRecord(raw)) {
    return {
      ...DEFAULT_SETTINGS,
      panel: { ...DEFAULT_SETTINGS.panel },
      danmaku: { ...DEFAULT_SETTINGS.danmaku },
    };
  }
  let merged = mergeSettings(
    DEFAULT_SETTINGS,
    raw as Partial<ExtensionSettings>,
  );
  merged = {
    ...merged,
    uiLocale: parseUiLocale(merged.uiLocale),
  };
  if (stored[DANMAKU_DEFAULTS_MIGRATION_KEY] !== true) {
    merged = {
      ...merged,
      danmaku: {
        ...merged.danmaku,
        fontSizePx: DEFAULT_SETTINGS.danmaku.fontSizePx,
        maxLines: DEFAULT_SETTINGS.danmaku.maxLines,
        density: DEFAULT_SETTINGS.danmaku.density,
        safeZoneBottomRatio: DEFAULT_SETTINGS.danmaku.safeZoneBottomRatio,
        opacity: DEFAULT_SETTINGS.danmaku.opacity,
      },
    };
  }
  return merged;
}

type WriteRequest = {
  type: typeof SETTINGS_WRITE_TYPE;
  operation: "patch" | "replace";
  settings: SettingsPatch;
};
let localWrite: ((request: WriteRequest) => Promise<ExtensionSettings>) | null =
  null;

/** Register only in background: every read/modify/write shares this queue. */
export function registerSettingsPersistence(): () => void {
  let queue: Promise<unknown> = Promise.resolve();
  const write = (request: WriteRequest): Promise<ExtensionSettings> => {
    const task = queue.then(async () => {
      if (!isSettingsPatch(request.settings))
        throw new Error("Invalid settings");
      const base =
        request.operation === "replace"
          ? DEFAULT_SETTINGS
          : await loadSettings();
      const next = mergeSettings(base, request.settings);
      await browser.storage.local.set({
        [STORAGE_KEY]: next,
        [DANMAKU_DEFAULTS_MIGRATION_KEY]: true,
      });
      return next;
    });
    queue = task.catch(() => undefined);
    return task;
  };
  localWrite = write;
  const listener: Parameters<
    typeof browser.runtime.onMessage.addListener
  >[0] = (message, sender, respond) => {
    if (!isRecord(message) || message.type !== SETTINGS_WRITE_TYPE) return;
    if (
      sender.id !== browser.runtime.id ||
      (message.operation !== "patch" && message.operation !== "replace") ||
      !isSettingsPatch(message.settings)
    ) {
      respond({ ok: false });
      return;
    }
    void write(message as WriteRequest).then(
      (settings) => respond({ ok: true, settings }),
      () => respond({ ok: false }),
    );
    return true;
  };
  browser.runtime.onMessage.addListener(listener);
  return () => {
    browser.runtime.onMessage.removeListener(listener);
    if (localWrite === write) localWrite = null;
  };
}

async function requestWrite(
  operation: WriteRequest["operation"],
  settings: SettingsPatch,
): Promise<ExtensionSettings> {
  if (!isSettingsPatch(settings)) throw new Error("Invalid settings");
  const request: WriteRequest = {
    type: SETTINGS_WRITE_TYPE,
    operation,
    settings,
  };
  if (localWrite) return localWrite(request);
  const response = await browser.runtime.sendMessage(request);
  if (!response?.ok || !isSettingsPatch(response.settings))
    throw new Error("Settings could not be saved");
  return mergeSettings(DEFAULT_SETTINGS, response.settings);
}

export function saveSettings(patch: SettingsPatch): Promise<ExtensionSettings> {
  return requestWrite("patch", patch);
}

/** Import/reset use the same background queue as partial updates. */
export function replaceSettings(
  settings: ExtensionSettings,
): Promise<ExtensionSettings> {
  return requestWrite("replace", settings);
}

export function watchSettings(
  onChange: (settings: ExtensionSettings, previous?: ExtensionSettings) => void,
): () => void {
  let subscribed = true;
  const listener: Parameters<
    typeof browser.storage.onChanged.addListener
  >[0] = (changes, areaName) => {
    if (!subscribed || areaName !== "local" || !changes[STORAGE_KEY]) {
      return;
    }
    const previousRaw = changes[STORAGE_KEY].oldValue;
    const previous = isRecord(previousRaw)
      ? mergeSettings(
          DEFAULT_SETTINGS,
          previousRaw as Partial<ExtensionSettings>,
        )
      : undefined;
    const raw = changes[STORAGE_KEY].newValue;
    onChange(
      mergeSettings(DEFAULT_SETTINGS, isRecord(raw) ? raw : {}),
      previous,
    );
  };
  browser.storage.onChanged.addListener(listener);
  return () => {
    subscribed = false;
    browser.storage.onChanged.removeListener(listener);
  };
}
