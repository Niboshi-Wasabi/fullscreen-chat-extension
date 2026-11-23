import { isSettingsPatch, isWithinSettingsSize } from "./settings-validation";
/**
 * Settings export / import / reset helpers.
 * 設定のエクスポート／インポート／リセット。
 */

import {
  DEFAULT_SETTINGS,
  loadSettings,
  mergeSettings,
  replaceSettings,
  type ExtensionSettings,
} from "./settings";

/** Bump when the on-disk envelope shape changes / バックアップファイルの外側の構造を変更したら版番号を上げる */
export const SETTINGS_BACKUP_VERSION = 1 as const;

/**
 * Top-level keys of removed features. Older exports still contain them, and
 * strict validation would otherwise reject the whole file (ISS-027).
 * 廃止機能のキー。旧版の書き出しに残り、厳密な検証で全体が拒否されるため除く。
 */
const RETIRED_SETTINGS_KEYS: readonly string[] = ["youtubeComments"];

export interface SettingsBackupEnvelope {
  version: typeof SETTINGS_BACKUP_VERSION;
  exportedAt: string;
  settings: ExtensionSettings;
}

export function buildSettingsBackup(
  settings: ExtensionSettings,
): SettingsBackupEnvelope {
  return {
    version: SETTINGS_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
  };
}

/**
 * Parse and validate a backup JSON value. Returns null when unusable.
 * バックアップ JSON を検証。使えないときは null。
 */
export function parseSettingsBackup(raw: unknown): ExtensionSettings | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (!isWithinSettingsSize(raw)) return null;
  const settingsRaw = Object.hasOwn(raw, "version")
    ? raw.version === SETTINGS_BACKUP_VERSION
      ? raw.settings
      : null
    : "enabled" in raw || "displayMode" in raw || "panel" in raw
      ? raw
      : null;
  const current = withoutRetiredKeys(settingsRaw);
  if (!isSettingsPatch(current)) return null;
  return mergeSettings(DEFAULT_SETTINGS, current);
}

function withoutRetiredKeys(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !RETIRED_SETTINGS_KEYS.includes(key),
    ),
  );
}

export async function exportSettingsBackup(): Promise<SettingsBackupEnvelope> {
  const settings = await loadSettings();
  return buildSettingsBackup(settings);
}

export async function importSettingsBackup(
  raw: unknown,
): Promise<ExtensionSettings | null> {
  const parsed = parseSettingsBackup(raw);
  if (!parsed) {
    return null;
  }
  return replaceSettings(parsed);
}

export async function resetSettingsToDefault(): Promise<ExtensionSettings> {
  return replaceSettings({
    ...DEFAULT_SETTINGS,
    panel: { ...DEFAULT_SETTINGS.panel },
    danmaku: { ...DEFAULT_SETTINGS.danmaku },
    popout: { ...DEFAULT_SETTINGS.popout },
    filter: {
      ...DEFAULT_SETTINGS.filter,
      ngWords: [],
      blockedUsers: [],
    },
    youtubeLive: { ...DEFAULT_SETTINGS.youtubeLive },
    twitch: { ...DEFAULT_SETTINGS.twitch },
    archive: { ...DEFAULT_SETTINGS.archive },
    compose: { ...DEFAULT_SETTINGS.compose },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
