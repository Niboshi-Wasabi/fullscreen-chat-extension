import {
  fillNativeInput,
  canClickNativeButton,
} from "../../shared/native-compose";
import {
  isChatFrameSource,
  isYouTubeChatMessage,
  sanitizeYouTubeChatMessage,
} from "../../shared/youtube-chat-bridge";
import { looksLikeCommand, type NormalizedMessage } from "../../core/message";
import {
  HIDDEN_LIVE_CHAT_FRAME_ID,
  NATIVE_CHAT_FRAME_ID,
} from "../../shared/dom-ids";
import { extractMessageContent } from "../../shared/message-content";
import {
  resolveYouTubePageChatFrameSrc,
  resolveYouTubePageVideoId,
} from "../../shared/site-ids";
import { parseClockToSeconds } from "../../core/archive-sync";
import {
  isHostVideoAdPlaying,
  resolvePrimaryVideo,
} from "../../shared/video-clock";
import {
  isYouTubeChatReplay,
  isYouTubeHost,
  readYouTubeAuthorRole,
  readYouTubeIframeUrl,
} from "../../shared/youtube-page";
import type { SiteAdapter } from "../types";
import { TOP_FRAME_MESSAGE_TYPE } from "../types";
/**
 * YouTube Live / premiere / chat-replay adapter.
 * YouTube ライブ・プレミア・チャットリプレイ用アダプタ。
 *
 * Hidden iframe keeps receiving when native chat is closed
 * (left:-9999px — avoid display:none which stops rendering).
 * 公式チャットを閉じても、画面外の iframe で受信を続ける
 * （left:-9999px。display:none は描画停止の原因になるので使わない）。
 */
