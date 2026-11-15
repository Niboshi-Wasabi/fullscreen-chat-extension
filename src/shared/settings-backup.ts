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

/** Bump when the on-disk envelope shape changes / 封筒形式が変わったら上げる */
export const SETTINGS_BACKUP_VERSION = 1 as const;

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
  if (!isSettingsPatch(settingsRaw)) return null;
  return mergeSettings(DEFAULT_SETTINGS, settingsRaw);
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
    youtubeComments: { ...DEFAULT_SETTINGS.youtubeComments },
    twitch: { ...DEFAULT_SETTINGS.twitch },
    archive: { ...DEFAULT_SETTINGS.archive },
    compose: { ...DEFAULT_SETTINGS.compose },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
