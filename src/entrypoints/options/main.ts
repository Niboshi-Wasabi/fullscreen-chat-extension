import {
  changedSettings,
  MAX_SETTINGS_BYTES,
} from "../../shared/settings-validation";
import { resolveLocale, t, type MessageKey } from "../../shared/i18n";
import {
  exportSettingsBackup,
  importSettingsBackup,
  resetSettingsToDefault,
} from "../../shared/settings-backup";
import { getFeatureFlags } from "../../shared/feature-flags";
import { applyDomI18n } from "../../ui/dom-i18n";
import {
  loadSettings,
  saveSettings,
  type DanmakuDensity,
  type ExtensionSettings,
  type PanelAnchor,
  type PopoutOpenPolicy,
  type UiLocale,
  type SettingsPatch,
  mergeSettings,
} from "../../shared/settings";

type TabId = "general" | "display" | "filter" | "archive" | "legal";

const TAB_TITLE_KEYS: Record<TabId, MessageKey> = {
  general: "navGeneral",
  display: "navDisplay",
  filter: "navFilter",
  archive: "navArchive",
  legal: "navLegal",
};

const navItems = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".fce-nav-item"),
);
const panels = Array.from(document.querySelectorAll<HTMLElement>(".fce-panel"));
const panelTitle = document.querySelector<HTMLElement>("#panelTitle");
const status = document.querySelector<HTMLElement>("#status");
const privacyLink = document.querySelector<HTMLAnchorElement>("#privacyLink");

const composeEnabled =
  document.querySelector<HTMLInputElement>("#composeEnabled");
const composeSteal = document.querySelector<HTMLInputElement>("#composeSteal");
const panelAnchor = document.querySelector<HTMLSelectElement>("#panelAnchor");
const panelWidth = document.querySelector<HTMLInputElement>("#panelWidth");
const panelOpacity = document.querySelector<HTMLInputElement>("#panelOpacity");
const panelFont = document.querySelector<HTMLInputElement>("#panelFont");
const panelShowAuthor =
  document.querySelector<HTMLInputElement>("#panelShowAuthor");
const panelShowBadges =
  document.querySelector<HTMLInputElement>("#panelShowBadges");
const panelIdleFade =
  document.querySelector<HTMLInputElement>("#panelIdleFade");
const panelAllowPointer =
  document.querySelector<HTMLInputElement>("#panelAllowPointer");
const panelUseNative =
  document.querySelector<HTMLInputElement>("#panelUseNative");
const danmakuEnabled =
  document.querySelector<HTMLInputElement>("#danmakuEnabled");
const danmakuOverlay =
  document.querySelector<HTMLInputElement>("#danmakuOverlay");
const danmakuSpeed = document.querySelector<HTMLInputElement>("#danmakuSpeed");
const danmakuOpacity =
  document.querySelector<HTMLInputElement>("#danmakuOpacity");
const danmakuFont = document.querySelector<HTMLInputElement>("#danmakuFont");
const danmakuMaxLines =
  document.querySelector<HTMLInputElement>("#danmakuMaxLines");
const danmakuDensity =
  document.querySelector<HTMLSelectElement>("#danmakuDensity");
const danmakuOutline =
  document.querySelector<HTMLInputElement>("#danmakuOutline");
const danmakuShowAuthor =
  document.querySelector<HTMLInputElement>("#danmakuShowAuthor");
const danmakuSafeZone =
  document.querySelector<HTMLInputElement>("#danmakuSafeZone");
const popoutOpenPolicy =
  document.querySelector<HTMLSelectElement>("#popoutOpenPolicy");
const popoutRememberSite = document.querySelector<HTMLInputElement>(
  "#popoutRememberSite",
);
const popoutAlwaysOnTop =
  document.querySelector<HTMLInputElement>("#popoutAlwaysOnTop");
const popoutAlwaysOnTopHint = document.querySelector<HTMLElement>(
  "#popoutAlwaysOnTopHint",
);
if (!getFeatureFlags().documentPip) {
  // Without Document PiP an OS popout cannot stay on top.
  // 「前面に固定」は Document PiP 対応環境でのみ利用できる。
  if (popoutAlwaysOnTop) {
    popoutAlwaysOnTop.disabled = true;
  }
  if (popoutAlwaysOnTopHint) {
    popoutAlwaysOnTopHint.dataset.i18n = "popoutAlwaysOnTopUnavailable";
  }
}
const twitchThirdPartyEmotes = document.querySelector<HTMLInputElement>(
  "#twitchThirdPartyEmotes",
);
const ngWords = document.querySelector<HTMLTextAreaElement>("#ngWords");
const ngRegex = document.querySelector<HTMLInputElement>("#ngRegex");
const blockedUsers =
  document.querySelector<HTMLTextAreaElement>("#blockedUsers");