export function createYouTubeLiveAdapter(): SiteAdapter {
  let seen = new WeakSet<Element>();
  let stopped = false;
  let observer: MutationObserver | null = null;
  let onMessage: ((message: NormalizedMessage) => void) | null = null;
  let ensureTimer: number | null = null;
  let stopReplaySync: (() => void) | null = null;

  const handleWindowMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; message?: NormalizedMessage };
    if (
      !isChatFrameSource(event) ||
      data?.type !== TOP_FRAME_MESSAGE_TYPE ||
      !isYouTubeChatMessage(data.message)
    ) {
      return;
    }
    if (data.message.site !== "youtube-live") {
      return;
    }
    onMessage?.(sanitizeYouTubeChatMessage(data.message));
  };

  return {
    site: "youtube-live",
    start(callback) {
      stopped = false;
      seen = new WeakSet<Element>();
      onMessage = callback;
      window.addEventListener("message", handleWindowMessage);
      ensureHiddenChatReceiver();
      observeTopFrameChat();
      stopReplaySync = bindYouTubeReplaySync();
      // Short interval so leaving panel/native mode quickly restores the hidden receiver.
      // パネルの公式チャットを外した直後に、受信用 iframe を作り直す。
      ensureTimer = window.setInterval(() => {
        if (!stopped) {
          ensureHiddenChatReceiver();
        }
      }, 800);
    },
    stop() {
      stopped = true;
      onMessage = null;
      window.removeEventListener("message", handleWindowMessage);
      stopReplaySync?.();
      stopReplaySync = null;
      observer?.disconnect();
      observer = null;
      if (ensureTimer !== null) {
        window.clearInterval(ensureTimer);
        ensureTimer = null;
      }
      document.getElementById(HIDDEN_LIVE_CHAT_FRAME_ID)?.remove();
    },
    async sendMessage(text: string) {
      return stopped ? false : trySendViaNativeInput(text);
    },
  };

  function observeTopFrameChat(): void {
    const root = document.body;
    if (!root) {
      return;
    }
    observer = new MutationObserver((mutations) => {
      const hasAddedElements = mutations.some((mutation) =>
        Array.from(mutation.addedNodes).some((node) => node instanceof Element),
      );
      if (hasAddedElements) {
        scrapeVisibleChatNodes(document);
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    scrapeVisibleChatNodes(document);
  }

  function scrapeVisibleChatNodes(doc: Document): void {
    if (stopped || !onMessage) {
      return;
    }
    const items = doc.querySelectorAll(
      "yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer",
    );
    items.forEach((item) => {
      if (seen.has(item)) {
        return;
      }
      seen.add(item);
      const message = parseChatRenderer(item);
      if (message) {
        onMessage?.(message);
      }
    });
  }
}

/**
 * Content-script path for live_chat iframe / live_chat iframe 用 content script 経路
 */
export function observeYouTubeLiveChatIframe(
  publish: (message: NormalizedMessage) => void,
): () => void {
  const seen = new WeakSet<Element>();
  const scan = () => {
    document
      .querySelectorAll(
        "yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer",
      )
      .forEach((item) => {
        if (seen.has(item)) {
          return;
        }
        seen.add(item);
        const message = parseChatRenderer(item);
        if (message) {
          publish(message);
        }
      });
  };

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  scan();
  return () => observer.disconnect();
}

function parseChatRenderer(element: Element): NormalizedMessage | null {
  const authorName =
    element
      .querySelector("#author-name, #author-name span")
      ?.textContent?.trim() ?? "unknown";
  const messageEl = element.querySelector("#message");
  const { text, segments } = extractMessageContent(
    messageEl instanceof Element ? messageEl : null,
  );
  const plain =
    text || messageEl?.textContent?.trim() || element.textContent?.trim() || "";
  // Allow emoji-only lines (no plain text) / 絵文字のみの行も通す
  if (!plain && segments.length === 0) {
    return null;
  }

  const role = readYouTubeAuthorRole(element);
  const selfName = resolveYouTubeSelfAuthorName(element.ownerDocument);
  const isSelf =
    selfName !== null &&
    selfName.localeCompare(authorName, undefined, {
      sensitivity: "accent",
    }) === 0;

  const displayText = plain || segmentsToFallbackLabel(segments.length);
  const videoOffsetSec = readYouTubeVideoOffsetSec(element);
  const stableKey =
    element.getAttribute("id") ||
    `${authorName}|${displayText}|${videoOffsetSec ?? ""}|${element.getAttribute("author-photo") ?? ""}`;

  return {
    id: `yt-live-${hashString(stableKey)}`,
    site: "youtube-live",
    authorName,
    text: displayText,
    segments: segments.length > 0 ? segments : undefined,
    isSelf,
    videoOffsetSec,
    timestampMs: Date.now(),
    role,
    badges: [],
    isCommand: looksLikeCommand(displayText),
  };
}

/** Chat replay stamps lines with video-offset-time-msec or `#timestamp` clocks.
 * チャットリプレイは video-offset-time-msec または `#timestamp` で秒位置を持つ。 */
function readYouTubeVideoOffsetSec(element: Element): number | undefined {
  const raw =
    element.getAttribute("video-offset-time-msec") ||
    element
      .querySelector("[video-offset-time-msec]")
      ?.getAttribute("video-offset-time-msec");
  if (raw) {
    const msec = Number(raw);
    if (Number.isFinite(msec) && msec >= 0) {
      return msec / 1000;
    }
  }
  const path = element.ownerDocument?.location?.pathname ?? "";
  if (path.startsWith("/live_chat_replay") || isYouTubeChatReplay()) {
    const stamp = element.querySelector("#timestamp")?.textContent?.trim();
    if (stamp) {
      return parseClockToSeconds(stamp, { allowNegative: true });
    }
  }
  return undefined;
}

function resolveYouTubeSelfAuthorName(doc: Document | null): string | null {
  const root = doc ?? document;
  return (
    root
      .querySelector(
        "yt-live-chat-message-input-renderer #author-name, #input-panel #author-name, yt-live-chat-author-chip#author-name",
      )
      ?.textContent?.trim() || null
  );
}

function segmentsToFallbackLabel(count: number): string {
  return count > 0 ? "✦".repeat(Math.min(count, 3)) : "";
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return `${Math.abs(hash)}`;
}

function ensureHiddenChatReceiver(): void {
  // Panel-hosted official iframe already receives chat — skip duplicate.
  // パネル内の公式 iframe が受信していれば、受信用の iframe は追加しない。
  const panelNative = document.getElementById(
    NATIVE_CHAT_FRAME_ID,
  ) as HTMLIFrameElement | null;
  if (
    panelNative &&
    !panelNative.hidden &&
    panelNative.src &&
    !panelNative.src.startsWith("about:blank")
  ) {
    document.getElementById(HIDDEN_LIVE_CHAT_FRAME_ID)?.remove();
    return;
  }

  const pageSrc = resolveYouTubePageChatFrameSrc();
  const fallbackSrc = buildLiveChatUrlFromPage();
  const src = pageSrc || fallbackSrc || "";
  if (!src || src.startsWith("about:blank")) {
    return;
  }

  const existing = document.getElementById(
    HIDDEN_LIVE_CHAT_FRAME_ID,
  ) as HTMLIFrameElement | null;
  if (existing) {
    // Upgrade fallback /live_chat?v= once the page chatframe hydrates with continuation.
    // ページ側の chatframe が後から読み込まれたらフォールバック URL を差し替える。
    if (pageSrc && pageSrc !== existing.src) {
      existing.src = pageSrc;
    }
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.id = HIDDEN_LIVE_CHAT_FRAME_ID;
  iframe.src = src;
  // Keep rendering alive off-screen / 画面外で描画を維持
  iframe.style.cssText =
    "position:fixed;left:-9999px;top:0;width:400px;height:600px;opacity:0;pointer-events:none;border:0;";
  iframe.setAttribute("aria-hidden", "true");
  document.documentElement.appendChild(iframe);
}

function buildLiveChatUrlFromPage(): string | null {
  if (isYouTubeChatReplay()) {
    return null;
  }
  const videoId = resolveYouTubePageVideoId(location.href);
  if (!videoId) {
    return null;
  }
  return `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}&dark_theme=1`;
}

/**
 * Relay primary <video> state/progress to extension-hosted live_chat_replay iframes,
 * since YouTube's ytd-live-chat-frame only syncs its own #chatframe.
 * YouTube の公式枠と同様に、拡張側 live_chat_replay iframe へも再生時刻を中継する。
 */
function bindYouTubeReplaySync(): () => void {
  const boundFrames = new WeakSet<HTMLIFrameElement>();
  const lastSent = new WeakMap<
    HTMLIFrameElement,
    { src: string; state: number; time: number }
  >();
  let attachedVideo: HTMLVideoElement | null = null;
  let disposed = false;
  const listenerAbort = new AbortController();
  const pendingTimers = new Set<number>();

  const scheduleReplaySync = (delayMs: number) => {
    const timer = window.setTimeout(() => {
      pendingTimers.delete(timer);
      if (!disposed) {
        syncAllFrames(true);
      }
    }, delayMs);
    pendingTimers.add(timer);
  };

  const syncAllFrames = (force = false) => {
    if (disposed || isHostVideoAdPlaying()) {
      return;
    }
    const video = resolvePrimaryVideo();
    if (!video || !Number.isFinite(video.currentTime)) {
      return;
    }
    const state = video.paused ? 2 : 1;
    const time = video.currentTime;
    const candidates = [
      document.getElementById(NATIVE_CHAT_FRAME_ID),
      document.getElementById(HIDDEN_LIVE_CHAT_FRAME_ID),
    ];
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLIFrameElement)) {
        continue;
      }
      if (!boundFrames.has(candidate)) {
        boundFrames.add(candidate);
        candidate.addEventListener(
          "load",
          () => {
            if (disposed) {
              return;
            }
            lastSent.delete(candidate);
            try {
              candidate.contentDocument?.addEventListener(
                "click",
                () => {
                  scheduleReplaySync(450);
                },
                { capture: true, signal: listenerAbort.signal },
              );
            } catch {
              // Cross-origin frame — ignore.
            }
            syncAllFrames(true);
            scheduleReplaySync(350);
          },
          { signal: listenerAbort.signal },
        );
      }
      if (candidate.hidden || !candidate.contentWindow) {
        continue;
      }
      const rawUrl = readYouTubeIframeUrl(candidate);
      if (!rawUrl) {
        continue;
      }
      let targetOrigin: string;
      try {
        const parsed = new URL(rawUrl);
        if (
          parsed.protocol !== "https:" ||
          !isYouTubeHost(parsed.hostname) ||
          !/^\/live_chat_replay(?:\/|$)/.test(parsed.pathname)
        ) {
          continue;
        }
        targetOrigin = parsed.origin;
      } catch {
        continue;
      }
      const prev = lastSent.get(candidate);
      // Do not wipe YouTube's initial replay list down to t=0 while still paused at 0s.
      // 初回読み込みで再生位置が 0 秒のまま一時停止している場合は、0 秒へのシークを送らず、公式リプレイの初期表示を保つ。
      if (!prev && video.paused && time === 0) {
        continue;
      }
      if (
        !force &&
        prev &&
        prev.src === rawUrl &&
        prev.state === state &&
        Math.abs(prev.time - time) < 0.05
      ) {
        continue;
      }
      lastSent.set(candidate, { src: rawUrl, state, time });
      if (force || !prev || prev.src !== rawUrl || prev.state !== state) {
        candidate.contentWindow.postMessage(
          { "yt-player-state-change": state },
          targetOrigin,
        );
      }
      candidate.contentWindow.postMessage(
        { "yt-player-video-progress": time },
        targetOrigin,
      );
    }
  };

  const onProgress = () => syncAllFrames(false);
  const onSeekOrState = () => syncAllFrames(true);

  const attachVideo = (next: HTMLVideoElement | null) => {
    if (attachedVideo === next) {
      return;
    }
    if (attachedVideo) {
      attachedVideo.removeEventListener("timeupdate", onProgress);
      attachedVideo.removeEventListener("seeked", onSeekOrState);
      attachedVideo.removeEventListener("play", onSeekOrState);
      attachedVideo.removeEventListener("pause", onSeekOrState);
      attachedVideo.removeEventListener("playing", onSeekOrState);
    }
    attachedVideo = next;
    if (attachedVideo) {
      attachedVideo.addEventListener("timeupdate", onProgress);
      attachedVideo.addEventListener("seeked", onSeekOrState);
      attachedVideo.addEventListener("play", onSeekOrState);
      attachedVideo.addEventListener("pause", onSeekOrState);
      attachedVideo.addEventListener("playing", onSeekOrState);
      syncAllFrames(true);
    }
  };

  attachVideo(resolvePrimaryVideo());
  syncAllFrames(true);
  const timer = window.setInterval(() => {
    attachVideo(resolvePrimaryVideo());
    syncAllFrames(false);
  }, 500);

  return () => {
    disposed = true;
    listenerAbort.abort();
    for (const pending of pendingTimers) {
      window.clearTimeout(pending);
    }
    pendingTimers.clear();
    window.clearInterval(timer);
    attachVideo(null);
  };
}

