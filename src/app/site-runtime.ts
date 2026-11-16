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
  EXTENSION_CHAT_PUSH_TYPE,
  EXTENSION_CHAT_READY_TYPE,
  EXTENSION_CHAT_SEND_TYPE,
  isExtensionChatRuntimeMessage,
  resolveExtensionChatPopoutUrl,
} from "../shared/runtime-messages";
import {
  resolveNativePanelChatUrl,
  resolvePopoutTargetForPolicy,
  type PopoutTarget,
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
import {
  createYouTubeCommentsPortal,
  type YouTubeCommentsPortal,
} from "./youtube-comments-portal";
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

  // Brief isSiteActive false (live UI flicker) must not tear down the runtime.
  // ライブ UI 瞬断だけで runtime を破棄しない（ISS-023 レビュー）。
  let deactivateTimer: number | null = null;
  const clearDeactivateTimer = () => {
    if (deactivateTimer !== null) {
      window.clearTimeout(deactivateTimer);
      deactivateTimer = null;
    }
  };
  const pageObserver = new MutationObserver(() => {
    if (!active) {
      clearDeactivateTimer();
      tryActivate();
      return;
    }
    if (options.isSiteActive()) {
      clearDeactivateTimer();
      return;
    }
    if (deactivateTimer !== null) {
      return;
    }
    deactivateTimer = window.setTimeout(() => {
      deactivateTimer = null;
      if (cancelled || !active || options.isSiteActive()) {
        return;
      }
      disposeActive?.();
      disposeActive = null;
      active = false;
    }, 3000);
  });
  pageObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  const unwatch = watchSettings((next) => {
    settings = next;
    if (!options.isSiteEnabled(next) || !next.enabled) {
      clearDeactivateTimer();
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
    clearDeactivateTimer();
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
  // Official iframe returned "chat disabled" — keep self-rendered list (ISS-022).
  // 公式 iframe がチャット無効なら自前リストに落とす。
  let nativeChatRejected = false;
  let lastNativeUrlAttempt: string | null = null;
  // Comments portal could not find ytd-comments — fall back to scrape list (ISS-026).
  // 通常コメント節が見つからないときは自前リストへ。
  let commentsPortalFailed = false;
  let adapterRunning = false;

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
    onNativeChatRejected: () => {
      if (disposed || nativeChatRejected) {
        return;
      }
      nativeChatRejected = true;
      panel.setNativeChatUrl(null);
      // Clear panel native URL so the list surface shows; adapter interval
      // recreates the hidden receiver when the panel frame is gone.
      // パネル公式枠を外して自前リストへ。隠し受信は adapter 側 interval が立て直す。
      ensureRuntimeMounted(getSettings(), options.resolveMountParent());
    },
  });
  const commentsPortal: YouTubeCommentsPortal | null =
    options.site === "youtube-comments"
      ? createYouTubeCommentsPortal({
          resolveHost: () => panel.getNativePortalHost(),
          onUnavailable: () => {
            if (disposed || commentsPortalFailed) {
              return;
            }
            commentsPortalFailed = true;
            panel.setNativePortalActive(false);
            commentsPortal?.sync(false);
            ensureCommentsAdapterRunning(true);
            ensureRuntimeMounted(getSettings(), options.resolveMountParent());
          },
        })
      : null;
  const danmaku = createDanmakuView();
  const popout = createPopoutController({
    resolveTarget: () => resolveRuntimePopoutTarget(getSettings()),
  });
  const pipChat = createPipChatController({
    onSend: (text) => adapter.sendMessage?.(text) ?? Promise.resolve(false),
  });

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

  // Mount after archiveSync exists — adapter callbacks may fire synchronously.
  // adapter が同期で発火しうるため、archiveSync 初期化後にマウントする。
  ensureRuntimeMounted(getSettings(), options.resolveMountParent());
  ensureCommentsAdapterRunning(!wantsCommentsPortal(getSettings()));

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
    if (panelNativeChanged) {
      commentsPortalFailed = false;
    }
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

  const onRuntimeMessage: Parameters<
    typeof browser.runtime.onMessage.addListener
  >[0] = (message) => {
    if (
      message?.type === "fce:command" &&
      message.command === "toggle-compose-focus"
    ) {
      const route = routeDisplay(options.site, getSettings());
      if (route.showPanel) panel.focusCompose();
      else if (pipChat.isOpen()) pipChat.focusCompose();
      else if (route.showPopout) popout.focus();
      return;
    }
    if (!isExtensionChatRuntimeMessage(message) || disposed) {
      return;
    }
    if (message.type === EXTENSION_CHAT_READY_TYPE) {
      pushExtensionChatMessages();
      return;
    }
    if (message.type === EXTENSION_CHAT_SEND_TYPE) {
      const text = typeof message.text === "string" ? message.text.trim() : "";
      if (!text) {
        return;
      }
      void adapter.sendMessage?.(text);
    }
  };
  browser.runtime.onMessage.addListener(onRuntimeMessage);
  publish();

  return () => {
    disposed = true;
    pipGeneration++;
    browser.runtime.onMessage.removeListener(onRuntimeMessage);
    unwatch();
    stopMediaClock();
    archiveSync.reset();
    // Restore ytd-comments before tearing down the portal host.
    // ポータルホスト破棄前に公式ノードをページへ戻す。
    commentsPortal?.dispose();
    if (adapterRunning) {
      adapter.stop();
      adapterRunning = false;
    }
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

  function wantsCommentsPortal(next: ExtensionSettings): boolean {
    // Portal is panel-only; popout uses the scraped extension list (ISS-003).
    // ポータルはパネル専用。別窓は scrape した拡張リスト（ISS-003）。
    const route = routeDisplay(options.site, next);
    return (
      options.site === "youtube-comments" &&
      next.panel.useNativeChat &&
      !commentsPortalFailed &&
      route.showPanel
    );
  }

  function ensureCommentsAdapterRunning(shouldRun: boolean): void {
    if (shouldRun) {
      if (adapterRunning) {
        return;
      }
      adapterRunning = true;
      adapter.start(onAdapterMessage);
      return;
    }
    if (!adapterRunning) {
      return;
    }
    adapter.stop();
    adapterRunning = false;
  }

  function onAdapterMessage(message: NormalizedMessage): void {
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
  }

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
      resolvePanelNativeUrlForMount(settings) ||
      wantsCommentsPortal(settings) ||
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
      const nativeUrl = resolvePanelNativeUrlForMount(settings);
      panel.setNativeChatUrl(nativeUrl);
      syncCommentsPortalSurface(settings);
      // Native replay / portal UI sync themselves; custom list uses timed history.
      // 公式リプレイ／ポータルは自前同期。自前リストは時刻付き履歴を優先。
      const media = getPageMediaTimeSec();
      if (wantsCommentsPortal(settings) || nativeUrl) {
        // Official surface — do not push scraped rows into the hidden list.
        // 公式面表示中は隠れリストへ scrape 行を送らない。
      } else if (media !== null && archiveSync.size() > 0) {
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
      if (usesExtensionChatPopout() && (lastPopoutDesired || popout.isOpen())) {
        pushExtensionChatMessages(visible);
      }
    }
  }

  function usesExtensionChatPopout(): boolean {
    return options.site === "youtube-comments";
  }

  function resolveRuntimePopoutTarget(
    settings: ExtensionSettings,
  ): PopoutTarget | null {
    if (usesExtensionChatPopout()) {
      // No official comments URL — open the extension-owned list page (ISS-003).
      // 公式コメント別窓は無いので拡張自前ページを開く。
      return {
        siteKey: "youtube",
        url: resolveExtensionChatPopoutUrl(),
      };
    }
    return resolvePopoutTargetForPolicy(settings.popout.openPolicy);
  }

  function pushExtensionChatMessages(
    rows?: ReturnType<typeof applyNgFilter>["visible"],
  ): void {
    if (!usesExtensionChatPopout() || disposed) {
      return;
    }
    const settings = getSettings();
    const visible = (
      rows ?? applyNgFilter(messages, settings.filter).visible
    ).slice(-settings.filter.maxVisible);
    void browser.runtime
      .sendMessage({
        type: EXTENSION_CHAT_PUSH_TYPE,
        messages: visible.map((message) => ({
          id: message.id,
          authorName: message.authorName,
          text: message.text,
        })),
      })
      .catch(() => undefined);
  }

  function syncPopout(
    shouldShow: boolean,
    mountOptions?: { syncUrl?: boolean },
  ): void {
    const settings = getSettings();
    const target = resolveRuntimePopoutTarget(settings);
    const pipAvailable =
      isDocumentPipAvailable() || getFeatureFlags().documentPip;
    // alwaysOnTop → Document PiP; otherwise OS window (official or extension page).
    // 常時前面なら Document PiP。それ以外は OS 別窓（公式または拡張ページ）。
    const wantPip = shouldShow && pipAvailable && settings.popout.alwaysOnTop;
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
              pushExtensionChatMessages();
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
        pushExtensionChatMessages();
        return;
      }
      if (mountOptions?.syncUrl) {
        popout.sync();
      }
      pushExtensionChatMessages();
      return;
    }
    if (lastPopoutDesired || popout.isOpen()) {
      lastPopoutDesired = false;
      popout.close();
    }
  }

  function resolvePanelNativeUrlForMount(
    next: ExtensionSettings,
  ): string | null {
    // Comments use DOM portal, not an iframe URL (ISS-026).
    // 通常コメントは iframe URL ではなく DOM ポータル。
    if (!next.panel.useNativeChat || options.site === "youtube-comments") {
      return null;
    }
    const url = resolveNativePanelChatUrl(location.href);
    // Retry when the candidate URL changes (SPA / chatframe hydration).
    // URL が変わったら拒否フラグを戻して再試行する。
    if (url !== lastNativeUrlAttempt) {
      lastNativeUrlAttempt = url;
      nativeChatRejected = false;
    }
    if (nativeChatRejected) {
      return null;
    }
    return url;
  }

  function syncCommentsPortalSurface(next: ExtensionSettings): void {
    if (!commentsPortal) {
      return;
    }
    const wantPortal = wantsCommentsPortal(next);
    panel.setNativePortalActive(wantPortal);
    commentsPortal.sync(wantPortal);
    ensureCommentsAdapterRunning(!wantPortal);
  }

  function ensureRuntimeMounted(
    next: ExtensionSettings,
    parent: HTMLElement,
    mountOptions?: { syncPopoutUrl?: boolean },
  ): void {
    const route = routeDisplay(options.site, next);
    if (!next.enabled) {
      commentsPortal?.sync(false);
      panel.setNativePortalActive(false);
      ensureCommentsAdapterRunning(false);
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
      panel.setNativeChatUrl(resolvePanelNativeUrlForMount(next));
      syncCommentsPortalSurface(next);
    } else if (panelMounted) {
      commentsPortal?.sync(false);
      panel.setNativePortalActive(false);
      ensureCommentsAdapterRunning(true);
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
