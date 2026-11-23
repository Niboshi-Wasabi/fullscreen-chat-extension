import type { SiteAdapter } from "../adapters/types";
import { createArchiveSync } from "../core/archive-sync";
import { applyNgFilter, shouldDropMessage } from "../core/filter";
import {
  createLiveDelayBuffer,
  mergeLiveBridgeMessages,
  type TimedBridgeMessage,
} from "../core/live-delay-buffer";
import type { NormalizedMessage, SiteKind } from "../core/message";
import { routeDisplay } from "../core/router";
import {
  BRIDGE_POPOUT_SYNC_TYPE,
  type BridgeSourceSummary,
} from "../shared/bridge-messages";
import {
  loadSettings,
  saveSettings,
  watchSettings,
  type ExtensionSettings,
  type PanelBounds,
} from "../shared/settings";
import {
  buildBridgePopoutUrl,
  isTrustedExtensionSender,
} from "../shared/runtime-messages";
import {
  ensureYouTubeChatFrameSrc,
  resolveNativePanelChatUrl,
  resolvePopoutTargetForPolicy,
  type PopoutTarget,
} from "../shared/site-ids";
import {
  isPageChatColumnOpen,
  shouldMountVideoPanel,
} from "../shared/page-chat-column";
import {
  getLivePlaybackInterruption,
  getPageMediaTimeSec,
  watchLivePlaybackInterruptions,
  watchMediaClock,
  type LivePlaybackInterruption,
} from "../shared/video-clock";
import { createDanmakuView } from "../views/danmaku";
import {
  createOverlayPanel,
  type OverlayBridgeSourceOption,
  type OverlayBridgeState,
} from "../views/overlay-panel";
import {
  createPipChatController,
  isDocumentPipAvailable,
} from "../views/pip-chat";
import { createPopoutController } from "../views/popout";
import { createBridgePublisher, createBridgeSubscriber } from "./bridge-client";
export interface SiteRuntimeContext {
  needsDomMessages?: () => boolean;
}

export interface SiteRuntimeOptions {
  site: SiteKind;
  createAdapter: (context?: SiteRuntimeContext) => SiteAdapter;
  isSiteActive: () => boolean;
  isSiteEnabled: (settings: ExtensionSettings) => boolean;
  resolveMountParent: () => HTMLElement;
  isCrossSiteBridgeEligible?: () => boolean;
  resolveBridgeChannelLogin?: () => string | null;
  resolveBridgeLabel?: () => string | null;
}

/**
 * Shared top-frame runtime for a site adapter + views.
 * トップフレームでサイトのアダプタと View を連携させる共通処理。
 */
export async function startSiteRuntime(
  options: SiteRuntimeOptions,
  signal?: AbortSignal,
): Promise<() => void> {
  let settings = await loadSettings();
  // A cached page may already have a new runtime by the time storage responds.
  if (signal?.aborted) {
    return () => {};
  }

  let active = false;
  let activeRuntime: {
    dispose: () => void;
    syncMountParent: () => void;
  } | null = null;
  let cancelled = false;

  const tryActivate = () => {
    if (cancelled || active) {
      return;
    }
    // Master toggle must gate mount — player chrome can flip `enabled` back on.
    // マスタトグルでマウントを抑止。プレイヤーボタンから再有効化できる。
    const masterEnabled = settings.enabled;
    const siteEnabled = options.isSiteEnabled(settings);
    const siteActive = options.isSiteActive();
    if (!masterEnabled || !siteEnabled || !siteActive) {
      return;
    }
    activeRuntime = startActiveRuntime(
      options,
      () => settings,
      (next) => {
        settings = next;
      },
    );
    active = true;
  };

  tryActivate();

  // Brief isSiteActive false (live UI flicker) must not tear down the runtime.
  // ライブ UI が一時的に消えても、それだけで runtime を破棄しない（ISS-023 レビュー）。
  let deactivateTimer: number | null = null;
  const clearDeactivateTimer = () => {
    if (deactivateTimer !== null) {
      window.clearTimeout(deactivateTimer);
      deactivateTimer = null;
    }
  };
  const pageObserver = new MutationObserver((mutations) => {
    // Ignore our own overlay attribute updates to avoid re-checking on self changes.
    if (
      mutations.length > 0 &&
      mutations.every(
        (m) =>
          m.type === "attributes" &&
          m.target instanceof Element &&
          Boolean(m.target.closest("[data-fce-view]")),
      )
    ) {
      return;
    }
    if (!active) {
      clearDeactivateTimer();
      tryActivate();
      return;
    }
    if (options.isSiteActive()) {
      clearDeactivateTimer();
      activeRuntime?.syncMountParent();
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
      activeRuntime?.dispose();
      activeRuntime = null;
      active = false;
    }, 3000);
  });
  pageObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["collapsed", "hidden", "aria-label", "class"],
  });

  const unwatch = watchSettings((next) => {
    settings = next;
    if (!options.isSiteEnabled(next) || !next.enabled) {
      clearDeactivateTimer();
      activeRuntime?.dispose();
      activeRuntime = null;
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
    activeRuntime?.dispose();
    activeRuntime = null;
  };
}

/** Hidden tabs must not touch the single shared popout window. */
function canClaimPopout(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState !== "hidden"
  );
}

