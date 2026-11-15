import { bindNativeComposeFocus } from "../shared/native-compose-focus";
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
import { startYouTubeCommentsRuntime } from "../app/youtube-comments-runtime";
import { startYouTubeLiveRuntime } from "../app/youtube-live-runtime";
import { isYouTubeWatchWithLiveChat } from "../adapters/youtube-live";
import { isYouTubeWatchWithComments } from "../adapters/youtube-comments";
import {
  loadSettings,
  saveSettings,
  type DisplayMode,
} from "../shared/settings";
import {
  extractYouTubeVideoId,
  resolvePopoutTargetForPolicy,
} from "../shared/site-ids";
import { POPOUT_OPEN_TYPE } from "../shared/runtime-messages";
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
      /(^|\.)twitch\.tv$/i.test(location.hostname) &&
      /^\/(?:embed|popout)\/[^/]+\/chat/.test(location.pathname)
    ) {
      ctx.onInvalidated(
        bindPageLifecycle(() => {
          const stopNg = startNativeChatNgHider("twitch");
          const stopFocus = bindNativeComposeFocus();
          return () => {
            stopNg();
            stopFocus();
          };
        }),
      );
      return;
    }
    if (window.top !== window) return;
    if (/(^|\.)youtube\.com$/i.test(location.hostname)) {
      ctx.onInvalidated(bindPageLifecycle(runYouTubeTopFrame));
      return;
    }
    if (/(^|\.)twitch\.tv$/i.test(location.hostname)) {
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
  return () => {
    stopObserve();
    stopNg();
    stopFocus();
  };
}

function publishToTop(message: NormalizedMessage): void {
  window.parent.postMessage(
    {
      type: TOP_FRAME_MESSAGE_TYPE,
      message,
    },
    "*",
  );
}

function runYouTubeTopFrame(): () => void {
  const runtime = createRuntimeController(startYouTubeRuntimeForPage);
  const stopPlayerChrome = startPlayerChrome("youtube");
  const stopCommands = bindCommandListener();
  // Theater/fullscreen fires yt-page-data-updated without changing the video —
  // only restart when the watch identity changes (ISS-023).
  // シアター／全画面でも page-data-updated が飛ぶが、動画が同じなら再起動しない。
  let lastWatchKey = "";
  const restartIfWatchChanged = () => {
    const key =
      extractYouTubeVideoId(location.href) ??
      `${location.pathname}${location.search}`;
    if (key === lastWatchKey) {
      return;
    }
    lastWatchKey = key;
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
    stopPlayerChrome();
  };
}

async function startYouTubeRuntimeForPage(): Promise<() => void> {
  let mode: "live" | "comments" | null = null;
  // Hold live across brief UI flicker on theater/fullscreen (ISS-023 review).
  // シアター／全画面でライブ UI が一瞬消えてもすぐ comments に落とさない。
  let leaveLiveConfirmations = 0;
  const runtime = createRuntimeController((signal) =>
    mode === "live"
      ? startYouTubeLiveRuntime(signal)
      : mode === "comments"
        ? startYouTubeCommentsRuntime(signal)
        : Promise.resolve(() => {}),
  );
  const sync = () => {
    const detected = isYouTubeWatchWithLiveChat()
      ? "live"
      : isYouTubeWatchWithComments()
        ? "comments"
        : null;
    if (mode === "live" && detected !== "live") {
      leaveLiveConfirmations += 1;
      if (leaveLiveConfirmations < 3) {
        return;
      }
    } else {
      leaveLiveConfirmations = 0;
    }
    if (detected === mode) return;
    mode = detected;
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
  >[0] = (message) => {
    if (!message || typeof message !== "object") {
      return;
    }
    const payload = message as { type?: string; command?: string };
    if (payload.type !== "fce:command" || !payload.command) {
      return;
    }
    void handleCommand(payload.command);
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
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
    const target = resolvePopoutTargetForPolicy(settings.popout.openPolicy);
    if (!target) {
      console.warn(
        "[fce] open-popout: no eligible live chat for current openPolicy",
      );
      return;
    }
    await browser.runtime.sendMessage({
      type: POPOUT_OPEN_TYPE,
      url: target.url,
      siteKey: target.siteKey,
    });
  }
}
