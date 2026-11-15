import type { SiteAdapter } from "../adapters/types";
import { createArchiveSync } from "../core/archive-sync";
import { applyNgFilter } from "../core/filter";
import type { NormalizedMessage, SiteKind } from "../core/message";
import { routeDisplay } from "../core/router";
import {
  loadSettings,
  saveSettings,
  watchSettings,
  type ExtensionSettings,
  type PanelBounds,
} from "../shared/settings";
import {
  resolveNativePanelChatUrl,
  resolvePopoutTargetForPolicy,
} from "../shared/site-ids";
import { getPageMediaTimeSec, watchMediaClock } from "../shared/video-clock";
import { getFeatureFlags } from "../shared/feature-flags";
import { createDanmakuView } from "../views/danmaku";
import { createOverlayPanel } from "../views/overlay-panel";
import {
  createPipChatController,
  isDocumentPipAvailable,
} from "../views/pip-chat";
import { createPopoutController } from "../views/popout";
export interface SiteRuntimeOptions {
  site: SiteKind;
  createAdapter: () => SiteAdapter;
  isSiteActive: () => boolean;
  isSiteEnabled: (settings: ExtensionSettings) => boolean;
  resolveMountParent: () => HTMLElement;
}

/**
 * Shared top-frame runtime for a site adapter + views.
 * サイト Adapter と View を束ねる共通トップフレーム実行部。
 */
export async function startSiteRuntime(
  options: SiteRuntimeOptions,
  signal?: AbortSignal,
): Promise<() => void> {
  let settings = await loadSettings();
  // A cached page may already have a new runtime by the time storage responds.
  if (signal?.aborted) return () => {};

  let active = false;
  let disposeActive: (() => void) | null = null;
  let cancelled = false;

  const tryActivate = () => {
    if (cancelled || active) {
      return;
    }
    // Master toggle must gate mount — player chrome can flip `enabled` back on.
    // マスタトグルでマウントを抑止。プレイヤーボタンから再有効化できる。
    if (
      !settings.enabled ||
      !options.isSiteEnabled(settings) ||
      !options.isSiteActive()
    ) {
      return;
    }
    active = true;
    disposeActive = startActiveRuntime(
      options,
      () => settings,
      (next) => {
        settings = next;
      },
    );
  };

  tryActivate();

  const pageObserver = new MutationObserver(() => {
    if (!active) {
      tryActivate();
      return;
    }
    if (!options.isSiteActive()) {
      disposeActive?.();
      disposeActive = null;
      active = false;
    }
  });
  pageObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  const unwatch = watchSettings((next) => {
    settings = next;
    if (!options.isSiteEnabled(next) || !next.enabled) {
      disposeActive?.();
      disposeActive = null;
      active = false;
      return;
    }
    if (!active) {
      tryActivate();
    }
  });

  return () => {
    cancelled = true;
    unwatch();
    pageObserver.disconnect();
    disposeActive?.();
    disposeActive = null;
  };
}

