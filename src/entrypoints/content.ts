import { bindNativeComposeFocus } from "../shared/native-compose-focus";
import { NATIVE_CHAT_FRAME_ID } from "../shared/dom-ids";
import { createRuntimeController } from "../app/runtime-controller";
import { bindPageLifecycle } from "../app/page-lifecycle";
import {
  isYouTubeLiveChatContext,
  observeYouTubeLiveChatIframe,
} from "../adapters/youtube-live";
import type { NormalizedMessage } from "../core/message";
import { TOP_FRAME_MESSAGE_TYPE } from "../adapters/types";
import { startNativeChatNgHider } from "../app/native-chat-ng";
import { startTwitchRuntime } from "../app/twitch-runtime";
import { startYouTubeLiveRuntime } from "../app/youtube-live-runtime";
import { isYouTubeWatchWithLiveChat } from "../adapters/youtube-live";
import {
  loadSettings,
  saveSettings,
  type DisplayMode,
} from "../shared/settings";
import {
  ensureYouTubeChatFrameSrc,
  isTwitchHost,
  markYouTubeWatchTransition,
  resolvePopoutTargetForPolicy,
  resolveYouTubePageVideoId,
} from "../shared/site-ids";
import { isYouTubeHost } from "../shared/youtube-page";
import {
  isTrustedExtensionSender,
  POPOUT_OPEN_TYPE,
} from "../shared/runtime-messages";
import { startPlayerChrome } from "../views/player-chrome";

export default defineContentScript({
  matches: [
    "*://www.youtube.com/*",
    "*://youtube.com/*",
    "*://www.twitch.tv/*",
    "*://twitch.tv/*",
  ],
  allFrames: true,
  runAt: "document_idle",
  main(ctx) {
    if (isYouTubeLiveChatContext()) {
      ctx.onInvalidated(bindPageLifecycle(runLiveChatFrame));
      return;
    }
    if (
      isTwitchHost(location.hostname) &&
      /^\/(?:embed|popout)\/[^/]+\/chat/.test(location.pathname)
    ) {
      ctx.onInvalidated(
        bindPageLifecycle(() => {
          const stopNg = startNativeChatNgHider("twitch");
          const stopFocus = bindNativeComposeFocus();
          const stopHostedStyle = injectHostedFrameStyle(
            "fce-hosted-twitch-header",
            [
              ".stream-chat-header { justify-content: flex-start !important; padding-left: 12px !important; padding-right: 122px !important; position: relative !important; box-sizing: border-box !important; }",
              ".stream-chat-header > div:has(button) { right: 80px !important; }",
            ].join(" "),
          );
          return () => {
            stopNg();
            stopFocus();
            stopHostedStyle();
          };
        }),
      );
      return;
    }
    if (window.top !== window) return;
    if (isYouTubeHost(location.hostname)) {
      ctx.onInvalidated(bindPageLifecycle(runYouTubeTopFrame));
      return;
    }
    if (isTwitchHost(location.hostname)) {
      ctx.onInvalidated(bindPageLifecycle(runTwitchTopFrame));
    }
  },
});

function runLiveChatFrame(): () => void {
  const stopObserve = observeYouTubeLiveChatIframe((message) => {
    publishToTop(message);
  });
  const stopNg = startNativeChatNgHider("youtube-live");
  const stopFocus = bindNativeComposeFocus();
  const stopHostedStyle = injectHostedFrameStyle(
    "fce-hosted-youtube-header",
    [
      "yt-live-chat-app, yt-live-chat-renderer, yt-live-chat-header-renderer { min-width: 0 !important; max-width: 100% !important; box-sizing: border-box !important; }",
      "yt-live-chat-header-renderer { padding-left: 8px !important; padding-right: 70px !important; }",
      "yt-live-chat-header-renderer #primary-content { min-width: 0 !important; flex: 1 1 auto !important; overflow: hidden !important; }",
      "yt-live-chat-header-renderer #close-button, #close-button.yt-live-chat-header-renderer { display: none !important; }",
    ].join(" "),
  );
  return () => {
    stopObserve();
    stopNg();
    stopFocus();
    stopHostedStyle();
  };
}

