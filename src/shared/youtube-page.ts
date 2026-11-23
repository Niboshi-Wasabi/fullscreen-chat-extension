import type { MessageRole } from "../core/message";

/**
 * Distinguish live watch vs chat replay; anything else stays inactive.
 * ライブ／チャットリプレイを区別する。それ以外では起動しない。
 */

export function isYouTubeHost(hostname: string = location.hostname): boolean {
  return /(^|\.)youtube\.com$/i.test(hostname);
}

export function isYouTubeLiveChatContext(
  href: string = location.href,
): boolean {
  try {
    const url = new URL(href);
    return (
      isYouTubeHost(url.hostname) &&
      /^\/live_chat(?:_replay)?(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Read a YouTube iframe's active URL, falling back to same-origin location
 * because Polymer can navigate `iframe#chatframe` without setting `src`.
 * 要素の src が空でも、同一オリジンの location.href から実際の URL を読む。
 */
export function readYouTubeIframeUrl(
  frame: Partial<HTMLIFrameElement> | null | undefined,
): string {
  if (!frame) {
    return "";
  }
  try {
    const liveHref =
      frame.contentDocument?.location?.href?.trim() ||
      frame.contentWindow?.location?.href?.trim() ||
      "";
    if (liveHref && !liveHref.startsWith("about:blank")) {
      return liveHref;
    }
  } catch {
    // Cross-origin frame — fall back to attribute/property below.
  }
  const attrSrc = frame.getAttribute?.("src")?.trim() || "";
  if (attrSrc && !attrSrc.startsWith("about:blank")) {
    return attrSrc;
  }
  const propSrc = frame.src?.trim() || "";
  return propSrc && !propSrc.startsWith("about:blank") ? propSrc : "";
}

export function hasChatReplayOnly(): boolean {
  const frame = document.querySelector("ytd-live-chat-frame");
  if (!frame) {
    return false;
  }
  if (
    frame.getAttribute?.("hidden") !== null &&
    frame.getAttribute?.("hidden") !== undefined
  ) {
    return false;
  }
  if (typeof HTMLElement !== "undefined" && frame instanceof HTMLElement) {
    if (frame.hidden) {
      return false;
    }
    if (
      typeof window !== "undefined" &&
      typeof window.getComputedStyle === "function"
    ) {
      const style = window.getComputedStyle(frame);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
    }
  }
  const iframe = frame.querySelector?.("iframe") as
    HTMLIFrameElement | null | undefined;
  const iframeSrc = readYouTubeIframeUrl(iframe);
  if (iframeSrc) {
    try {
      const frameVideoId = new URL(iframeSrc).searchParams.get("v");
      const pageUrl = new URL(location.href);
      const pageVideoId =
        pageUrl.searchParams.get("v") ??
        pageUrl.pathname.match(/^\/live\/([^/?]+)/)?.[1] ??
        null;
      if (frameVideoId && pageVideoId && frameVideoId !== pageVideoId) {
        return false;
      }
    } catch {
      // ignore malformed URL
    }
  }
  if (/\/live_chat_replay(?:[/?#]|$)/i.test(iframeSrc)) {
    return true;
  }
  const text = frame.textContent ?? "";
  return /chat replay|チャットのリプレイ|チャットの再生|replay chat/i.test(
    text,
  );
}

/** Past broadcast / premiere with chat replay UI.
 * チャットリプレイ付きのアーカイブ／プレミア。 */
export function isYouTubeChatReplay(): boolean {
  if (!isYouTubeHost() || isYouTubeLiveChatContext()) {
    return false;
  }
  if (!(
    location.pathname.startsWith("/watch") ||
    location.pathname.startsWith("/live/")
  )) {
    return false;
  }
  if (isYouTubeLiveNowStrict()) {
    return false;
  }
  return hasChatReplayOnly();
}

/** True when the watch page is an active live / premiere with live chat.
 * 進行中ライブ／プレミア（ライブチャット）か。 */
export function isYouTubeLiveNow(): boolean {
  return isYouTubeLiveNowStrict();
}

/**
 * Active live only — explicit UI or /live/ without replay.
 * Do not treat isLiveBroadcast meta or a lone chatframe as live; ended VODs
 * and "chat disabled" frames must not start the live path (ISS-021).
 * 進行中のライブ配信のみ。meta や chatframe が単独で存在しても、ライブとは判定しない（ISS-021）。
 */
function isYouTubeLiveNowStrict(): boolean {
  if (!isYouTubeHost() || isYouTubeLiveChatContext()) {
    return false;
  }
  if (!isYouTubeLiveCapablePath(location.pathname)) {
    return false;
  }
  if (hasChatReplayOnly()) {
    return false;
  }
  if (location.pathname.startsWith("/live/")) {
    return true;
  }
  return hasVisibleLiveUi();
}

/** Watch, /live/<id>, or a channel's /live page. Home, search and Shorts
 * also carry live thumbnails, so they never count.
 * watch・/live/・チャンネルの /live だけ。ホーム等のサムネイルを拾わない。 */
function isYouTubeLiveCapablePath(pathname: string): boolean {
  return (
    /^\/watch(?:\/|$)/.test(pathname) ||
    /^\/live\/[^/]+/.test(pathname) ||
    /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/live\/?$/.test(pathname)
  );
}

// Only the main player and the watched video's metadata. Related-video
// thumbnails and hover previews (their own `.html5-video-player`) also show
// live badges.
// 本体プレイヤーと視聴中の動画情報だけ。関連動画やホバー再生のバッジを拾わない。
const LIVE_UI_SELECTOR = [
  "#movie_player.ytp-live",
  "#movie_player .ytp-live",
  "#movie_player .badge-style-type-live-now",
  "#movie_player .badge-style-type-live-now-alternate",
  "ytd-watch-metadata .badge-style-type-live-now",
  "ytd-watch-metadata .badge-style-type-live-now-alternate",
].join(", ");

function hasVisibleLiveUi(): boolean {
  if (document.querySelector(LIVE_UI_SELECTOR)) {
    return true;
  }
  const liveBadge = document.querySelector<HTMLElement>(
    "#movie_player .ytp-live-badge",
  );
  if (!liveBadge) {
    return false;
  }
  const style = window.getComputedStyle(liveBadge);
  // Note: YouTube sets `disabled` on `.ytp-live-badge` at the live edge while keeping it visible;
  // non-live videos hide it via `display: none`.
  return style.display !== "none" && style.visibility !== "hidden";
}

/** Live now OR chat-replay archive — uses the live-chat adapter path.
 * 配信中またはチャットリプレイ。ライブチャット Adapter 経路を使う。 */
export function isYouTubeWatchWithLiveChat(): boolean {
  return isYouTubeLiveNowStrict() || isYouTubeChatReplay();
}

/** Map YouTube `author-type` / `#author-name[type]` attributes to MessageRole.
 * YouTube の投稿者種別属性を共通ロールへ変換する。 */
export function readYouTubeAuthorRole(element: Element): MessageRole {
  const authorType = (
    element.getAttribute("author-type") ??
    element.querySelector("#author-name")?.getAttribute("type") ??
    ""
  ).toLowerCase();
  if (authorType.includes("owner")) {
    return "owner";
  }
  if (authorType.includes("moderator")) {
    return "moderator";
  }
  if (authorType.includes("member")) {
    return "member";
  }
  return "viewer";
}