async function trySendViaNativeInput(text: string): Promise<boolean> {
  const candidates = [
    document.querySelector<HTMLIFrameElement>("iframe#chatframe"),
    document.querySelector<HTMLIFrameElement>("ytd-live-chat-frame iframe"),
    document.querySelector<HTMLIFrameElement>(`iframe#${NATIVE_CHAT_FRAME_ID}`),
    document.querySelector<HTMLIFrameElement>(
      `iframe#${HIDDEN_LIVE_CHAT_FRAME_ID}`,
    ),
  ];
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  for (const chatFrame of candidates) {
    let doc: Document | null = null;
    try {
      doc = chatFrame?.contentDocument ?? null;
    } catch {
      doc = null;
    }
    if (!doc) {
      continue;
    }
    const input = doc.querySelector<HTMLElement>(
      "#input.yt-live-chat-text-input-field-renderer, div#input[contenteditable], #input",
    );
    const sendButton = doc.querySelector<HTMLElement>(
      "#send-button button, yt-button-renderer#send-button button",
    );
    if (!input || !canClickNativeButton(sendButton)) {
      continue;
    }
    if (!fillNativeInput(input, text)) {
      if (
        chatFrame?.id === HIDDEN_LIVE_CHAT_FRAME_ID &&
        previousFocus?.isConnected
      ) {
        previousFocus.focus({ preventScroll: true });
      }
      return false;
    }
    sendButton.click();
    if (
      chatFrame?.id === HIDDEN_LIVE_CHAT_FRAME_ID &&
      previousFocus?.isConnected
    ) {
      previousFocus.focus({ preventScroll: true });
    }
    return true;
  }
  return false;
}

export {
  isYouTubeLiveChatContext,
  isYouTubeWatchWithLiveChat,
} from "../../shared/youtube-page";