function injectHostedFrameStyle(styleId: string, css: string): () => void {
  let hosted = false;
  try {
    hosted = window.frameElement?.id === NATIVE_CHAT_FRAME_ID;
  } catch {
    hosted = false;
  }
  if (!hosted) {
    return () => {};
  }
  document.getElementById(styleId)?.remove();
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = css;
  (document.head ?? document.documentElement)?.appendChild(style);
  return () => style.remove();
}

function resolveTrustedYouTubeParentOrigin(): string | null {
  try {
    const parentOrigin = window.frameElement?.ownerDocument?.location?.origin;
    if (parentOrigin?.startsWith("https://")) {
      const host = new URL(parentOrigin).hostname;
      if (isYouTubeHost(host)) {
        return parentOrigin;
      }
    }
  } catch {
    // Cross-origin parent — inspect referrer below.
  }
  if (document.referrer) {
    try {
      const ref = new URL(document.referrer);
      if (ref.protocol === "https:" && isYouTubeHost(ref.hostname)) {
        return ref.origin;
      }
    } catch {
      return null;
    }
  }
  if (isYouTubeHost(location.hostname) && location.protocol === "https:") {
    return location.origin;
  }
  return null;
}

function publishToTop(message: NormalizedMessage): void {
  const targetOrigin = resolveTrustedYouTubeParentOrigin();
  if (!targetOrigin) {
    return;
  }
  window.parent.postMessage(
    {
      type: TOP_FRAME_MESSAGE_TYPE,
      message,
    },
    targetOrigin,
  );
}

function runYouTubeTopFrame(): () => void {
  const runtime = createRuntimeController(startYouTubeRuntimeForPage);
  const stopCommands = bindCommandListener();
  // Theater/fullscreen fires yt-page-data-updated without changing the video —
  // only restart when the watch identity changes (ISS-023).
  // シアター／全画面でも page-data-updated イベントが発生するが、動画が同じなら再起動しない。
  let lastWatchKey = "";
  let lastVideoId: string | null = null;
  const restartIfWatchChanged = () => {
    const nextVideoId = resolveYouTubePageVideoId(location.href);
    const key = nextVideoId ?? `${location.pathname}${location.search}`;
    if (key === lastWatchKey) {
      return;
    }
    if (lastVideoId && lastVideoId !== nextVideoId) {
      markYouTubeWatchTransition(lastVideoId, document);
    }
    lastWatchKey = key;
    lastVideoId = nextVideoId;
    void runtime.restart();
  };
  // Firefox tab teardown interrupted the previous JS removal loop before stop().
  // Keep both navigation subscriptions under one native cancellation operation.
  const navigation = new AbortController();
  window.addEventListener("yt-navigate-finish", restartIfWatchChanged, {
    signal: navigation.signal,
  });
  window.addEventListener("yt-page-data-updated", restartIfWatchChanged, {
    signal: navigation.signal,
  });
  restartIfWatchChanged();
  return () => {
    navigation.abort();
    stopCommands();
    runtime.stop();
  };
}

async function startYouTubeRuntimeForPage(): Promise<() => void> {
  let active = false;
  // Hold live across brief UI flicker on theater/fullscreen (ISS-023 review).
  // シアター／全画面でライブ UI が一瞬消えてもすぐ停止させない。
  let leaveLiveConfirmations = 0;
  const runtime = createRuntimeController(async (signal) => {
    if (!active) {
      return () => {};
    }
    const stopPlayerChrome = startPlayerChrome("youtube");
    let stopLive: () => void;
    try {
      stopLive = await startYouTubeLiveRuntime(signal);
    } catch (error) {
      // The controller never receives a disposer on failure; release the
      // button here or its observer keeps re-adding it on later videos.
      // 失敗時は解放関数が返らないため、ここでボタンを外す。
      stopPlayerChrome();
      throw error;
    }
    if (signal.aborted) {
      stopPlayerChrome();
      stopLive();
      return () => {};
    }
    return () => {
      stopPlayerChrome();
      stopLive();
    };
  });
  const sync = () => {
    const detected = isYouTubeWatchWithLiveChat();
    if (active && !detected) {
      leaveLiveConfirmations += 1;
      if (leaveLiveConfirmations < 3) {
        return;
      }
    } else {
      leaveLiveConfirmations = 0;
    }
    if (detected === active) return;
    active = detected;
    void runtime.restart();
  };
  sync();
  const timer = window.setInterval(sync, 1500);
  return () => {
    window.clearInterval(timer);
    runtime.stop();
  };
}