const hideCommands = document.querySelector<HTMLInputElement>("#hideCommands");
const hideBots = document.querySelector<HTMLInputElement>("#hideBots");
const protectRoles = document.querySelector<HTMLInputElement>("#protectRoles");
const maxVisible = document.querySelector<HTMLInputElement>("#maxVisible");
const filterNativeChat =
  document.querySelector<HTMLInputElement>("#filterNativeChat");
const archiveOffset =
  document.querySelector<HTMLInputElement>("#archiveOffset");
const archiveSkew = document.querySelector<HTMLInputElement>("#archiveSkew");

let activeTab: TabId = "general";
let currentLocale: UiLocale = "auto";
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let savedStatusTimer: ReturnType<typeof setTimeout> | undefined;
let applyingForm = false;
let formGeneration = 0;
let formBaseline: ExtensionSettings | null = null;

function linesFromTextarea(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatBadge(id: string, raw: number): string {
  switch (id) {
    case "panelWidth":
      return `${Math.round(raw * 100)}%`;
    case "panelOpacity":
    case "danmakuOpacity":
      return `${Math.round(raw * 100)}%`;
    case "panelFont":
    case "danmakuFont":
      return `${Math.round(raw)}px`;
    case "danmakuSpeed":
    case "archiveOffset":
    case "archiveSkew":
      return `${raw}s`;
    case "danmakuSafeZone":
      return `${Math.round(raw * 100)}%`;
    default:
      return String(Math.round(raw * 1000) / 1000);
  }
}

function syncBadges(): void {
  document
    .querySelectorAll<HTMLElement>("[data-badge-for]")
    .forEach((badge) => {
      const id = badge.dataset.badgeFor;
      if (!id) {
        return;
      }
      const input = document.querySelector<HTMLInputElement>(`#${id}`);
      if (!input) {
        return;
      }
      badge.textContent = formatBadge(id, Number(input.value));
    });
}

function showStatus(message: string, isError = false): void {
  if (!status) {
    return;
  }
  status.textContent = message;
  if (isError) {
    status.dataset.state = "error";
  } else {
    delete status.dataset.state;
  }
  window.clearTimeout(savedStatusTimer);
  savedStatusTimer = setTimeout(() => {
    if (status) {
      status.textContent = "";
      delete status.dataset.state;
    }
  }, 1600);
}

function showSaved(): void {
  showStatus(t(currentLocale, "saved"));
}

function selectTab(tab: TabId): void {
  activeTab = tab;
  for (const item of navItems) {
    const isActive = item.dataset.tab === tab;
    if (isActive) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  }
  for (const panel of panels) {
    const isActive = panel.dataset.panel === tab;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  }
  if (panelTitle) {
    panelTitle.textContent = t(currentLocale, TAB_TITLE_KEYS[tab]);
  }
}

async function fillForm(settings: ExtensionSettings): Promise<void> {
  applyingForm = true;
  currentLocale = settings.uiLocale;
  await applyDomI18n(settings.uiLocale, "optionsTitle");
  if (panelTitle) {
    panelTitle.textContent = t(settings.uiLocale, TAB_TITLE_KEYS[activeTab]);
  }
  if (composeEnabled) {
    composeEnabled.checked = settings.compose.enabled;
  }
  if (composeSteal) {
    composeSteal.checked = settings.compose.stealShortcuts;
  }
  if (panelAnchor) {
    panelAnchor.value = settings.panel.anchor;
  }
  if (panelWidth) {
    panelWidth.value = String(settings.panel.widthRatio);
  }
  if (panelOpacity) {
    panelOpacity.value = String(settings.panel.opacity);
  }
  if (panelFont) {
    panelFont.value = String(settings.panel.fontSizePx);
  }
  if (panelShowAuthor) {
    panelShowAuthor.checked = settings.panel.showAuthor;
  }
  if (panelShowBadges) {
    panelShowBadges.checked = settings.panel.showBadges;
  }
  if (panelIdleFade) {
    panelIdleFade.checked = settings.panel.idleFade;
  }
  if (panelAllowPointer) {
    panelAllowPointer.checked = settings.panel.allowPointer;
  }
  if (panelUseNative) {
    panelUseNative.checked = settings.panel.useNativeChat;
  }
  if (danmakuEnabled) {
    danmakuEnabled.checked = settings.danmaku.enabled;
  }
  if (danmakuOverlay) {
    danmakuOverlay.checked = settings.danmakuOverlayOnPanel;
  }
  if (danmakuSpeed) {
    danmakuSpeed.value = String(settings.danmaku.speed);
  }
  if (danmakuOpacity) {
    danmakuOpacity.value = String(settings.danmaku.opacity);
  }
  if (danmakuFont) {
    danmakuFont.value = String(settings.danmaku.fontSizePx);
  }
  if (danmakuMaxLines) {
    danmakuMaxLines.value = String(settings.danmaku.maxLines);
  }
  if (danmakuDensity) {
    danmakuDensity.value = settings.danmaku.density;
  }
  if (danmakuOutline) {
    danmakuOutline.checked = settings.danmaku.outline;
  }
  if (danmakuShowAuthor) {
    danmakuShowAuthor.checked = settings.danmaku.showAuthor;
  }
  if (danmakuSafeZone) {
    danmakuSafeZone.value = String(settings.danmaku.safeZoneBottomRatio);
  }
  if (popoutOpenPolicy) {
    popoutOpenPolicy.value = settings.popout.openPolicy;
  }
  if (popoutRememberSite) {
    popoutRememberSite.checked = settings.popout.rememberPerSite;
  }
  if (popoutAlwaysOnTop) {
    popoutAlwaysOnTop.checked = settings.popout.alwaysOnTop;
  }
  if (twitchThirdPartyEmotes) {
    twitchThirdPartyEmotes.checked = settings.twitch.thirdPartyEmotes;
  }
  if (ngWords) {
    ngWords.value = settings.filter.ngWords.join("\n");
  }
  if (ngRegex) {
    ngRegex.checked = settings.filter.ngRegex;
  }
  if (blockedUsers) {
    blockedUsers.value = settings.filter.blockedUsers.join("\n");
  }
  if (hideCommands) {
    hideCommands.checked = settings.filter.hideCommands;
  }
  if (hideBots) {
    hideBots.checked = settings.filter.hideBots;
  }
  if (protectRoles) {
    protectRoles.checked = settings.filter.protectRoles;
  }
  if (maxVisible) {
    maxVisible.value = String(settings.filter.maxVisible);
  }
  if (filterNativeChat) {
    filterNativeChat.checked = settings.filter.applyToNativeChat;
  }
  if (archiveOffset) {
    archiveOffset.value = String(settings.archive.syncOffsetSec);
  }
  if (archiveSkew) {
    archiveSkew.value = String(settings.archive.maxSkewSec);
  }
  if (privacyLink) {
    privacyLink.href = browser.runtime.getURL("/privacy.html");
  }
  syncBadges();
  formBaseline = structuredClone(settings);
  applyingForm = false;
}

async function persistFromForm(): Promise<void> {
  if (applyingForm) {
    return;
  }
  const generation = formGeneration;
  const current = await loadSettings();
  if (applyingForm || generation !== formGeneration) return;
  // enabled / displayMode / sites stay popup-owned — do not overwrite from options.
  // 有効状態、モード、サイトはポップアップで管理する。options からは上書きしない。
  const formPatch: SettingsPatch = {
    danmakuOverlayOnPanel: Boolean(danmakuOverlay?.checked),
    panel: {
      anchor: (panelAnchor?.value as PanelAnchor) ?? current.panel.anchor,
      widthRatio: Number(panelWidth?.value ?? current.panel.widthRatio),
      opacity: Number(panelOpacity?.value ?? current.panel.opacity),
      fontSizePx: Number(panelFont?.value ?? current.panel.fontSizePx),
      showAuthor: Boolean(panelShowAuthor?.checked),
      showBadges: Boolean(panelShowBadges?.checked),
      idleFade: Boolean(panelIdleFade?.checked),
      allowPointer: Boolean(panelAllowPointer?.checked),
      useNativeChat: Boolean(panelUseNative?.checked),
    },
    danmaku: {
      enabled: Boolean(danmakuEnabled?.checked),
      speed: Number(danmakuSpeed?.value ?? current.danmaku.speed),
      opacity: Number(danmakuOpacity?.value ?? current.danmaku.opacity),
      fontSizePx: Number(danmakuFont?.value ?? current.danmaku.fontSizePx),
      maxLines: Number(danmakuMaxLines?.value ?? current.danmaku.maxLines),
      density:
        (danmakuDensity?.value as DanmakuDensity) ?? current.danmaku.density,
      outline: Boolean(danmakuOutline?.checked),
      showAuthor: Boolean(danmakuShowAuthor?.checked),
      safeZoneBottomRatio: Number(
        danmakuSafeZone?.value ?? current.danmaku.safeZoneBottomRatio,
      ),
    },
    popout: {
      openPolicy:
        (popoutOpenPolicy?.value as PopoutOpenPolicy) ??
        current.popout.openPolicy,
      rememberPerSite: Boolean(popoutRememberSite?.checked),
      alwaysOnTop: Boolean(popoutAlwaysOnTop?.checked),
    },
    filter: {
      ngWords: linesFromTextarea(ngWords?.value ?? ""),
      ngRegex: Boolean(ngRegex?.checked),
      blockedUsers: linesFromTextarea(blockedUsers?.value ?? ""),
      hideCommands: Boolean(hideCommands?.checked),
      hideBots: Boolean(hideBots?.checked),
      protectRoles: Boolean(protectRoles?.checked),
      maxVisible: Number(maxVisible?.value ?? current.filter.maxVisible),
      applyToNativeChat: Boolean(filterNativeChat?.checked),
    },
    archive: {
      syncOffsetSec: Number(
        archiveOffset?.value ?? current.archive.syncOffsetSec,
      ),
      maxSkewSec: Number(archiveSkew?.value ?? current.archive.maxSkewSec),
    },
    compose: {
      enabled: Boolean(composeEnabled?.checked),
      stealShortcuts: Boolean(composeSteal?.checked),
    },
    twitch: {
      thirdPartyEmotes: Boolean(twitchThirdPartyEmotes?.checked),
    },
  };
  const patch = changedSettings(formBaseline ?? current, formPatch);
  if (Object.keys(patch).length) {
    try {
      formBaseline = await saveSettings(patch);
    } catch (error) {
      console.warn("[fce] options save rejected", error);
      showStatus(
        resolveLocale(currentLocale) === "ja"
          ? "設定を保存できませんでした。"
          : "Could not save settings.",
        true,
      );
      return;
    }
  } else {
    formBaseline = mergeSettings(formBaseline ?? current, formPatch);
  }

  currentLocale = current.uiLocale;
  await applyDomI18n(current.uiLocale, "optionsTitle");
  if (panelTitle) {
    panelTitle.textContent = t(current.uiLocale, TAB_TITLE_KEYS[activeTab]);
  }
  showSaved();
}

function schedulePersist(immediate = false): void {
  syncBadges();
  window.clearTimeout(saveTimer);
  if (immediate) {
    void persistFromForm();
    return;
  }
  saveTimer = setTimeout(() => {
    void persistFromForm();
  }, 280);
}

for (const item of navItems) {
  item.addEventListener("click", () => {
    const tab = item.dataset.tab as TabId | undefined;
    if (!tab) {
      return;
    }
    selectTab(tab);
  });
}

const autoSaveRoot = document.querySelector(".fce-main");
autoSaveRoot?.addEventListener("change", (event) => {
  // Import file picker must not auto-save the stale form over imported settings.
  // インポート用のファイルを選ぶ際に、フォームの古い値で設定を上書きしない。
  if (event.target === toolsImportFile) {
    return;
  }
  schedulePersist(true);
});
autoSaveRoot?.addEventListener("input", (event) => {
  const target = event.target;
  if (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && target.type === "range")
  ) {
    schedulePersist(false);
    return;
  }
  if (
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement &&
      (target.type === "checkbox" || target.type === "radio"))
  ) {
    // Checkboxes and selects also fire `change`; skip duplicate immediate IPC.
    return;
  }
  schedulePersist(true);
});