function startActiveRuntime(
  options: SiteRuntimeOptions,
  getSettings: () => ExtensionSettings,
  setSettings: (settings: ExtensionSettings) => void,
): { dispose: () => void; syncMountParent: () => void } {
  const messages: NormalizedMessage[] = [];
  const seenIds = new Set<string>();
  let lastDanmakuId: string | null = null;
  let lastPopoutDesired = false;
  let lastPipDesired = false;
  // PiP was refused for want of a click; keep the OS popout until the mode
  // changes, or every page focus would close it to retry PiP.
  // クリックが無く PiP が断られた。モードが変わるまで通常別窓を保つ。
  // 保たないとページへフォーカスが戻るたびに閉じて PiP を試し直す。
  let pipFellBack = false;
  // The user closed PiP. Until the switch back to the panel lands, a focus
  // must not ask for PiP again or open the OS popout fallback instead.
  // 利用者が PiP を閉じた。パネルへの切替が届くまで、フォーカスで PiP を
  // 求め直したり代わりに通常別窓を開いたりしない。
  let pipClosedByUser = false;
  // Set by "Pin on top" while `saveSettings({ displayMode: "popout" })` is still in flight.
  let pipPinPending = false;
  let panelMounted = false;
  let danmakuMounted = false;
  let disposed = false;
  let pipGeneration = 0;
  // Official iframe returned "chat disabled" — keep self-rendered list (ISS-022).
  // 公式 iframe がチャット無効の画面を返したら、拡張機能のリストに切り替える。
  let nativeChatRejected = false;
  let lastNativeUrlAttempt: string | null = null;
  let rejectedPipNativeUrl: string | null = null;
  let adapterRunning = false;
  let currentMountParent: HTMLElement | null = null;
  let mountRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let mountRetryCount = 0;
  let mediaSeeking = false;
  let lastVideoPanelMounted: boolean | null = null;
  let danmakuBurstWindowStartMs = 0;
  let danmakuBurstCount = 0;
  let displayOrderSeq = 0;
  const localOrderById = new Map<
    string,
    { displayOrderMs: number; orderSeq: number }
  >();
  const remoteOrderById = new Map<
    string,
    { displayOrderMs: number; orderSeq: number }
  >();
  let pendingDanmakuRemote: NormalizedMessage[] = [];
  let captureDanmakuOnRelease = false;
  const recentDanmakuKeys: string[] = [];
  const recentDanmakuKeySet = new Set<string>();
  const bridgeSupported = options.isCrossSiteBridgeEligible
    ? options.isCrossSiteBridgeEligible()
    : false;
  const liveDelayBuffer = bridgeSupported
    ? createLiveDelayBuffer({
        initialDelaySec: 0,
        getMaxVisible: () => getSettings().filter.maxVisible,
        onRelease: (released, releasedAtMs) => {
          for (const item of released) {
            remoteOrderById.set(item.id, {
              displayOrderMs: releasedAtMs,
              orderSeq: ++displayOrderSeq,
            });
            if (captureDanmakuOnRelease) {
              pendingDanmakuRemote.push(item);
            }
          }
        },
        onVisibleUpdate: (updated) => {
          const current = getSettings();
          if (routeDisplay(current).showDanmaku) {
            const visible = !shouldDropMessage(updated, current.filter);
            danmaku.update(updated, visible);
          }
        },
      })
    : null;
  let bridgeSources: OverlayBridgeSourceOption[] = [];
  let activeBridgeSource: BridgeSourceSummary | null = null;
  let bridgeTickTimer: ReturnType<typeof setInterval> | null = null;
  let stopInterruptWatch: (() => void) | null = null;
  let bridgeSelectionSeq = 0;

  function tickBufferWithDanmaku(nowMs: number): boolean {
    if (!liveDelayBuffer) {
      return false;
    }
    captureDanmakuOnRelease = true;
    try {
      return liveDelayBuffer.tick(nowMs);
    } finally {
      captureDanmakuOnRelease = false;
    }
  }

  const bridgePublisher =
    bridgeSupported && options.resolveBridgeChannelLogin
      ? createBridgePublisher({
          site: options.site,
          attachListener: false,
          getChannelLogin: () =>
            options.isCrossSiteBridgeEligible &&
            !options.isCrossSiteBridgeEligible()
              ? null
              : (options.resolveBridgeChannelLogin?.() ?? null),
          getLabel: options.resolveBridgeLabel,
        })
      : null;

  const bridgeSubscriber = bridgeSupported
    ? createBridgeSubscriber({
        localSite: options.site,
        attachListener: false,
        onBatch: ({ sourceTabId, site, items }) => {
          if (
            disposed ||
            !activeBridgeSource ||
            activeBridgeSource.tabId !== sourceTabId ||
            activeBridgeSource.site !== site ||
            site === options.site ||
            !liveDelayBuffer
          ) {
            return;
          }
          for (const item of items) {
            if (item.message.site !== site) {
              continue;
            }
            liveDelayBuffer.ingest(item.message, item.receivedAtMs);
          }
          if (tickBufferWithDanmaku(Date.now())) {
            publish();
          }
        },
        onSourceStatus: ({ sourceTabId, status }) => {
          if (
            disposed ||
            !activeBridgeSource ||
            activeBridgeSource.tabId !== sourceTabId
          ) {
            return;
          }
          if (status === "closed" || status === "channel-changed") {
            detachBridgeSource({
              alreadyUnsubscribed: true,
              refreshSources: true,
            });
          }
        },
      })
    : null;

  const needsDomMessages = (): boolean => {
    const current = getSettings();
    if (!current.enabled || !options.isSiteEnabled(current)) {
      return false;
    }
    if (bridgePublisher?.hasSubscribers() || activeBridgeSource !== null) {
      return true;
    }
    const route = routeDisplay(current);
    if (route.showDanmaku) {
      return true;
    }
    if (route.showPanel && resolvePanelNativeUrlForMount(current) === null) {
      return true;
    }
    if (
      route.showPopout &&
      (lastPipDesired || pipChat.isOpen()) &&
      resolvePipNativeUrl(current) === null
    ) {
      return true;
    }
    return false;
  };
  const adapter = options.createAdapter({ needsDomMessages });
  const panel = createOverlayPanel({
    site: options.site,
    onSend: (text) => adapter.sendMessage?.(text) ?? Promise.resolve(false),
    onPositionChange: (position) => {
      void persistPanelPosition(position).catch((error: unknown) => {
        console.warn("[fce] persist panel position failed", error);
      });
    },
    onQuickPanelChange: (patch) => {
      void saveSettings({ panel: patch }).catch((error: unknown) => {
        console.warn("[fce] quick panel save failed", error);
      });
    },
    onOpenOptions: () => {
      try {
        void browser.runtime.openOptionsPage().catch((error: unknown) => {
          console.warn("[fce] openOptionsPage failed", error);
        });
      } catch (error: unknown) {
        console.warn("[fce] openOptionsPage failed", error);
      }
    },
    onPinOnTop: pinChatOnTop,
    onNativeChatRejected: () => {
      if (disposed || nativeChatRejected) {
        return;
      }
      nativeChatRejected = true;
      panel.setNativeChatUrl(null);
      // Clear panel native URL so the list surface shows; adapter interval
      // recreates the hidden receiver when the panel frame is gone.
      // パネル公式枠を外して自前リストへ。画面外での受信はアダプタの定期処理で再開する。
      ensureRuntimeMounted(getSettings(), options.resolveMountParent());
      publish();
    },
    ...(bridgeSupported
      ? {
          bridge: {
            onRefreshSources: () => {
              void refreshBridgeSources();
            },
            onSelectSource: (tabId: number | null) => {
              void selectBridgeSource(tabId);
            },
            onAdjustDelay: (deltaSec: number) => {
              if (disposed || !liveDelayBuffer || !activeBridgeSource) {
                return;
              }
              liveDelayBuffer.setDelaySec(
                liveDelayBuffer.getDelaySec() + deltaSec,
              );
              const changed = tickBufferWithDanmaku(Date.now());
              syncPanelBridgeState();
              if (changed) {
                publish();
              } else {
                syncBridgePopoutIfNeeded(getSettings());
              }
            },
            onResume: () => {
              if (disposed || !liveDelayBuffer || !activeBridgeSource) {
                return;
              }
              if (suspendBridgeIfInterrupted()) {
                return;
              }
              remoteOrderById.clear();
              pendingDanmakuRemote = [];
              liveDelayBuffer.resume(Date.now());
              syncPanelBridgeState();
              publish();
            },
            onDisconnect: () => {
              detachBridgeSource();
            },
            onMarkScene: () => {
              if (disposed || !liveDelayBuffer || !activeBridgeSource) {
                return;
              }
              if (suspendBridgeIfInterrupted()) {
                return;
              }
              if (liveDelayBuffer.markScene(Date.now())) {
                syncPanelBridgeState();
              }
            },
            onSelectReaction: (messageId: string) => {
              if (disposed || !liveDelayBuffer || !activeBridgeSource) {
                return;
              }
              if (suspendBridgeIfInterrupted()) {
                return;
              }
              const visible = applyNgFilter(
                liveDelayBuffer.getVisibleMessages(),
                getSettings().filter,
              ).visible;
              if (!visible.some((item) => item.id === messageId)) {
                return;
              }
              if (liveDelayBuffer.selectReaction(messageId) !== null) {
                syncPanelBridgeState();
              }
            },
            onApplySuggestedDelay: () => {
              if (disposed || !liveDelayBuffer || !activeBridgeSource) {
                return;
              }
              if (suspendBridgeIfInterrupted()) {
                return;
              }
              const applied = liveDelayBuffer.applySuggestedDelay();
              if (applied === null) {
                syncPanelBridgeState();
                return;
              }
              const changed = tickBufferWithDanmaku(Date.now());
              syncPanelBridgeState();
              if (changed) {
                publish();
              } else {
                syncBridgePopoutIfNeeded(getSettings());
              }
            },
            onCancelCalibration: () => {
              if (disposed || !liveDelayBuffer || !activeBridgeSource) {
                return;
              }
              if (liveDelayBuffer.cancelCalibration()) {
                syncPanelBridgeState();
              }
            },
          },
        }
      : {}),
  });
  bridgeSubscriber?.start();
  syncPanelBridgeState();
  const danmaku = createDanmakuView();
  const popout = createPopoutController({
    resolveTarget: () => resolveActivePopoutTarget(getSettings()),
  });
  let pageUnloading = false;
  const pipChat = createPipChatController({
    onSend: (text) => adapter.sendMessage?.(text) ?? Promise.resolve(false),
    onNativeChatRejected: () => {
      if (disposed) return;
      rejectedPipNativeUrl = resolvePipNativeUrl(getSettings());
      pipChat.setNativeChatUrl(null);
      publish();
    },
    onClosedExternally: () => {
      lastPipDesired = false;
      pipClosedByUser = true;
      const wasPinPending = pipPinPending;
      pipPinPending = false;
      // Popout mode would reopen it as an OS popout on the next sync.
      // 別窓モードのままだと次の同期で通常別窓として開き直す。
      if (!disposed && !pageUnloading) returnToPanelFromPopout(wasPinPending);
    },
  });
  function clearDanmakuBoard(): void {
    lastDanmakuId = null;
    recentDanmakuKeys.length = 0;
    recentDanmakuKeySet.clear();
    danmakuBurstWindowStartMs = 0;
    danmakuBurstCount = 0;
    danmaku.clear();
  }

  const archiveSync = createArchiveSync({
    getOffsetSec: () => getSettings().archive.syncOffsetSec,
    getMaxSkewSec: () => getSettings().archive.maxSkewSec,
    onSeekJump: clearDanmakuBoard,
    onDue: (message) => {
      const settings = getSettings();
      if (shouldDropMessage(message, settings.filter)) {
        return;
      }
      rememberMessage(message);
      publish(message);
    },
  });

  // Mount after archiveSync exists — adapter callbacks may fire synchronously.
  // アダプタが同期的に通知する場合があるため、archiveSync 初期化後にマウントする。
  ensureRuntimeMounted(getSettings(), options.resolveMountParent());
  if (options.site === "youtube-live") {
    void ensureYouTubeChatFrameSrc(location.href).then((resolved) => {
      if (!disposed && resolved) {
        ensureRuntimeMounted(getSettings(), options.resolveMountParent());
      }
    });
  }

  const stopMediaClock = watchMediaClock((timeSec, meta) => {
    mediaSeeking = Boolean(meta.seeking);
    if ((meta.seeked && !meta.initial) || meta.seeking) {
      clearDanmakuBoard();
    }
    archiveSync.onMediaTime(timeSec, meta);
    refreshArchivePanel(timeSec);
  });

  const unwatch = watchSettings((next, previous) => {
    setSettings(next);
    if (next.displayMode === "popout") {
      pipPinPending = false;
    }
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
    syncOfficialOverlay();
    if (!document.fullscreenElement) {
      syncMountParent();
    }
    panel.reparentForFullscreen();
    danmaku.reparentForFullscreen();
  };
  document.addEventListener("fullscreenchange", onFullscreen);
  window.addEventListener("resize", syncMountParent);
  document.addEventListener("visibilitychange", onWatchVisibility);
  window.addEventListener("focus", onBecomeForeground);
  const onPageHide = () => {
    pageUnloading = true;
  };
  const onPageShow = () => {
    pageUnloading = false;
  };
  window.addEventListener("pagehide", onPageHide, { capture: true });
  window.addEventListener("pageshow", onPageShow, { capture: true });

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
  >[0] = (message, sender) => {
    const senderInfo = sender as {
      id?: string;
      url?: string;
      frameId?: number;
      tab?: unknown;
    };
    if (!isTrustedExtensionSender(senderInfo) || senderInfo.tab !== undefined) {
      return undefined;
    }
    if (bridgePublisher?.handleMessage(message, senderInfo as never)) {
      return undefined;
    }
    if (bridgeSubscriber?.handleMessage(message, senderInfo as never)) {
      return undefined;
    }
    const payload = message as { type?: string; command?: string } | undefined;
    if (
      payload?.type === "fce:command" &&
      payload.command === "toggle-compose-focus"
    ) {
      const route = routeDisplay(getSettings());
      if (route.showPanel) panel.focusCompose();
      else if (pipChat.isOpen()) pipChat.focusCompose();
      else if (route.showPopout) popout.focus();
    }
    return undefined;
  };
  try {
    browser.runtime.onMessage.addListener(onRuntimeMessage);
  } catch {
    // Extension context may already be invalidated.
  }
  publish();

  return {
    dispose: () => {
      disposed = true;
      pipGeneration++;
      clearMountRetryTimer();
      stopBridgeWatching();
      bridgePublisher?.stop();
      bridgeSubscriber?.stop();
      liveDelayBuffer?.reset();
      activeBridgeSource = null;
      localOrderById.clear();
      remoteOrderById.clear();
      pendingDanmakuRemote = [];
      recentDanmakuKeys.length = 0;
      recentDanmakuKeySet.clear();
      try {
        browser.runtime.onMessage.removeListener(onRuntimeMessage);
      } catch {
        // Extension context may already be invalidated on teardown.
      }
      unwatch();
      stopMediaClock();
      archiveSync.reset();
      if (adapterRunning) {
        adapter.stop();
        adapterRunning = false;
      }
      panel.unmount();
      danmaku.unmount();
      panelMounted = false;
      danmakuMounted = false;
      if (lastPipDesired || pipChat.isOpen()) {
        pipChat.close();
        lastPipDesired = false;
      }
      if (lastPopoutDesired || popout.isOpen()) {
        popout.close();
        lastPopoutDesired = false;
      }
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("resize", syncMountParent);
      document.removeEventListener("visibilitychange", onWatchVisibility);
      window.removeEventListener("focus", onBecomeForeground);
      window.removeEventListener("pagehide", onPageHide, { capture: true });
      window.removeEventListener("pageshow", onPageShow, { capture: true });
      window.removeEventListener("keydown", onKeydown, true);
    },
    syncMountParent,
  };

  function needsBetterMountParent(parent: HTMLElement | null): boolean {
    if (!parent || !parent.isConnected || parent === document.body) {
      return true;
    }
    if (typeof parent.getBoundingClientRect !== "function") {
      return false;
    }
    const rect = parent.getBoundingClientRect();
    return rect.width <= 0 || rect.height <= 0;
  }

  function needsYouTubeNativeUrlRetry(): boolean {
    if (
      options.site !== "youtube-live" ||
      !panelMounted ||
      nativeChatRejected
    ) {
      return false;
    }
    const next = getSettings();
    if (!next.enabled || !next.panel.useNativeChat) {
      return false;
    }
    return (
      !lastNativeUrlAttempt || !lastNativeUrlAttempt.includes("continuation=")
    );
  }

  function syncYouTubeNativeChatUrl(): void {
    if (!needsYouTubeNativeUrlRetry() || disposed) {
      return;
    }
    const next = getSettings();
    const candidate = resolveNativePanelChatUrl(location.href);
    if (candidate && candidate !== lastNativeUrlAttempt) {
      ensureRuntimeMounted(
        next,
        currentMountParent ?? options.resolveMountParent(),
      );
      return;
    }
    if (!candidate || !candidate.includes("continuation=")) {
      void ensureYouTubeChatFrameSrc(location.href).then((resolved) => {
        if (!disposed && resolved) {
          ensureRuntimeMounted(
            getSettings(),
            currentMountParent ?? options.resolveMountParent(),
          );
        }
      });
    }
  }

  function clearMountRetryTimer(): void {
    if (mountRetryTimer !== null) {
      globalThis.clearTimeout(mountRetryTimer);
      mountRetryTimer = null;
    }
  }

  function scheduleMountRetryIfNeeded(): void {
    if (
      disposed ||
      mountRetryTimer !== null ||
      mountRetryCount >= 24 ||
      (!needsBetterMountParent(currentMountParent) &&
        !needsYouTubeNativeUrlRetry())
    ) {
      return;
    }
    mountRetryTimer = globalThis.setTimeout(() => {
      mountRetryTimer = null;
      mountRetryCount += 1;
      syncMountParent();
      scheduleMountRetryIfNeeded();
    }, 250);
  }

  function syncMountParent(): void {
    if (disposed) {
      return;
    }
    syncOfficialOverlay();
    if (document.fullscreenElement) {
      return;
    }
    syncYouTubeNativeChatUrl();
    if (needsBetterMountParent(currentMountParent)) {
      const resolved = options.resolveMountParent();
      if (resolved !== currentMountParent) {
        currentMountParent = resolved;
        if (panelMounted) {
          panel.mount(resolved);
        }
        if (danmakuMounted) {
          danmaku.mount(resolved);
        }
      }
    }
    if (
      !needsBetterMountParent(currentMountParent) &&
      !needsYouTubeNativeUrlRetry()
    ) {
      mountRetryCount = 0;
      clearMountRetryTimer();
    } else {
      scheduleMountRetryIfNeeded();
    }
  }

  function shouldRunAdapter(next: ExtensionSettings): boolean {
    return next.enabled && options.isSiteEnabled(next);
  }

  function ensureAdapterRunning(shouldRun: boolean): void {
    if (shouldRun) {
      if (adapterRunning) {
        return;
      }
      adapter.start(onAdapterMessage);
      bridgePublisher?.start();
      adapterRunning = true;
      return;
    }
    if (!adapterRunning) {
      bridgePublisher?.stop();
      return;
    }
    bridgePublisher?.stop();
    adapter.stop();
    adapterRunning = false;
  }

  function onAdapterMessage(message: NormalizedMessage): void {
    if (disposed) {
      return;
    }
    bridgePublisher?.syncChannel();
    if (seenIds.has(message.id)) {
      // React hydration can finish an already displayed live/VOD row in later tasks.
      if (options.site === "twitch" && message.videoOffsetSec !== undefined) {
        archiveSync.ingest(message);
        const media = getPageMediaTimeSec();
        if (media !== null) {
          refreshArchivePanel(media);
        }
        return;
      }
      const index = messages.findIndex((item) => item.id === message.id);
      if (message.videoOffsetSec === undefined && index >= 0) {
        messages[index] = message;
        bridgePublisher?.enqueue(message);
        publish();
        if (routeDisplay(getSettings()).showDanmaku) {
          const visible = !shouldDropMessage(message, getSettings().filter);
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
      if (media !== null && !mediaSeeking) {
        archiveSync.onMediaTime(media, { seeked: false });
        refreshArchivePanel(media);
      }
      return;
    }
    bridgePublisher?.enqueue(message);
    rememberMessage(message);
    publish(message);
  }

  function rememberMessage(message: NormalizedMessage): void {
    if (messages.some((entry) => entry.id === message.id)) {
      return;
    }
    seenIds.add(message.id);
    messages.push(message);
    localOrderById.set(message.id, {
      displayOrderMs: Date.now(),
      orderSeq: ++displayOrderSeq,
    });
    while (messages.length > 500) {
      const removed = messages.shift();
      if (removed) {
        seenIds.delete(removed.id);
        localOrderById.delete(removed.id);
      }
    }
  }

  function allowDanmakuBurst(incoming: NormalizedMessage): boolean {
    if (incoming.isSelf) {
      return true;
    }
    const now = Date.now();
    if (now - danmakuBurstWindowStartMs > 500) {
      danmakuBurstWindowStartMs = now;
      danmakuBurstCount = 0;
    }
    if (danmakuBurstCount >= 3) {
      return false;
    }
    danmakuBurstCount += 1;
    return true;
  }

  function resolveVisibleArchiveMessages(
    settings: ExtensionSettings,
    mediaSec: number | null = getPageMediaTimeSec(),
  ): NormalizedMessage[] {
    if (mediaSec !== null && archiveSync.size() > 0) {
      return applyNgFilter(archiveSync.visibleUpTo(mediaSec), settings.filter)
        .visible;
    }
    return applyNgFilter(messages, settings.filter).visible;
  }

  function refreshArchivePanel(mediaSec: number): void {
    const settings = getSettings();
    const route = routeDisplay(settings);
    if (archiveSync.size() === 0) {
      return;
    }
    const visible = resolveVisibleArchiveMessages(settings, mediaSec);
    if (
      route.showPanel &&
      panelMounted &&
      !resolvePanelNativeUrlForMount(settings)
    ) {
      panel.setMessages(visible);
    }
    if (
      route.showPopout &&
      (lastPipDesired || pipChat.isOpen()) &&
      !resolvePipNativeUrl(settings)
    ) {
      pipChat.setMessages(visible.slice(-settings.filter.maxVisible));
    }
  }

  function resolveMixedLiveMessages(
    settings: ExtensionSettings,
  ): NormalizedMessage[] {
    if (!activeBridgeSource || !liveDelayBuffer) {
      return resolveVisibleArchiveMessages(settings);
    }
    const localEntries: TimedBridgeMessage[] = [];
    for (const item of messages) {
      if (item.videoOffsetSec !== undefined) {
        continue;
      }
      const order = localOrderById.get(item.id);
      localEntries.push({
        message: item,
        displayOrderMs: order?.displayOrderMs ?? item.timestampMs,
        orderSeq: order?.orderSeq ?? 0,
      });
    }
    const remoteMessages = liveDelayBuffer.getVisibleMessages();
    const visibleRemoteIds = new Set<string>();
    const remoteEntries: TimedBridgeMessage[] = [];
    for (const item of remoteMessages) {
      visibleRemoteIds.add(item.id);
      let order = remoteOrderById.get(item.id);
      if (!order) {
        order = {
          displayOrderMs: Date.now(),
          orderSeq: ++displayOrderSeq,
        };
        remoteOrderById.set(item.id, order);
      }
      remoteEntries.push({
        message: item,
        displayOrderMs: order.displayOrderMs,
        orderSeq: order.orderSeq,
      });
    }
    for (const id of remoteOrderById.keys()) {
      if (!visibleRemoteIds.has(id)) {
        remoteOrderById.delete(id);
      }
    }
    const merged = mergeLiveBridgeMessages(localEntries, remoteEntries);
    return applyNgFilter(merged, settings.filter).visible;
  }

  function clearRecentDanmakuForSite(site: SiteKind): void {
    const prefix = `${site}:`;
    if (lastDanmakuId?.startsWith(prefix)) {
      lastDanmakuId = null;
    }
    let write = 0;
    for (let read = 0; read < recentDanmakuKeys.length; read += 1) {
      const key = recentDanmakuKeys[read]!;
      if (key.startsWith(prefix)) {
        recentDanmakuKeySet.delete(key);
        continue;
      }
      recentDanmakuKeys[write] = key;
      write += 1;
    }
    recentDanmakuKeys.length = write;
  }

  function pushDanmaku(
    incoming: NormalizedMessage,
    settings: ExtensionSettings,
  ): void {
    const key = `${incoming.site}:${incoming.id}`;
    // Check NG directly rather than `visible` (which may be capped to maxVisible)
    // so rewound archive/VOD messages still appear as danmaku.
    const stillVisible = !shouldDropMessage(incoming, settings.filter);
    if (
      stillVisible &&
      key !== lastDanmakuId &&
      !recentDanmakuKeySet.has(key) &&
      allowDanmakuBurst(incoming)
    ) {
      lastDanmakuId = key;
      recentDanmakuKeySet.add(key);
      recentDanmakuKeys.push(key);
      while (recentDanmakuKeys.length > 500) {
        const evicted = recentDanmakuKeys.shift();
        if (evicted) {
          recentDanmakuKeySet.delete(evicted);
        }
      }
      danmaku.push(incoming);
    }
  }

  function syncBridgePopoutIfNeeded(
    settings: ExtensionSettings,
    visibleOverride?: NormalizedMessage[],
  ): void {
    if (disposed || !activeBridgeSource || !liveDelayBuffer) {
      return;
    }
    const route = routeDisplay(settings);
    if (!route.showPopout && !popout.isOpen()) {
      return;
    }
    const visible = visibleOverride ?? resolveMixedLiveMessages(settings);
    const bufferState = liveDelayBuffer.getState();
    try {
      void browser.runtime
        ?.sendMessage?.({
          type: BRIDGE_POPOUT_SYNC_TYPE,
          snapshot: {
            localSite: options.site,
            peerSite: activeBridgeSource.site,
            peerLabel: activeBridgeSource.label,
            delaySec: liveDelayBuffer.getDelaySec(),
            suspendedReason:
              bufferState.status === "suspended" ? bufferState.reason : null,
            messages: visible.slice(-settings.filter.maxVisible),
          },
        })
        ?.catch?.(() => undefined);
    } catch {
      // Extension context may already be invalidated.
    }
  }

  function publish(incoming?: NormalizedMessage): void {
    const settings = getSettings();
    const route = routeDisplay(settings);
    const releasedRemote = pendingDanmakuRemote.splice(0);
    const visible = resolveMixedLiveMessages(settings);
    if (route.showPanel && panelMounted) {
      const nativeUrl = resolvePanelNativeUrlForMount(settings);
      panel.setNativeChatUrl(nativeUrl);
      if (!nativeUrl) {
        panel.setMessages(visible);
      }
    }
    if (route.showDanmaku) {
      danmaku.applySettings(settings);
      danmaku.setMixedMode?.(activeBridgeSource !== null);
      danmaku.reparentForFullscreen();
      if (incoming) {
        pushDanmaku(incoming, settings);
      }
      for (const remoteItem of releasedRemote) {
        pushDanmaku(remoteItem, settings);
      }
    }
    if (route.showPopout && (lastPipDesired || pipChat.isOpen())) {
      pipChat.setMessages(visible.slice(-settings.filter.maxVisible));
    }
    syncBridgePopoutIfNeeded(settings, visible);
  }

  function onBecomeForeground(): void {
    if (disposed || !canClaimPopout()) {
      return;
    }
    if (!routeDisplay(getSettings()).showPopout) {
      return;
    }
    syncPopout(true, { reclaim: true });
  }

  function onWatchVisibility(): void {
    if (document.visibilityState === "hidden") {
      // Keep the window. The tab the user switches to retargets it.
      // 窓は残す。切り替えた先のタブが URL を合わせる。
      lastPopoutDesired = false;
      return;
    }
    onBecomeForeground();
  }

  function resolveActivePopoutTarget(
    settings: ExtensionSettings,
  ): PopoutTarget | null {
    if (activeBridgeSource !== null) {
      const siteKey = options.site === "twitch" ? "twitch" : "youtube";
      const bridgeUrl = buildBridgePopoutUrl(siteKey);
      if (bridgeUrl) {
        return { siteKey, url: bridgeUrl };
      }
    }
    return resolvePopoutTargetForPolicy(settings.popout.openPolicy);
  }

  /**
   * `reclaim`: this watch tab came back to the front. Take the shared window
   * back without focusing it; another tab may have retargeted it meanwhile.
   * `reclaim`: 視聴タブが前面に戻った。他タブが差し替えた可能性があるので、
   * フォーカスを移さず、共有の別窓をこの視聴タブに戻す。
   */
  function syncPopout(
    shouldShow: boolean,
    mountOptions?: { syncUrl?: boolean; reclaim?: boolean },
  ): void {
    // Background watch tabs share one popout window. They must not open,
    // retarget, or close it while the user is looking at another tab.
    // 別窓は一つ。バックグラウンドの視聴タブは別窓の開閉や URL の変更を行わない。
    if (shouldShow && !canClaimPopout()) {
      return;
    }
    const settings = getSettings();
    const target = resolveActivePopoutTarget(settings);
    const pipAvailable = isDocumentPipAvailable();
    if (!shouldShow) {
      pipFellBack = false;
      pipClosedByUser = false;
      pipPinPending = false;
    }
    if (shouldShow && pipClosedByUser) {
      return;
    }
    const pipActiveOrOpening =
      pipChat.isOpen() || Boolean(pipChat.isOpening?.());
    if (
      shouldShow &&
      pipAvailable &&
      settings.popout.alwaysOnTop &&
      !pipFellBack &&
      !pipActiveOrOpening &&
      !hasTransientUserActivation()
    ) {
      pipFellBack = true;
    }
    const wantPip =
      shouldShow && pipAvailable && settings.popout.alwaysOnTop && !pipFellBack;
    const wantWindow = shouldShow && target !== null && !wantPip;

    if (wantPip) {
      pipChat.setBridgeMode?.({
        active: activeBridgeSource !== null,
        headerLabel: activeBridgeSource?.label ?? undefined,
        readOnly: activeBridgeSource !== null,
      });
      pipChat.setNativeChatUrl(resolvePipNativeUrl(settings));
      if (lastPopoutDesired || popout.isOpen()) {
        lastPopoutDesired = false;
        popout.close();
      }
      if (!lastPipDesired || !pipActiveOrOpening) {
        lastPipDesired = true;
        const requested = ++pipGeneration;
        void pipChat.open().then((opened) => {
          if (disposed || requested !== pipGeneration || !lastPipDesired)
            return;
          if (!opened) {
            // PiP unavailable or gesture blocked — fall back to OS popout.
            // A tab that merely came to the front must not pull focus to it.
            // PiP 不可／ジェスチャ不足時は通常別窓へフォールバック。
            // 前面に戻っただけのタブでは、その窓へフォーカスを移さない。
            lastPipDesired = false;
            pipFellBack = true;
            if (target) {
              const fallback = mountOptions?.reclaim
                ? popout.claim()
                : popout.open();
              void Promise.resolve(fallback).then(rememberPopoutIfAccepted);
              syncBridgePopoutIfNeeded(getSettings());
            }
            return;
          }
          const latest = getSettings();
          pipChat.setMessages(
            resolveMixedLiveMessages(latest).slice(-latest.filter.maxVisible),
          );
        });
      }
      return;
    }

    if (lastPipDesired || pipActiveOrOpening) {
      pipGeneration++;
      lastPipDesired = false;
      pipChat.close();
    }

    if (wantWindow) {
      if (mountOptions?.reclaim) {
        void popout.claim().then(rememberPopoutIfAccepted);
        syncBridgePopoutIfNeeded(settings);
        return;
      }
      if (!lastPopoutDesired || !popout.isOpen()) {
        void Promise.resolve(popout.open()).then(rememberPopoutIfAccepted);
        syncBridgePopoutIfNeeded(settings);
        return;
      }
      if (mountOptions?.syncUrl) {
        popout.sync();
        syncBridgePopoutIfNeeded(settings);
      }
      return;
    }
    if (
      shouldShow &&
      !wantPip &&
      target === null &&
      options.site === "youtube-live"
    ) {
      void ensureYouTubeChatFrameSrc(location.href).then((resolved) => {
        const latest = getSettings();
        // Retry only once a target exists; a cached frame URL resolves
        // immediately and would otherwise loop forever.
        // 宛先が得られたときだけ再試行する。キャッシュ済みの枠 URL はすぐ解決し、
        // そのままだと無限に繰り返す。
        if (
          disposed ||
          !resolved ||
          latest.displayMode !== "popout" ||
          resolveActivePopoutTarget(latest) === null
        ) {
          return;
        }
        syncPopout(true, { ...mountOptions, syncUrl: true });
      });
    }
    if (lastPopoutDesired || (popout.isOpen() && canClaimPopout())) {
      lastPopoutDesired = false;
      popout.close();
    }
  }

  /**
   * Panel menu "Pin on top". Document PiP needs this click's user activation,
   * so the window is requested before any await. Popout mode then keeps it.
   * パネルメニューの「前面に固定」。Document PiP にはクリックによるユーザー操作が必要なため、
   * await より前に窓を要求する。その後は別窓モードが保持する。
   */
  function pinChatOnTop(): void {
    if (disposed) {
      return;
    }
    pipFellBack = false;
    pipClosedByUser = false;
    pipPinPending = true;
    const current = getSettings();
    pipChat.setBridgeMode?.({
      active: activeBridgeSource !== null,
      headerLabel: activeBridgeSource?.label ?? undefined,
      readOnly: activeBridgeSource !== null,
    });
    pipChat.setNativeChatUrl(resolvePipNativeUrl(current));
    lastPipDesired = true;
    const requested = ++pipGeneration;
    void pipChat.open().then((opened) => {
      if (disposed || requested !== pipGeneration || !lastPipDesired) {
        return;
      }
      if (!opened) {
        lastPipDesired = false;
        pipFellBack = true;
        const target = resolveActivePopoutTarget(getSettings());
        if (target && canClaimPopout()) {
          void Promise.resolve(popout.open()).then(rememberPopoutIfAccepted);
          syncBridgePopoutIfNeeded(getSettings());
        } else {
          pipPinPending = false;
          returnToPanelFromPopout(true);
        }
        return;
      }
      const latest = getSettings();
      pipChat.setMessages(
        resolveMixedLiveMessages(latest).slice(-latest.filter.maxVisible),
      );
    });
    void saveSettings({ displayMode: "popout" }).catch((error: unknown) => {
      console.warn("[fce] pinChatOnTop saveSettings failed", error);
    });
  }

  /**
   * Twitch reads chat from the page column, so the list is empty while it is
   * collapsed; the official iframe keeps PiP filled. Replay iframes only
   * follow the video when they sit in the watch page, so replays keep the list.
   * Twitch はページ側の欄から読むので、畳むと一覧が空になる。公式 iframe なら埋まる。
   * リプレイ iframe は視聴ページ内でしか動画に追従しないので、一覧のままにする。
   */
  function resolvePipNativeUrl(next: ExtensionSettings): string | null {
    const url = resolvePanelNativeUrlForMount(next);
    if (url !== rejectedPipNativeUrl) rejectedPipNativeUrl = null;
    if (!url) {
      return null;
    }
    return url === rejectedPipNativeUrl ||
      /^\/live_chat_replay(?:\/|$)/.test(new URL(url).pathname)
      ? null
      : url;
  }

  function returnToPanelFromPopout(force = false): void {
    if (force || getSettings().displayMode === "popout") {
      void saveSettings({ displayMode: "panel" }).catch((error: unknown) => {
        console.warn("[fce] returnToPanelFromPopout failed", error);
      });
    }
  }

  function rememberPopoutIfAccepted(accepted: unknown): void {
    if (accepted === false || disposed) {
      return;
    }
    if (getSettings().displayMode !== "popout") {
      return;
    }
    lastPopoutDesired = true;
  }

  function videoPanelAllowed(next: ExtensionSettings): boolean {
    // A rejected or missing official URL leaves the extension's own list.
    // 公式 URL が拒否・未取得なら自前リストなので、ページ側と重ならない。
    return shouldMountVideoPanel({
      useNativeChat: resolvePanelNativeUrlForMount(next) !== null,
      fullscreen: Boolean(document.fullscreenElement),
      pageChatOpen: isPageChatColumnOpen(document),
    });
  }

  function syncOfficialOverlay(): void {
    if (disposed) {
      return;
    }
    const next = getSettings();
    const show = routeDisplay(next).showPanel && videoPanelAllowed(next);
    if (show === lastVideoPanelMounted) {
      return;
    }
    ensureRuntimeMounted(
      next,
      currentMountParent ?? options.resolveMountParent(),
    );
  }

  function buildBridgeState(): OverlayBridgeState {
    if (!bridgeSupported || !liveDelayBuffer) {
      return {
        supported: false,
        sources: [],
        activeSource: null,
        delaySec: 0,
        suspendedReason: null,
        calibration: {
          status: "idle",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      };
    }
    const bufferState = liveDelayBuffer.getState();
    const calibration = liveDelayBuffer.getCalibration();
    return {
      supported: true,
      sources: bridgeSources,
      activeSource: activeBridgeSource
        ? {
            tabId: activeBridgeSource.tabId,
            site: activeBridgeSource.site,
            channelLogin: activeBridgeSource.channelLogin,
            label: activeBridgeSource.label,
          }
        : null,
      delaySec: liveDelayBuffer.getDelaySec(),
      suspendedReason:
        bufferState.status === "suspended" ? bufferState.reason : null,
      calibration: {
        status: calibration.status,
        selectedMessageId:
          calibration.status === "suggested" ? calibration.messageId : null,
        suggestedDelaySec:
          calibration.status === "suggested"
            ? calibration.suggestedDelaySec
            : null,
      },
    };
  }

  function syncPanelBridgeState(): void {
    panel.setBridgeState(buildBridgeState());
  }

  function stopBridgeWatching(): void {
    if (bridgeTickTimer !== null) {
      globalThis.clearInterval(bridgeTickTimer);
      bridgeTickTimer = null;
    }
    stopInterruptWatch?.();
    stopInterruptWatch = null;
  }

  function suspendBridge(reason: LivePlaybackInterruption): void {
    if (disposed || !activeBridgeSource || !liveDelayBuffer) {
      return;
    }
    const remoteSite = activeBridgeSource.site;
    remoteOrderById.clear();
    pendingDanmakuRemote = [];
    clearRecentDanmakuForSite(remoteSite);
    danmaku.clearSite?.(remoteSite);
    liveDelayBuffer.suspend(reason);
    syncPanelBridgeState();
    publish();
  }

  function suspendBridgeIfInterrupted(): boolean {
    const interruption = getLivePlaybackInterruption();
    if (interruption === null) {
      return false;
    }
    suspendBridge(interruption);
    return true;
  }

  function startBridgeWatching(): void {
    stopBridgeWatching();
    bridgeTickTimer = globalThis.setInterval(() => {
      if (disposed || !activeBridgeSource || !liveDelayBuffer) {
        return;
      }
      if (tickBufferWithDanmaku(Date.now())) {
        publish();
      }
    }, 250);
    stopInterruptWatch = watchLivePlaybackInterruptions(suspendBridge);
  }

  function syncPipBridgeState(current: ExtensionSettings): void {
    if (!(lastPipDesired || pipChat.isOpen())) {
      return;
    }
    pipChat.setBridgeMode?.({
      active: activeBridgeSource !== null,
      headerLabel: activeBridgeSource?.label ?? undefined,
      readOnly: activeBridgeSource !== null,
    });
    pipChat.setNativeChatUrl(resolvePipNativeUrl(current));
  }

  function detachBridgeSource(opts?: {
    alreadyUnsubscribed?: boolean;
    refreshSources?: boolean;
    skipMountSync?: boolean;
  }): void {
    bridgeSelectionSeq += 1;
    stopBridgeWatching();
    const previousRemoteSite = activeBridgeSource?.site ?? null;
    const wasActive = activeBridgeSource !== null;
    activeBridgeSource = null;
    remoteOrderById.clear();
    pendingDanmakuRemote = [];
    if (previousRemoteSite) {
      clearRecentDanmakuForSite(previousRemoteSite);
      danmaku.clearSite?.(previousRemoteSite);
    }
    liveDelayBuffer?.reset();
    if (!opts?.alreadyUnsubscribed) {
      void bridgeSubscriber?.unsubscribe();
    }
    if (disposed) {
      return;
    }
    danmaku.setMixedMode?.(false);
    syncPanelBridgeState();
    syncPipBridgeState(getSettings());
    if (!opts?.skipMountSync && wasActive) {
      ensureRuntimeMounted(
        getSettings(),
        currentMountParent ?? options.resolveMountParent(),
        { syncPopoutUrl: true },
      );
      publish();
    }
    if (opts?.refreshSources) {
      void refreshBridgeSources();
    }
  }

  async function refreshBridgeSources(): Promise<void> {
    if (disposed || !bridgeSubscriber) {
      return;
    }
    const sources = await bridgeSubscriber.listSources();
    if (disposed) {
      return;
    }
    bridgeSources = sources.map((source) => ({
      tabId: source.tabId,
      site: source.site,
      channelLogin: source.channelLogin,
      label: source.label,
    }));
    syncPanelBridgeState();
  }

  async function selectBridgeSource(sourceTabId: number | null): Promise<void> {
    if (disposed || !bridgeSubscriber || !liveDelayBuffer) {
      return;
    }
    const seq = ++bridgeSelectionSeq;
    if (sourceTabId === null) {
      detachBridgeSource();
      return;
    }
    if (liveDelayBuffer.cancelCalibration()) {
      syncPanelBridgeState();
    }
    const source = await bridgeSubscriber.subscribe(sourceTabId);
    if (disposed || seq !== bridgeSelectionSeq) {
      return;
    }
    if (!source) {
      detachBridgeSource({ alreadyUnsubscribed: true, refreshSources: true });
      return;
    }
    clearRecentDanmakuForSite(source.site);
    danmaku.clearSite?.(source.site);
    activeBridgeSource = source;
    remoteOrderById.clear();
    pendingDanmakuRemote = [];
    liveDelayBuffer.reset();
    liveDelayBuffer.setDelaySec(0);
    startBridgeWatching();
    syncPanelBridgeState();
    const current = getSettings();
    syncPipBridgeState(current);
    ensureRuntimeMounted(
      current,
      currentMountParent ?? options.resolveMountParent(),
      { syncPopoutUrl: true },
    );
    publish();
  }

  function resolvePanelNativeUrlForMount(
    next: ExtensionSettings,
  ): string | null {
    if (activeBridgeSource !== null) {
      return null;
    }
    if (!next.panel.useNativeChat) {
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

  function ensureRuntimeMounted(
    next: ExtensionSettings,
    parent: HTMLElement,
    mountOptions?: { syncPopoutUrl?: boolean },
  ): void {
    const route = routeDisplay(next);
    if (!next.enabled) {
      lastVideoPanelMounted = false;
      if (activeBridgeSource !== null) {
        detachBridgeSource({ skipMountSync: true });
      }
      ensureAdapterRunning(false);
      if (panelMounted) {
        panel.unmount();
        panelMounted = false;
      }
      if (danmakuMounted) {
        danmaku.unmount();
        danmakuMounted = false;
      }
      syncPopout(false);
      return;
    }
    currentMountParent = parent;
    const showPanel = route.showPanel && videoPanelAllowed(next);
    lastVideoPanelMounted = showPanel;
    if (showPanel) {
      panel.mount(parent);
      panelMounted = true;
      panel.applySettings(next);
      panel.setNativeChatUrl(resolvePanelNativeUrlForMount(next));
      syncPanelBridgeState();
    } else if (panelMounted) {
      panel.unmount();
      panelMounted = false;
    }
    if (route.showDanmaku) {
      danmaku.mount(parent);
      danmakuMounted = true;
      danmaku.applySettings(next);
    } else if (danmakuMounted) {
      danmaku.unmount();
      danmakuMounted = false;
    }
    // Mount views before starting the adapter so synchronous initial rows deliver directly,
    // without replaying previously accumulated history when toggling into danmaku mode.
    // アダプタからの同期通知を受け取れるよう先に View をマウントする。弾幕に切り替えたときに過去のコメントをまとめて流さない。
    ensureAdapterRunning(shouldRunAdapter(next));
    scheduleMountRetryIfNeeded();
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

function hasTransientUserActivation(): boolean {
  if (typeof navigator === "undefined") {
    return true;
  }
  const activation = (
    navigator as Navigator & { userActivation?: { isActive?: boolean } }
  ).userActivation;
  return activation ? Boolean(activation.isActive) : true;
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