function runTwitchTopFrame(): () => void {
  const runtime = createRuntimeController(startTwitchRuntime);
  void runtime.restart();
  const stopPlayerChrome = startPlayerChrome("twitch");
  const stopCommands = bindCommandListener();

  // Twitch SPA channel switches / Twitch のチャンネル切替
  let lastPath = location.pathname;
  const timer = window.setInterval(() => {
    if (location.pathname === lastPath) {
      return;
    }
    lastPath = location.pathname;
    void runtime.restart();
  }, 1000);
  return () => {
    window.clearInterval(timer);
    stopCommands();
    stopPlayerChrome();
    runtime.stop();
  };
}

function bindCommandListener(): () => void {
  const listener: Parameters<
    typeof browser.runtime.onMessage.addListener
  >[0] = (message, sender) => {
    const senderInfo = sender as { id?: string; tab?: unknown };
    if (!isTrustedExtensionSender(senderInfo) || senderInfo.tab !== undefined) {
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return;
    }
    const payload = message as { type?: unknown; command?: unknown };
    if (
      payload.type !== "fce:command" ||
      typeof payload.command !== "string" ||
      !payload.command
    ) {
      return;
    }
    void handleCommand(payload.command).catch((error: unknown) => {
      console.warn("[fce] command handling failed", error);
    });
  };
  try {
    browser.runtime.onMessage.addListener(listener);
  } catch {
    return () => {};
  }
  return () => {
    try {
      browser.runtime.onMessage.removeListener(listener);
    } catch {
      // Extension context may already be invalidated on teardown.
    }
  };
}

async function handleCommand(command: string): Promise<void> {
  const settings = await loadSettings();
  if (command === "toggle-enabled") {
    await saveSettings({ enabled: !settings.enabled });
    return;
  }
  if (command === "cycle-display-mode") {
    const order: DisplayMode[] = ["panel", "popout", "danmaku"];
    const index = order.indexOf(settings.displayMode);
    const next = order[(index + 1) % order.length] ?? "panel";
    // Entering danmaku mode also arms the danmaku engine.
    // 弾幕モードへ入ったら弾幕エンジンも有効化する。
    if (next === "danmaku") {
      await saveSettings({
        displayMode: next,
        danmaku: { enabled: true },
      });
      return;
    }
    await saveSettings({ displayMode: next });
    return;
  }
  if (command === "toggle-danmaku") {
    const enabled = !settings.danmaku.enabled;
    await saveSettings({
      danmaku: { enabled },
      danmakuOverlayOnPanel: enabled,
      ...(enabled ? { displayMode: "danmaku" as DisplayMode } : {}),
    });
    return;
  }
  if (command === "open-popout") {
    let target = resolvePopoutTargetForPolicy(settings.popout.openPolicy);
    if (!target && isYouTubeHost(location.hostname)) {
      await ensureYouTubeChatFrameSrc();
      target = resolvePopoutTargetForPolicy(settings.popout.openPolicy);
    }
    if (!target) {
      console.warn(
        "[fce] open-popout: no eligible chat surface for current page/policy",
      );
      return;
    }
    await browser.runtime.sendMessage({
      type: POPOUT_OPEN_TYPE,
      url: target.url,
      siteKey: target.siteKey,
      focus: true,
    });
  }
}
