/**
 * Distinguish live watch vs chat replay vs regular comment pages.
 * ライブ／チャットリプレイ／通常コメントページを区別する。
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
      url.pathname.startsWith("/live_chat") || url.href.includes("live_chat")
    );
  } catch {
    return false;
  }
}

export function hasChatReplayOnly(): boolean {
  const frame = document.querySelector("ytd-live-chat-frame");
  if (!frame) {
    return false;
  }
  const text = frame.textContent ?? "";
  return /chat replay|チャットの再生|replay chat/i.test(text);
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

function isYouTubeLiveNowStrict(): boolean {
  if (!isYouTubeHost() || isYouTubeLiveChatContext()) {
    return false;
  }
  if (location.pathname.startsWith("/live/")) {
    // /live/ URL can still be an ended premiere with replay.
    // /live/ でも終了済み＋リプレイのことがある。
    if (hasChatReplayOnly()) {
      return false;
    }
    return true;
  }

  const liveMeta = document.querySelector(
    'meta[itemprop="isLiveBroadcast"][content="True"], meta[itemprop="isLiveBroadcast"][content="true"]',
  );
  if (liveMeta && !hasChatReplayOnly()) {
    return true;
  }

  if (document.querySelector(".badge-style-type-live-now, .ytp-live")) {
    if (!hasChatReplayOnly()) {
      return true;
    }
  }

  const liveBadge = document.querySelector<HTMLElement>(".ytp-live-badge");
  if (liveBadge) {
    const style = window.getComputedStyle(liveBadge);
    const disabled = liveBadge.hasAttribute("disabled");
    if (
      !disabled &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    ) {
      if (!hasChatReplayOnly()) {
        return true;
      }
    }
  }

  if (hasChatReplayOnly()) {
    return false;
  }

  return Boolean(
    document.querySelector("ytd-live-chat-frame iframe, iframe#chatframe"),
  );
}

/** Live now OR chat-replay archive — uses the live-chat adapter path.
 * 配信中またはチャットリプレイ。ライブチャット Adapter 経路を使う。 */
export function isYouTubeWatchWithLiveChat(): boolean {
  return isYouTubeLiveNowStrict() || isYouTubeChatReplay();
}

/** Regular watch / Shorts without live chat or chat replay.
 * ライブ／リプレイが無い通常 watch／Shorts。 */
export function isYouTubeWatchWithComments(): boolean {
  if (!isYouTubeHost() || isYouTubeLiveChatContext()) {
    return false;
  }
  const path = location.pathname;
  if (!(path.startsWith("/watch") || path.startsWith("/shorts/"))) {
    return false;
  }
  if (isYouTubeLiveNowStrict() || isYouTubeChatReplay()) {
    return false;
  }
  return true;
}
