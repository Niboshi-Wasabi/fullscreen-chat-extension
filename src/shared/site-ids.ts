/**
 * Resolve site-specific IDs and official chat popout URLs.
 * サイト固有 ID と公式チャット別窓 URL を解決する。
 */

import { HIDDEN_LIVE_CHAT_FRAME_ID, NATIVE_CHAT_FRAME_ID } from "./dom-ids";
import type { PopoutOpenPolicy } from "./settings";
import {
  isYouTubeChatReplay,
  isYouTubeWatchWithLiveChat,
  readYouTubeIframeUrl,
} from "./youtube-page";

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

export function isTwitchHost(hostname: string = location.hostname): boolean {
  return /(^|\.)twitch\.tv$/i.test(hostname);
}

const TWITCH_RESERVED_SEGMENTS = new Set([
  "activate",
  "chat",
  "clip",
  "clips",
  "directory",
  "downloads",
  "drops",
  "embed",
  "following",
  "friends",
  "inventory",
  "jobs",
  "legal",
  "moderator",
  "p",
  "payments",
  "popout",
  "prime",
  "products",
  "search",
  "security",
  "settings",
  "store",
  "subscriptions",
  "team",
  "teams",
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

/**
 * Extract YouTube video id from URL, falling back to active watch DOM for
 * channel `/live` URLs (`/@handle/live`, `/channel/.../live`).
 * URL から動画 ID を抽出し、チャンネル `/live` URL では watch DOM から補完する。
 */
export function resolveYouTubePageVideoId(
  href: string = location.href,
  doc: Document | undefined = typeof document !== "undefined"
    ? document
    : undefined,
): string | null {
  const fromUrl = extractYouTubeVideoId(href);
  if (fromUrl) {
    return fromUrl;
  }
  if (!doc) {
    return null;
  }
  try {
    const url = new URL(href);
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) {
      return null;
    }
    const docHref =
      doc.location?.href ??
      (typeof location !== "undefined" ? location.href : undefined);
    if (docHref && docHref !== href) {
      return null;
    }
  } catch {
    return null;
  }
  const watchEl = doc.querySelector("ytd-watch-flexy");
  if (!watchEl) {
    return null;
  }
  const attrId = watchEl.getAttribute("video-id")?.trim();
  if (attrId) {
    return attrId;
  }
  const canonical =
    doc
      .querySelector<HTMLLinkElement>("link[rel='canonical']")
      ?.getAttribute("href") ?? "";
  return canonical ? extractYouTubeVideoId(canonical) : null;
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
    if (
      segments[0] === "videos" ||
      segments[0] === "clip" ||
      segments[1]?.toLowerCase() === "clip"
    ) {
      // VOD/clip pages lack a stable live channel in the path alone.
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

const MAX_CACHED_CHAT_FRAMES = 20;
const cachedChatFrameUrls = new Map<string, string>();
const chatFrameOwnerByKey = new Map<string, string>();

function normalizeChatFrameKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    const continuation = url.searchParams.get("continuation");
    if (continuation) {
      return `${url.pathname}?c=${continuation}`;
    }
    const videoId = url.searchParams.get("v");
    if (videoId) {
      return `${url.pathname}?v=${videoId}`;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function recordChatFrameOwner(
  videoId: string,
  url: string,
  overwrite = false,
): void {
  const key = normalizeChatFrameKey(url);
  if (!key) {
    return;
  }
  const existing = chatFrameOwnerByKey.get(key);
  if (existing && !overwrite) {
    return;
  }
  if (chatFrameOwnerByKey.has(key)) {
    chatFrameOwnerByKey.delete(key);
  } else if (chatFrameOwnerByKey.size >= MAX_CACHED_CHAT_FRAMES * 2) {
    const oldest = chatFrameOwnerByKey.keys().next().value;
    if (oldest !== undefined) {
      chatFrameOwnerByKey.delete(oldest);
    }
  }
  chatFrameOwnerByKey.set(key, videoId);
}

/** True when a YouTube chat iframe URL belongs to a different videoId.
 * 別の動画 ID に属する古いチャット iframe URL なら true。 */
export function isStaleYouTubeChatFrameUrl(
  rawUrl: string,
  currentVideoId: string | null | undefined,
): boolean {
  if (!rawUrl || !currentVideoId) {
    return false;
  }
  try {
    const url = new URL(rawUrl);
    const urlVideoId = url.searchParams.get("v");
    if (urlVideoId && urlVideoId !== currentVideoId) {
      return true;
    }
  } catch {
    return false;
  }
  const key = normalizeChatFrameKey(rawUrl);
  const owner = key ? chatFrameOwnerByKey.get(key) : undefined;
  return Boolean(owner && owner !== currentVideoId);
}

/** Tag existing chat frame URLs with the departing videoId before SPA restart.
 * SPA 遷移の再起動前に、旧動画に残っているチャット枠 URL を旧動画 ID に紐付けて保護する。 */
export function markYouTubeWatchTransition(
  previousVideoId: string | null | undefined,
  doc: Document | undefined = typeof document !== "undefined"
    ? document
    : undefined,
): void {
  if (!previousVideoId || !doc) {
    return;
  }
  const selectors = [
    "iframe#chatframe",
    "ytd-live-chat-frame iframe",
    `iframe#${NATIVE_CHAT_FRAME_ID}`,
    `iframe#${HIDDEN_LIVE_CHAT_FRAME_ID}`,
  ];
  for (const frame of Array.from(
    doc.querySelectorAll?.<HTMLIFrameElement>(selectors.join(", ")) ?? [],
  )) {
    const url = readYouTubeIframeUrl(frame);
    if (url && isValidYouTubeChatFrameUrl(url)) {
      recordChatFrameOwner(previousVideoId, url, true);
    }
  }
}

function rememberChatFrameUrl(
  videoId: string,
  url: string,
  verifiedOwner = false,
): string {
  if (cachedChatFrameUrls.has(videoId)) {
    cachedChatFrameUrls.delete(videoId);
  } else if (cachedChatFrameUrls.size >= MAX_CACHED_CHAT_FRAMES) {
    const oldest = cachedChatFrameUrls.keys().next().value;
    if (oldest !== undefined) {
      cachedChatFrameUrls.delete(oldest);
    }
  }
  cachedChatFrameUrls.set(videoId, url);
  recordChatFrameOwner(videoId, url, verifiedOwner);
  return url;
}

function isValidYouTubeChatFrameUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      /(^|\.)youtube\.com$/i.test(url.hostname) &&
      /^\/live_chat(?:_replay)?(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

const pendingChatFrameResolves = new Map<string, Promise<string | null>>();
const attemptedChatFrameFetches = new Set<string>();

function extractBalancedJsonObject(
  text: string,
  braceIndex: number,
): string | null {
  if (text[braceIndex] !== "{") {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = braceIndex; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(braceIndex, i + 1);
      }
    }
  }
  return null;
}

export function extractYouTubeChatUrlFromScriptText(
  text: string,
  videoId: string,
): string | null {
  if (
    !text.includes("liveChatRenderer") ||
    !text.includes("reloadContinuationData")
  ) {
    return null;
  }
  for (const marker of ["var ytInitialData = ", 'window["ytInitialData"] = ']) {
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const idx = text.indexOf(marker, searchFrom);
      if (idx < 0) {
        break;
      }
      const braceStart = idx + marker.length;
      searchFrom = braceStart + 1;
      const jsonText = extractBalancedJsonObject(text, braceStart);
      if (!jsonText) {
        continue;
      }
      try {
        const data = JSON.parse(jsonText) as {
          currentVideoEndpoint?: { watchEndpoint?: { videoId?: string } };
          contents?: {
            twoColumnWatchNextResults?: {
              conversationBar?: {
                liveChatRenderer?: {
                  isReplay?: boolean;
                  continuations?: Array<{
                    reloadContinuationData?: { continuation?: string };
                  }>;
                };
              };
            };
          };
        };
        const pageVideoId = data.currentVideoEndpoint?.watchEndpoint?.videoId;
        if (pageVideoId && pageVideoId !== videoId) {
          continue;
        }
        const renderer =
          data.contents?.twoColumnWatchNextResults?.conversationBar
            ?.liveChatRenderer;
        const continuation =
          renderer?.continuations?.[0]?.reloadContinuationData?.continuation;
        if (
          typeof continuation !== "string" ||
          !continuation ||
          /\s/.test(continuation)
        ) {
          continue;
        }
        const path = renderer?.isReplay ? "/live_chat_replay" : "/live_chat";
        return `https://www.youtube.com${path}?continuation=${encodeURIComponent(continuation)}&dark_theme=1`;
      } catch {
        // Ignore unparseable script blocks.
      }
    }
  }
  return null;
}

function readYtInitialDataChatUrl(
  doc: Document,
  videoId: string,
): string | null {
  const scripts = doc.querySelectorAll?.("script");
  if (!scripts) {
    return null;
  }
  for (const script of Array.from(scripts)) {
    const found = extractYouTubeChatUrlFromScriptText(
      script.textContent ?? "",
      videoId,
    );
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Resolve continuation-backed chat URL when YouTube SPA navigation leaves
 * ytd-live-chat-frame collapsed and inline <script> ytInitialData stale.
 * SPA 遷移直後に公式枠が閉じたままのとき、同一オリジン HTML から continuation を取得する。
 */
export function ensureYouTubeChatFrameSrc(
  href: string = location.href,
): Promise<string | null> {
  const existing = resolveYouTubePageChatFrameSrc(document, href);
  if (existing) {
    return Promise.resolve(existing);
  }
  const videoId = resolveYouTubePageVideoId(href, document);
  if (
    !videoId ||
    typeof fetch !== "function" ||
    !document.querySelector("ytd-live-chat-frame")
  ) {
    return Promise.resolve(null);
  }
  let targetOrigin: string;
  try {
    const parsed = new URL(href);
    if (
      parsed.protocol !== "https:" ||
      !/(^|\.)youtube\.com$/i.test(parsed.hostname)
    ) {
      return Promise.resolve(null);
    }
    targetOrigin = parsed.origin;
  } catch {
    return Promise.resolve(null);
  }
  const pending = pendingChatFrameResolves.get(videoId);
  if (pending) {
    return pending;
  }
  if (attemptedChatFrameFetches.has(videoId)) {
    return Promise.resolve(null);
  }
  attemptedChatFrameFetches.add(videoId);
  const task = fetch(`${targetOrigin}/watch?v=${encodeURIComponent(videoId)}`, {
    credentials: "same-origin",
  })
    .then(async (response) => {
      if (!response.ok) {
        attemptedChatFrameFetches.delete(videoId);
        return null;
      }
      const html = await response.text();
      const found = extractYouTubeChatUrlFromScriptText(html, videoId);
      if (!found) {
        attemptedChatFrameFetches.delete(videoId);
        return null;
      }
      return rememberChatFrameUrl(videoId, found, true);
    })
    .catch(() => {
      attemptedChatFrameFetches.delete(videoId);
      return null;
    })
    .finally(() => {
      pendingChatFrameResolves.delete(videoId);
    });
  pendingChatFrameResolves.set(videoId, task);
  return task;
}

/** Prefer the watch page's own chatframe, cached per videoId across collapse,
 * or recover the continuation from inline ytInitialData when pre-collapsed (ISS-022).
 * ページ側 chatframe（閉じる操作後はキャッシュおよび ytInitialData）を優先する。 */
export function resolveYouTubePageChatFrameSrc(
  doc: Document = document,
  href: string | undefined = doc.location?.href ??
    (typeof location !== "undefined" ? location.href : undefined),
): string | null {
  const videoId = href ? resolveYouTubePageVideoId(href, doc) : null;
  const siteFrame =
    doc.querySelector<HTMLIFrameElement>("iframe#chatframe") ??
    doc.querySelector<HTMLIFrameElement>("ytd-live-chat-frame iframe");
  const src = readYouTubeIframeUrl(siteFrame);
  if (
    src &&
    isValidYouTubeChatFrameUrl(src) &&
    !isStaleYouTubeChatFrameUrl(src, videoId)
  ) {
    return videoId ? rememberChatFrameUrl(videoId, src) : src;
  }
  if (!videoId) {
    return null;
  }
  const cached = cachedChatFrameUrls.get(videoId);
  if (cached && !isStaleYouTubeChatFrameUrl(cached, videoId)) {
    return cached;
  }
  const fromScript = readYtInitialDataChatUrl(doc, videoId);
  return fromScript ? rememberChatFrameUrl(videoId, fromScript, true) : null;
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
      // Prefer the sidebar chatframe — constructed /live_chat?v= can show
      // "chat disabled" while the page frame still works (ISS-022).
      // サイドバー枠を優先。自前 live_chat URL だけ拒否される配信がある。
      const pageSrc = resolveYouTubePageChatFrameSrc(document, href);
      if (pageSrc) {
        return pageSrc;
      }
      // Replay pages cannot use `/live_chat?v=` (YouTube shows "chat disabled"); wait for continuation URL.
      // リプレイでは `/live_chat?v=` が無効扱いになるため、continuation URL 取得まで待機する。
      if (isYouTubeChatReplay()) {
        return null;
      }
      const videoId = resolveYouTubePageVideoId(href);
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

function buildYouTubeReplayPopoutUrl(replaySrc: string): string | null {
  try {
    const parsed = new URL(replaySrc);
    if (
      parsed.protocol !== "https:" ||
      !/(^|\.)youtube\.com$/i.test(parsed.hostname) ||
      !/^\/live_chat_replay(?:\/|$)/i.test(parsed.pathname)
    ) {
      return null;
    }
    parsed.searchParams.set("is_popout", "1");
    return parsed.toString();
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
      const isReplay =
        typeof document !== "undefined" &&
        typeof location !== "undefined" &&
        isYouTubeChatReplay();
      if (isReplay) {
        const replaySrc = resolveYouTubePageChatFrameSrc(document, href);
        const replayUrl = replaySrc
          ? buildYouTubeReplayPopoutUrl(replaySrc)
          : null;
        return replayUrl ? { siteKey: "youtube", url: replayUrl } : null;
      }
      const videoId = resolveYouTubePageVideoId(href);
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

/** Twitch channel that looks live right now / 配信中と推定できる Twitch チャンネル */
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
 * Resolve popout with open-policy gate (default: current live / premiere / chat-replay watch).
 * openPolicy を加味した別窓先（既定はいま視聴中のライブ・プレミア・チャットリプレイのみ）。
 */
export function resolvePopoutTargetForPolicy(
  openPolicy: PopoutOpenPolicy,
  href: string = location.href,
): PopoutTarget | null {
  const target = resolvePopoutTarget(href);
  if (!target) {
    return null;
  }
  // YouTube always needs live, premiere, or chat replay: regular videos are
  // out of scope (ISS-027). anyWatchPage only widens Twitch channel pages.
  // YouTube は常にライブ／プレミア／リプレイのみ（ISS-027）。広げるのは Twitch だけ。
  if (target.siteKey === "youtube") {
    return isYouTubeWatchWithLiveChat() ? target : null;
  }
  if (target.siteKey === "twitch") {
    return openPolicy === "anyWatchPage" || isTwitchLiveNow() ? target : null;
  }
  return null;
}
