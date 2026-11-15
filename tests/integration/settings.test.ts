import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  loadSettings,
  registerSettingsPersistence,
  saveSettings,
  watchSettings,
} from "../../src/shared/settings";
import {
  buildSettingsBackup,
  importSettingsBackup,
  parseSettingsBackup,
} from "../../src/shared/settings-backup";
import { settings } from "../helpers";

let stopPersistence: () => void;
beforeEach(() => {
  fakeBrowser.reset();
  stopPersistence = registerSettingsPersistence();
});
afterEach(() => stopPersistence());

describe("settings and WebExtension storage", () => {
  it("persists nested patches without losing sibling settings", async () => {
    const initial = settings();
    await saveSettings({ panel: { ...initial.panel, opacity: 0.4 } });
    await saveSettings({ enabled: false });
    expect(await loadSettings()).toMatchObject({
      enabled: false,
      panel: { opacity: 0.4, fontSizePx: initial.panel.fontSizePx },
    });
  });

  it("round trips a valid backup and rejects unusable envelopes without writing", async () => {
    const original = settings();
    original.enabled = false;
    expect(
      await importSettingsBackup(buildSettingsBackup(original)),
    ).toMatchObject({ enabled: false });
    const before = await fakeBrowser.storage.local.get(null);
    for (const invalid of [
      null,
      [],
      "text",
      { version: "invalid", settings: {} },
    ]) {
      expect(parseSettingsBackup(invalid)).toBeNull();
      expect(await importSettingsBackup(invalid)).toBeNull();
    }
    expect(await fakeBrowser.storage.local.get(null)).toEqual(before);
  });

  it("removes the storage listener when the watcher stops", () => {
    expect(fakeBrowser.storage.onChanged.hasListeners()).toBe(false);
    const stop = watchSettings(() => undefined);
    expect(fakeBrowser.storage.onChanged.hasListeners()).toBe(true);
    stop();
    expect(fakeBrowser.storage.onChanged.hasListeners()).toBe(false);
  });
});

describe("settings write boundaries", () => {
  it("rejects a multibyte oversized backup and recovers the queue after a storage failure", async () => {
    expect(
      parseSettingsBackup({
        version: 1,
        settings: { filter: { ngWords: Array(500).fill("あ".repeat(1000)) } },
      }),
    ).toBeNull();
    const spy = vi
      .spyOn(fakeBrowser.storage.local, "set")
      .mockRejectedValueOnce(new Error("Synthetic storage failure"));
    await expect(saveSettings({ enabled: false })).rejects.toThrow(
      "Synthetic storage failure",
    );
    await saveSettings({ enabled: false });
    expect((await loadSettings()).enabled).toBe(false);
    spy.mockRestore();
  });
  it("serializes concurrent disjoint and nested updates", async () => {
    await Promise.all([
      saveSettings({ enabled: false }),
      saveSettings({ uiLocale: "ja" }),
      saveSettings({ panel: { opacity: 0.4 } }),
      saveSettings({ panel: { fontSizePx: 20 } }),
    ]);
    expect(await loadSettings()).toMatchObject({
      enabled: false,
      uiLocale: "ja",
      panel: { opacity: 0.4, fontSizePx: 20 },
    });
  });
  it("rejects corrupt backups without changing storage and repairs corrupt stored fields on read", async () => {
    await saveSettings({ enabled: false });
    const before = await fakeBrowser.storage.local.get(null);
    for (const settings of [
      { filter: { blockedUsers: null } },
      { filter: { ngWords: [1] } },
      { panel: { opacity: 9 } },
      { danmaku: { maxLines: 0 } },
      { displayMode: "unknown" },
      { uiLocale: "unknown" },
      { panel: { position: { x: 1 } } },
    ]) {
      expect(await importSettingsBackup({ version: 1, settings })).toBeNull();
    }
    expect(
      await importSettingsBackup({ version: 999, settings: {} }),
    ).toBeNull();
    expect(await fakeBrowser.storage.local.get(null)).toEqual(before);
    await fakeBrowser.storage.local.set({
      settings: {
        enabled: false,
        filter: { ngWords: null, blockedUsers: "bad" },
      },
    });
    expect(await loadSettings()).toMatchObject({
      enabled: false,
      filter: { ngWords: [], blockedUsers: [] },
    });
  });
  it("accepts legacy bare settings and preserves partial bag siblings", async () => {
    expect(parseSettingsBackup({ enabled: false })).toMatchObject({
      enabled: false,
    });
    await saveSettings({ panel: { opacity: 0.4 } });
    await saveSettings({ panel: { fontSizePx: 18 } });
    expect(await loadSettings()).toMatchObject({
      panel: { opacity: 0.4, fontSizePx: 18 },
    });
  });
});