const toolsExport = document.querySelector<HTMLButtonElement>("#toolsExport");
const toolsImport = document.querySelector<HTMLButtonElement>("#toolsImport");
const toolsImportFile =
  document.querySelector<HTMLInputElement>("#toolsImportFile");
const toolsReset = document.querySelector<HTMLButtonElement>("#toolsReset");

toolsExport?.addEventListener("click", () => {
  void (async () => {
    const envelope = await exportSettingsBackup();
    const blob = new Blob([`${JSON.stringify(envelope, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = envelope.exportedAt.slice(0, 19).replaceAll(":", "-");
    anchor.href = url;
    anchor.download = `fullscreen-chat-settings-${stamp}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showSaved();
  })();
});

toolsImport?.addEventListener("click", () => {
  toolsImportFile?.click();
});

toolsImportFile?.addEventListener("change", () => {
  const file = toolsImportFile.files?.[0];
  toolsImportFile.value = "";
  if (!file) {
    return;
  }
  formGeneration++;
  void (async () => {
    try {
      if (file.size > MAX_SETTINGS_BYTES) throw new Error("Backup too large");
      window.clearTimeout(saveTimer);
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const next = await importSettingsBackup(parsed);
      if (!next) {
        showStatus(t(currentLocale, "toolsImportFailed"), true);
        return;
      }
      await fillForm(next);
      showStatus(t(currentLocale, "toolsImported"));
    } catch {
      showStatus(t(currentLocale, "toolsImportFailed"), true);
    }
  })();
});

toolsReset?.addEventListener("click", () => {
  if (!window.confirm(t(currentLocale, "toolsResetConfirm"))) {
    return;
  }
  void (async () => {
    formGeneration++;
    window.clearTimeout(saveTimer);
    const next = await resetSettingsToDefault();
    await fillForm(next);
    showStatus(t(currentLocale, "toolsResetDone"));
  })();
});

void loadSettings().then(async (settings) => {
  await fillForm(settings);
  selectTab("general");
});
