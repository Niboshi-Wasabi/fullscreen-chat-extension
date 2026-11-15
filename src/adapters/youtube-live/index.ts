import {
  fillNativeInput,
  canClickNativeButton,
} from "../../shared/native-compose";
import {
  isChatFrameSource,
  isYouTubeChatMessage,
} from "../../shared/youtube-chat-bridge";
import { looksLikeCommand, type NormalizedMessage } from "../../core/message";
import { NATIVE_CHAT_FRAME_ID } from "../../shared/dom-ids";
import { extractMessageContent } from "../../shared/message-content";
import { extractYouTubeVideoId } from "../../shared/site-ids";
import type { SiteAdapter } from "../types";
import { TOP_FRAME_MESSAGE_TYPE } from "../types";

const HIDDEN_CHAT_IFRAME_ID = "fce-hidden-live-chat-frame";

/**
 * YouTube Live / premiere / chat-replay adapter.
 * YouTube ライブ・プレミア・チャットリプレイ用アダプタ。
 *
 * Hidden iframe keeps receiving when native chat is closed
 * (left:-9999px — avoid display:none which stops rendering).
 * ネイティブチャット閉時も隠し iframe で受信継続
 * （left:-9999px。display:none は描画停止の原因になるので使わない）。
 */
export function createYouTubeLiveAdapter(): SiteAdapter {
  let seen = new WeakSet<Element>();
  let stopped = false;
  let observer: MutationObserver | null = null;
  let onMessage: ((message: NormalizedMessage) => void) | null = null;
  let ensureTimer: number | null = null;

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
    onMessage?.(data.message);
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
      // Short interval so leaving panel/native mode quickly restores the hidden receiver.
      // パネル公式枠を外した直後でも、隠し受信をすぐ立て直す。
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
      observer?.disconnect();
      observer = null;
      if (ensureTimer !== null) {
        window.clearInterval(ensureTimer);
        ensureTimer = null;
      }
      document.getElementById(HIDDEN_CHAT_IFRAME_ID)?.remove();
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
    observer = new MutationObserver(() => {
      scrapeVisibleChatNodes(document);
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

  const authorType =
    element.getAttribute("author-type") ??
    element.querySelector("#author-name")?.getAttribute("type") ??
    "";
  const role = mapAuthorType(authorType);
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

/** Chat replay stamps lines with video-offset-time-msec.
 * チャットリプレイは video-offset-time-msec で秒位置を持つ。 */
function readYouTubeVideoOffsetSec(element: Element): number | undefined {
  const raw =
    element.getAttribute("video-offset-time-msec") ||
    element
      .querySelector("[video-offset-time-msec]")
      ?.getAttribute("video-offset-time-msec");
  if (!raw) {
    return undefined;
  }
  const msec = Number(raw);
  if (!Number.isFinite(msec) || msec < 0) {
    return undefined;
  }
  return msec / 1000;
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

function mapAuthorType(authorType: string): NormalizedMessage["role"] {
  const value = authorType.toLowerCase();
  if (value.includes("owner")) {
    return "owner";
  }
  if (value.includes("moderator")) {
    return "moderator";
  }
  if (value.includes("member")) {
    return "member";
  }
  return "viewer";
}

function ensureHiddenChatReceiver(): void {
  // Panel-hosted official iframe already receives chat — skip duplicate.
  // パネル内の公式 iframe が受信していれば隠し枠は作らない。
  const panelNative = document.getElementById(
    NATIVE_CHAT_FRAME_ID,
  ) as HTMLIFrameElement | null;
  if (
    panelNative &&
    !panelNative.hidden &&
    panelNative.src &&
    !panelNative.src.startsWith("about:blank")
  ) {
    document.getElementById(HIDDEN_CHAT_IFRAME_ID)?.remove();
    return;
  }

  if (document.getElementById(HIDDEN_CHAT_IFRAME_ID)) {
    return;
  }
  const siteFrame =
    document.querySelector<HTMLIFrameElement>("iframe#chatframe") ??
    document.querySelector<HTMLIFrameElement>("ytd-live-chat-frame iframe");
  const src = siteFrame?.src || buildLiveChatUrlFromPage() || "";
  if (!src || src.startsWith("about:blank")) {
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.id = HIDDEN_CHAT_IFRAME_ID;
  iframe.src = src;
  // Keep rendering alive off-screen / 画面外で描画を維持
  iframe.style.cssText =
    "position:fixed;left:-9999px;top:0;width:400px;height:600px;opacity:0;pointer-events:none;border:0;";
  iframe.setAttribute("aria-hidden", "true");
  document.documentElement.appendChild(iframe);
}

function buildLiveChatUrlFromPage(): string | null {
  const videoId = extractYouTubeVideoId(location.href);
  if (!videoId) {
    return null;
  }
  return `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}&dark_theme=1`;
}

async function trySendViaNativeInput(text: string): Promise<boolean> {
  const chatFrame =
    document.querySelector<HTMLIFrameElement>("iframe#chatframe") ??
    document.querySelector<HTMLIFrameElement>("ytd-live-chat-frame iframe") ??
    document.querySelector<HTMLIFrameElement>(
      `iframe#${NATIVE_CHAT_FRAME_ID}, iframe#${HIDDEN_CHAT_IFRAME_ID}`,
    );
  if (!chatFrame?.contentDocument) {
    return false;
  }
  const input = chatFrame.contentDocument.querySelector<HTMLElement>(
    "#input.yt-live-chat-text-input-field-renderer, div#input[contenteditable], #input",
  );
  if (!input) {
    return false;
  }

  const sendButton = chatFrame.contentDocument.querySelector<HTMLElement>(
    "#send-button button, yt-button-renderer#send-button button",
  );
  if (!canClickNativeButton(sendButton) || !fillNativeInput(input, text))
    return false;
  sendButton.click();
  return true;
}

export {
  isYouTubeLiveChatContext,
  isYouTubeWatchWithLiveChat,
} from "../../shared/youtube-page";
