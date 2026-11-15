/**
 * Resolve site-specific IDs and official chat popout URLs.
 * サイト固有 ID と公式チャット別窓 URL を解決する。
 */

import type { PopoutOpenPolicy } from "./settings";
import { isYouTubeLiveNow } from "./youtube-page";

export type PopoutSiteKey = "youtube" | "twitch";

export interface PopoutTarget {
  siteKey: PopoutSiteKey;
  url: string;
}

/** Default official-chat popout size / 公式チャット別窓の既定サイズ */
export const DEFAULT_POPOUT_BOUNDS = {
  width: 400,
  height: 720,
} as const;

const TWITCH_RESERVED_SEGMENTS = new Set([
  "directory",
  "downloads",
  "friends",
  "inventory",
  "jobs",
  "p",
  "payments",
  "popout",
  "prime",
  "search",
  "settings",
  "subscriptions",
  "turbo",
  "videos",
  "wallet",
]);

/** YouTube video id from watch / live / shorts URLs / watch・live・shorts から動画 ID */
export function extractYouTubeVideoId(
  href: string = location.href,
): string | null {
  try {
    const url = new URL(href);
    const fromQuery = url.searchParams.get("v");
    if (fromQuery) {
      return fromQuery;
    }
    const liveMatch = url.pathname.match(/^\/live\/([^/?]+)/);
    if (liveMatch?.[1]) {
      return liveMatch[1];
    }
    const shortsMatch = url.pathname.match(/^\/shorts\/([^/?]+)/);
    if (shortsMatch?.[1]) {
      return shortsMatch[1];
    }
    return null;
  } catch {
    return null;
  }
}