function startActiveRuntime(
  options: SiteRuntimeOptions,
  getSettings: () => ExtensionSettings,
  setSettings: (settings: ExtensionSettings) => void,
): () => void {
  const messages: NormalizedMessage[] = [];
  const seenIds = new Set<string>();
  let lastDanmakuId: string | null = null;
  let lastPopoutDesired = false;
  let lastPipDesired = false;
  let panelMounted = false;
  let danmakuMounted = false;
  let lastShowDanmaku = false;
  let disposed = false;
  let pipGeneration = 0;

  const adapter = options.createAdapter();
  const panel = createOverlayPanel({
    onSend: (text, replyToId) =>
      replyToId
        ? (adapter.replyTo?.(replyToId, text) ?? Promise.resolve(false))
        : (adapter.sendMessage?.(text) ?? Promise.resolve(false)),
    onPositionChange: (position) => {
      void persistPanelPosition(position);
    },
    onQuickPanelChange: (patch) => {
      void saveSettings({ panel: patch });
    },
    onOpenOptions: () => {
      void browser.runtime.openOptionsPage();
    },
  });
  const danmaku = createDanmakuView();
  const popout = createPopoutController({
    resolveTarget: () =>
      resolvePopoutTargetForPolicy(getSettings().popout.openPolicy),
  });
  const pipChat = createPipChatController({
    onSend: (text) => adapter.sendMessage?.(text) ?? Promise.resolve(false),
  });
  ensureRuntimeMounted(getSettings(), options.resolveMountParent());

  const archiveSync = createArchiveSync({
    getOffsetSec: () => getSettings().archive.syncOffsetSec,
    getMaxSkewSec: () => getSettings().archive.maxSkewSec,
    onDue: (message) => {
      const settings = getSettings();
      const allowed =
        message.isSelf ||
        applyNgFilter([message], settings.filter).visible.length > 0;
      if (!allowed) {
        return;
      }
      rememberMessage(message);
      publish(message);
    },
  });

  adapter.start((message) => {
    if (seenIds.has(message.id)) {
      // React hydration can finish an already displayed live row in later tasks.
      const index = messages.findIndex((item) => item.id === message.id);
      if (
        options.site === "twitch" &&
        message.videoOffsetSec === undefined &&
        index >= 0
      ) {
        messages[index] = message;
        publish();
        if (routeDisplay(options.site, getSettings()).showDanmaku) {
          const visible = Boolean(
            message.isSelf ||
            applyNgFilter([message], getSettings().filter).visible.length,
          );
          danmaku.update(message, visible);
        }
      }
      return;
    }
    seenIds.add(message.id);
    if (message.videoOffsetSec !== undefined) {
      // Archive/VOD — hold until media clock catches up.
      // アーカイブ／VOD は再生時刻に合わせて解放。
      archiveSync.ingest(message);
      const media = getPageMediaTimeSec();
      if (media !== null) {
        archiveSync.onMediaTime(media, { seeked: false });
        refreshArchivePanel(media);
      }
      return;
    }
    rememberMessage(message);
    publish(message);
  });

  const stopMediaClock = watchMediaClock((timeSec, meta) => {
    if (meta.seeked) {
      lastDanmakuId = null;
    }
    archiveSync.onMediaTime(timeSec, meta);
    refreshArchivePanel(timeSec);
  });

  const unwatch = watchSettings((next, previous) => {
    setSettings(next);
    const modeChanged = previous?.displayMode !== next.displayMode;
    const enabledChanged = previous?.enabled !== next.enabled;
    const panelNativeChanged =
      previous?.panel.useNativeChat !== next.panel.useNativeChat;
    const popoutPolicyChanged =
      previous?.popout.openPolicy !== next.popout.openPolicy ||
      previous?.popout.alwaysOnTop !== next.popout.alwaysOnTop;
    const archiveChanged =
      previous?.archive.syncOffsetSec !== next.archive.syncOffsetSec ||
      previous?.archive.maxSkewSec !== next.archive.maxSkewSec;
    const meaningful =
      !previous ||
      modeChanged ||
      enabledChanged ||
      panelNativeChanged ||
      popoutPolicyChanged ||
      archiveChanged ||
      previous.panel.anchor !== next.panel.anchor ||
      previous.panel.widthRatio !== next.panel.widthRatio ||
      previous.panel.opacity !== next.panel.opacity ||
      previous.panel.fontSizePx !== next.panel.fontSizePx ||
      previous.panel.idleFade !== next.panel.idleFade ||
      previous.panel.allowPointer !== next.panel.allowPointer ||
      !samePanelPosition(previous.panel.position, next.panel.position) ||
      previous.danmaku.enabled !== next.danmaku.enabled ||
      previous.danmakuOverlayOnPanel !== next.danmakuOverlayOnPanel ||
      previous.compose.enabled !== next.compose.enabled;

    if (meaningful) {
      ensureRuntimeMounted(next, options.resolveMountParent(), {
        syncPopoutUrl: modeChanged || popoutPolicyChanged,
      });
    } else {
      panel.applySettings(next);
      danmaku.applySettings(next);
    }
    const media = getPageMediaTimeSec();
    if (media !== null && archiveChanged) {
      archiveSync.onMediaTime(media, { seeked: true });
      refreshArchivePanel(media);
    }
    publish();
  });

  const onFullscreen = () => {
    panel.reparentForFullscreen();
    danmaku.reparentForFullscreen();
  };
  document.addEventListener("fullscreenchange", onFullscreen);

  const onKeydown = (event: KeyboardEvent) => {
    if (!getSettings().compose.stealShortcuts) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(".fce-panel-input") && event.code === "Space") {
      event.stopPropagation();
    }
  };
  window.addEventListener("keydown", onKeydown, true);

  const onCommand: Parameters<
    typeof browser.runtime.onMessage.addListener
  >[0] = (message) => {
    if (
      message?.type !== "fce:command" ||
      message.command !== "toggle-compose-focus"
    )
      return;
    const route = routeDisplay(options.site, getSettings());
    if (route.showPanel) panel.focusCompose();
    else if (pipChat.isOpen()) pipChat.focusCompose();
    else if (route.showPopout) popout.focus();
  };
  browser.runtime.onMessage.addListener(onCommand);
  publish();

  return () => {
    disposed = true;
    pipGeneration++;
    browser.runtime.onMessage.removeListener(onCommand);
    unwatch();
    stopMediaClock();
    archiveSync.reset();
    adapter.stop();
    panel.unmount();
    danmaku.unmount();
    panelMounted = false;
    danmakuMounted = false;
    if (lastPipDesired) {
      pipChat.close();
      lastPipDesired = false;
    }
    if (lastPopoutDesired) {
      popout.close();
      lastPopoutDesired = false;
    }
    document.removeEventListener("fullscreenchange", onFullscreen);
    window.removeEventListener("keydown", onKeydown, true);
  };

  function rememberMessage(message: NormalizedMessage): void {
    if (messages.some((entry) => entry.id === message.id)) {
      return;
    }
    messages.push(message);
    while (messages.length > 500) {
      const removed = messages.shift();
      if (removed) {
        seenIds.delete(removed.id);
      }
    }
  }

  function refreshArchivePanel(mediaSec: number): void {
    const settings = getSettings();
    const route = routeDisplay(options.site, settings);
    if (
      !route.showPanel ||
      resolvePanelNativeUrl(options.site, settings) ||
      archiveSync.size() === 0
    ) {
      return;
    }
    const timed = archiveSync.visibleUpTo(mediaSec);
    const filtered = applyNgFilter(timed, settings.filter).visible;
    panel.setMessages(filtered);
  }

  function publish(incoming?: NormalizedMessage): void {
    const settings = getSettings();
    const route = routeDisplay(options.site, settings);
    const filtered = applyNgFilter(messages, settings.filter).visible;
    if (route.showPanel) {
      panel.applySettings(settings);
      panel.setNativeChatUrl(resolvePanelNativeUrl(options.site, settings));
      // Native replay UI syncs itself; custom list uses timed history when available.
      // 公式リプレイは自前同期。自前リストは時刻付き履歴を優先。
      const media = getPageMediaTimeSec();
      if (
        !resolvePanelNativeUrl(options.site, settings) &&
        media !== null &&
        archiveSync.size() > 0
      ) {
        panel.setMessages(
          applyNgFilter(archiveSync.visibleUpTo(media), settings.filter)
            .visible,
        );
      } else {
        panel.setMessages(filtered);
      }
      panel.reparentForFullscreen();
    }
    if (route.showDanmaku) {
      danmaku.applySettings(settings);
      danmaku.reparentForFullscreen();
      if (incoming) {
        const stillVisible =
          incoming.isSelf || filtered.some((item) => item.id === incoming.id);
        if (stillVisible && incoming.id !== lastDanmakuId) {
          lastDanmakuId = incoming.id;
          danmaku.push(incoming);
        }
      }
    }
    if (route.showPopout) {
      const visible = filtered.slice(-settings.filter.maxVisible);
      if (lastPipDesired || pipChat.isOpen()) {
        pipChat.setMessages(visible);
      }
    }
  }

  function syncPopout(
    shouldShow: boolean,
    mountOptions?: { syncUrl?: boolean },
  ): void {
    const settings = getSettings();
    const target = resolvePopoutTargetForPolicy(settings.popout.openPolicy);
    const wantPip =
      shouldShow &&
      settings.popout.alwaysOnTop &&
      (isDocumentPipAvailable() || getFeatureFlags().documentPip);
    const wantWindow = shouldShow && target !== null && !wantPip;

    if (wantPip) {
      if (lastPopoutDesired || popout.isOpen()) {
        lastPopoutDesired = false;
        popout.close();
      }
      if (!lastPipDesired || !pipChat.isOpen()) {
        lastPipDesired = true;
        const requested = ++pipGeneration;
        void pipChat.open().then((opened) => {
          if (disposed || requested !== pipGeneration || !lastPipDesired)
            return;
          if (!opened) {
            // PiP unavailable or gesture blocked — fall back to OS popout.
            // PiP 不可／ジェスチャ不足時は通常別窓へフォールバック。
            lastPipDesired = false;
            if (target) {
              lastPopoutDesired = true;
              popout.open();
            }
            return;
          }
          const filtered = applyNgFilter(
            messages,
            getSettings().filter,
          ).visible.slice(-getSettings().filter.maxVisible);
          pipChat.setMessages(filtered);
        });
      }
      return;
    }

    if (lastPipDesired || pipChat.isOpen()) {
      pipGeneration++;
      lastPipDesired = false;
      pipChat.close();
    }

    const allowed = wantWindow;
    if (allowed) {
      if (!lastPopoutDesired) {
        lastPopoutDesired = true;
        popout.open();
        return;
      }
      if (mountOptions?.syncUrl) {
        popout.sync();
      }
      return;
    }
    if (lastPopoutDesired || popout.isOpen()) {
      lastPopoutDesired = false;
      popout.close();
    }
  }

  function ensureRuntimeMounted(
    next: ExtensionSettings,
    parent: HTMLElement,
    mountOptions?: { syncPopoutUrl?: boolean },
  ): void {
    const route = routeDisplay(options.site, next);
    if (!next.enabled) {
      if (panelMounted) {
        panel.unmount();
        panelMounted = false;
      }
      if (danmakuMounted) {
        danmaku.unmount();
        danmakuMounted = false;
      }
      lastShowDanmaku = false;
      syncPopout(false);
      return;
    }
    if (route.showPanel) {
      if (!panelMounted) {
        panel.mount(parent);
        panelMounted = true;
      }
      panel.applySettings(next);
      panel.setNativeChatUrl(resolvePanelNativeUrl(options.site, next));
    } else if (panelMounted) {
      panel.unmount();
      panelMounted = false;
    }
    if (route.showDanmaku) {
      const becomingVisible = !danmakuMounted || !lastShowDanmaku;
      if (!danmakuMounted) {
        danmaku.mount(parent);
        danmakuMounted = true;
      }
      danmaku.applySettings(next);
      if (becomingVisible) {
        const filtered = applyNgFilter(messages, next.filter).visible;
        danmaku.flush(filtered);
      }
      lastShowDanmaku = true;
    } else if (danmakuMounted) {
      danmaku.unmount();
      danmakuMounted = false;
      lastShowDanmaku = false;
    } else {
      lastShowDanmaku = false;
    }
    syncPopout(route.showPopout, {
      syncUrl: mountOptions?.syncPopoutUrl === true,
    });
  }

  async function persistPanelPosition(position: PanelBounds): Promise<void> {
    const current = getSettings();
    if (samePanelPosition(current.panel.position, position)) {
      return;
    }
    await saveSettings({
      panel: {
        position,
      },
    });
    // Storage notifications are authoritative; an older write reply must not
    // replace a newer settings snapshot from another extension page.
  }
}

function samePanelPosition(
  left: PanelBounds | undefined,
  right: PanelBounds | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.w === right.w &&
    left.h === right.h
  );
}

function resolvePanelNativeUrl(
  site: SiteKind,
  settings: ExtensionSettings,
): string | null {
  if (!settings.panel.useNativeChat || site === "youtube-comments") {
    return null;
  }
  return resolveNativePanelChatUrl(location.href);
}