/** True on Twitch VOD watch URLs (`/videos/{id}`). / Twitch アーカイブ視聴 URL */
export function isTwitchVodPage(href: string = location.href): boolean {
  try {
    const url = new URL(href);
    return (
      /(^|\.)twitch\.tv$/i.test(url.hostname) &&
      /^\/videos\/\d+/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/** Twitch channel login from path / パスからチャンネル login 名 */
export function extractTwitchChannel(
  href: string = location.href,
): string | null {
  try {
    const url = new URL(href);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) {
      return null;
    }
    if (segments[0] === "videos" || segments[0] === "clip") {
      // VOD/clip pages lack a stable channel in the path alone.
      // VOD／クリップはパスだけではチャンネルが取れない。
      return null;
    }
    if (segments[0] === "popout" && segments[1]) {
      return segments[1];
    }
    const channel = segments[0];
    if (!channel || TWITCH_RESERVED_SEGMENTS.has(channel.toLowerCase())) {
      return null;
    }
    return channel;
  } catch {
    return null;
  }
}

/**
 * Channel login for the current page, including VOD/clip info bars and embedded JSON.
 * 現在ページのチャンネル login。VOD／クリップの情報欄・埋め込み JSON も含む。
 */
export function extractTwitchChannelFromPage(
  href: string = location.href,
): string | null {
  const fromPath = extractTwitchChannel(href);
  if (fromPath) {
    return fromPath;
  }
  if (typeof document === "undefined") {
    return null;
  }
  const anchors = [
    'a[data-a-target="watch-mode-to-channel"]',
    'a[data-test-selector="user-channel-link"]',
    ".channel-info-content a[data-a-target='player-info-title']",
    ".channel-info-content a.tw-link[href^='/']",
    'a[data-a-target="player-info-title"]',
  ];
  for (const selector of anchors) {
    for (const node of Array.from(document.querySelectorAll(selector))) {
      const login = loginFromHref(node.getAttribute("href"));
      if (login) {
        return login;
      }
    }
  }
  for (const script of Array.from(document.querySelectorAll("script"))) {
    const text = script.textContent ?? "";
    const match =
      text.match(
        /"broadcaster(?:_login|Login)"\s*:\s*"([A-Za-z0-9_]{3,25})"/,
      ) ??
      text.match(
        /"channel"\s*:\s*\{[^}]{0,200}?"login"\s*:\s*"([A-Za-z0-9_]{3,25})"/,
      ) ??
      text.match(/"channelLogin"\s*:\s*"([A-Za-z0-9_]{3,25})"/);
    if (match?.[1] && !TWITCH_RESERVED_SEGMENTS.has(match[1].toLowerCase())) {
      return match[1];
    }
  }
  return null;
}

function loginFromHref(href: string | null | undefined): string | null {
  if (!href) {
    return null;
  }
  try {
    const path = href.startsWith("http")
      ? new URL(href).pathname
      : (href.split("?")[0] ?? href);
    const segment = path.split("/").filter(Boolean)[0];
    if (
      !segment ||
      TWITCH_RESERVED_SEGMENTS.has(segment.toLowerCase()) ||
      !/^[A-Za-z0-9_]{3,25}$/.test(segment)
    ) {
      return null;
    }
    return segment;
  } catch {
    return null;
  }
}

export function buildYouTubeLiveChatPopoutUrl(videoId: string): string {
  const params = new URLSearchParams({
    v: videoId,
    is_popout: "1",
    dark_theme: "1",
  });
  return `https://www.youtube.com/live_chat?${params.toString()}`;
}

export function buildTwitchChatPopoutUrl(channel: string): string {
  return `https://www.twitch.tv/popout/${encodeURIComponent(channel)}/chat?popout=`;
}

/**
 * Official chat URL suitable for in-page panel iframe (not the OS popout window).
 * ページ内パネル iframe 向けの公式チャット URL（OS 別窓とは別）。
 */
export function resolveNativePanelChatUrl(
  href: string = location.href,
): string | null {
  try {
    const url = new URL(href);
    if (/(^|\.)youtube\.com$/i.test(url.hostname)) {
      const videoId = extractYouTubeVideoId(href);
      if (!videoId) {
        return null;
      }
      const params = new URLSearchParams({
        v: videoId,
        dark_theme: "1",
      });
      return `https://www.youtube.com/live_chat?${params.toString()}`;
    }
    if (/(^|\.)twitch\.tv$/i.test(url.hostname)) {
      // VOD has no embeddable chat-replay iframe — keep the self-rendered list.
      // VOD に埋め込み可能なチャットリプレイ iframe は無いので自前リストを使う。
      if (isTwitchVodPage(href)) {
        return null;
      }
      const channel = extractTwitchChannelFromPage(href);
      if (!channel) {
        return null;
      }
      const parent = url.hostname;
      return `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?parent=${encodeURIComponent(parent)}&darkpopout`;
    }
    return null;
  } catch {
    return null;
  }
}

/** Build official popout target for the current top-frame page / 現在ページの公式別窓先 */
export function resolvePopoutTarget(
  href: string = location.href,
): PopoutTarget | null {
  try {
    const url = new URL(href);
    if (/(^|\.)youtube\.com$/i.test(url.hostname)) {
      const videoId = extractYouTubeVideoId(href);
      if (!videoId) {
        return null;
      }
      return {
        siteKey: "youtube",
        url: buildYouTubeLiveChatPopoutUrl(videoId),
      };
    }
    if (/(^|\.)twitch\.tv$/i.test(url.hostname)) {
      // Official popout is live chat only — VOD has no chat popout URL.
      // 公式別窓はライブ専用。VOD 用のチャット別窓 URL はない。
      if (isTwitchVodPage(href)) {
        return null;
      }
      const channel = extractTwitchChannelFromPage(href);
      if (!channel) {
        return null;
      }
      return {
        siteKey: "twitch",
        url: buildTwitchChatPopoutUrl(channel),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Twitch channel that looks live right now / いま配信中っぽい Twitch チャンネル */
export function isTwitchLiveNow(): boolean {
  if (!/(^|\.)twitch\.tv$/i.test(location.hostname)) {
    return false;
  }
  if (
    document.querySelector(
      '[data-a-target="player-overlay-offline"], .offline-recommendations-overlay',
    )
  ) {
    return false;
  }
  return Boolean(
    document.querySelector(
      '[data-a-target="player-overlay-live"], .live-indicator-container, video',
    ) && extractTwitchChannel(location.href),
  );
}

/**
 * Resolve popout with open-policy gate (default: current live only).
 * openPolicy を加味した別窓先（既定はいま視聴中のライブのみ）。
 */
export function resolvePopoutTargetForPolicy(
  openPolicy: PopoutOpenPolicy,
  href: string = location.href,
): PopoutTarget | null {
  const target = resolvePopoutTarget(href);
  if (!target) {
    return null;
  }
  if (openPolicy === "anyWatchPage") {
    return target;
  }
  // currentLive — only the stream you are watching now.
  // currentLive — いま視聴中の配信だけ。
  if (target.siteKey === "youtube") {
    return isYouTubeLiveNow() ? target : null;
  }
  if (target.siteKey === "twitch") {
    return isTwitchLiveNow() ? target : null;
  }
  return null;
}
