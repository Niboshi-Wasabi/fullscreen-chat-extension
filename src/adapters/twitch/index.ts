import {
  fillNativeInput,
  canClickNativeButton,
} from "../../shared/native-compose";
import { mapTwitchRole, readTwitchBadgeIcons } from "../../shared/twitch-role";
import {
  createMessageId,
  looksLikeCommand,
  type NormalizedMessage,
} from "../../core/message";
import { extractMessageContent } from "../../shared/message-content";
import {
  extractTwitchChannel,
  extractTwitchChannelFromPage,
  isTwitchHost,
  isTwitchVodPage,
} from "../../shared/site-ids";
import {
  loadSettings,
  watchSettings,
  type ExtensionSettings,
} from "../../shared/settings";
import {
  applyEmoteMapToSegments,
  extractTwitchUserIdFromPage,
  loadTwitchEmoteMap,
  type EmoteCodeMap,
} from "../../shared/twitch-emotes";
import { parseClockToSeconds } from "../../core/archive-sync";
import {
  isChatColumnCollapseLabel,
  isChatColumnExpandLabel,
  setTwitchChatReinitializing,
  TWITCH_COLLAPSE_TOGGLE as CHAT_COLLAPSE_TOGGLE_SELECTOR,
} from "../../shared/page-chat-column";
import { getPageMediaTimeSec } from "../../shared/video-clock";
import type { SiteAdapter } from "../types";

const CHAT_CONTAINER_SELECTOR =
  '[data-test-selector="chat-scrollable-area__message-container"]';
const CHAT_MESSAGE_SELECTOR =
  '[data-a-target="chat-line-message"], .chat-line__message';
const CHAT_AUTHOR_SELECTOR = '[data-a-target="chat-message-username"]';
const CHAT_BODY_SELECTOR = '[data-a-target="chat-line-message-body"]';
const CHAT_TEXT_FRAGMENT_SELECTOR = '[data-a-target="chat-message-text"]';
const VOD_CHAT_CONTAINER_SELECTOR =
  ".video-chat__message-list-wrapper, .video-chat__message-list, .video-chat ul";
const VOD_CHAT_MESSAGE_SELECTOR = ".vod-message, .video-chat__message";
const VOD_MESSAGE_ROW_SELECTOR = `${VOD_CHAT_MESSAGE_SELECTOR}, [data-a-target="chat-line-message"]`;
const CHAT_INPUT_SELECTOR =
  'textarea[data-a-target="chat-input"], [data-a-target="chat-input"]';
const CHAT_SEND_SELECTOR = 'button[data-a-target="chat-send-button"]';

/** Brief reopen keeps Twitch chat DOM updating while appearing collapsed.
 * 短く開閉して、閉じた表示に戻しつつ、受信に使う DOM を復元する。 */
const CHAT_REOPEN_CLOSE_DELAY_MS = 80;

export interface TwitchAdapterOptions {
  /** Only briefly toggle Twitch's collapsed column when a self-rendered surface needs DOM chat.
   * 自前リスト／弾幕などページ側 DOM 受信が必要なときだけ折りたたんだチャット欄を一時的に開き直す。 */
  shouldRecoverCollapsedChat?: () => boolean;
}

/**
 * Twitch live / VOD chat adapter.
 * Twitch ライブ／VOD チャットアダプタ。
 */
export function createTwitchAdapter(
  options: TwitchAdapterOptions = {},
): SiteAdapter {
  const shouldRecoverCollapsedChat =
    options.shouldRecoverCollapsedChat ?? (() => true);
  let seen = new WeakMap<Element, string>();
  let stopped = false;
  let onMessage: ((message: NormalizedMessage) => void) | null = null;
  let chatObserver: MutationObserver | null = null;
  let bodyObserver: MutationObserver | null = null;
  let observedContainer: Element | null = null;
  let ensureTimer: number | null = null;
  let reinitTimer: number | null = null;
  let isReinitializingChat = false;
  let reinitAttemptedWhileCollapsed = false;
  let lastPathname = location.pathname;
  let emoteMap: EmoteCodeMap = new Map();
  let emotesEnabled = false;
  let emoteGeneration = 0;
  let emoteAbort: AbortController | null = null;
  let unwatch: (() => void) | null = null;

  return {
    site: "twitch",
    start(callback) {
      stopped = false;
      seen = new WeakMap<Element, string>();
      onMessage = callback;
      lastPathname = location.pathname;
      reinitAttemptedWhileCollapsed = false;
      void refreshEmoteMap();
      unwatch = watchSettings((next, previous) => {
        if (next.twitch.thirdPartyEmotes !== previous?.twitch.thirdPartyEmotes)
          void refreshEmoteMap(next);
      });
      ensureChatObserved();
      maybeRecoverCollapsedChat();

      bodyObserver = new MutationObserver(() => {
        if (stopped) {
          return;
        }
        checkChannelChange();
        ensureChatObserved();
        maybeRecoverCollapsedChat();
      });
      bodyObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      ensureTimer = window.setInterval(() => {
        if (!stopped) {
          ensureChatObserved();
          maybeRecoverCollapsedChat();
        }
      }, 4000);
    },
    stop() {
      stopped = true;
      emoteGeneration++;
      emoteAbort?.abort();
      unwatch?.();
      unwatch = null;
      onMessage = null;
      chatObserver?.disconnect();
      chatObserver = null;
      bodyObserver?.disconnect();
      bodyObserver = null;
      observedContainer = null;
      emoteMap = new Map();
      if (ensureTimer !== null) {
        window.clearInterval(ensureTimer);
        ensureTimer = null;
      }
      if (reinitTimer !== null) {
        window.clearTimeout(reinitTimer);
        reinitTimer = null;
      }
      isReinitializingChat = false;
      reinitAttemptedWhileCollapsed = false;
      setTwitchChatReinitializing(false);
    },
    async sendMessage(text) {
      return stopped ? false : trySendViaNativeInput(text);
    },
  };

  async function refreshEmoteMap(next?: ExtensionSettings): Promise<void> {
    const generation = ++emoteGeneration;
    emoteAbort?.abort();
    emoteMap = new Map();
    let settings = next;
    if (!settings) {
      try {
        settings = await loadSettings();
      } catch {
        return;
      }
    }
    if (stopped || generation !== emoteGeneration) return;
    emotesEnabled = settings.twitch.thirdPartyEmotes;
    if (!emotesEnabled) return;
    const controller = new AbortController();
    emoteAbort = controller;
    const map = await loadTwitchEmoteMap({
      channelLogin: extractTwitchChannelFromPage(),
      channelId: extractTwitchUserIdFromPage(),
      signal: controller.signal,
    });
    if (
      !stopped &&
      generation === emoteGeneration &&
      !controller.signal.aborted
    )
      emoteMap = map;
  }

  function ensureChatObserved(): void {
    const container = resolveChatContainer();
    if (!container || container === observedContainer) {
      return;
    }
    chatObserver?.disconnect();
    observedContainer = container;
    chatObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // React can hydrate/reuse a row without adding another row element.
        const target =
          mutation.target instanceof Element
            ? mutation.target
            : mutation.target.parentElement;
        const row =
          target?.closest(`${CHAT_MESSAGE_SELECTOR}, .vod-message`) ??
          target?.closest(".video-chat__message");
        if (row) ingestMessageElement(row);
        mutation.addedNodes.forEach((node) => handleAddedNode(node));
      }
    });
    chatObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-id", "data-message-id", "id"],
    });
    container
      .querySelectorAll(`${CHAT_MESSAGE_SELECTOR}, ${VOD_MESSAGE_ROW_SELECTOR}`)
      .forEach((element) => ingestMessageElement(element));
  }

  function resolveChatContainer(): Element | null {
    if (isTwitchVodPage()) {
      return (
        document.querySelector(VOD_CHAT_CONTAINER_SELECTOR) ??
        document.querySelector(".video-chat") ??
        document.querySelector(CHAT_CONTAINER_SELECTOR)
      );
    }
    return (
      document.querySelector(CHAT_CONTAINER_SELECTOR) ??
      document.querySelector(VOD_CHAT_CONTAINER_SELECTOR)
    );
  }

  function handleAddedNode(node: Node): void {
    if (!(node instanceof Element)) {
      return;
    }
    const matches = [
      ...collectMatching(node, CHAT_MESSAGE_SELECTOR),
      ...collectMatching(node, VOD_CHAT_MESSAGE_SELECTOR),
    ];
    for (const element of matches) {
      ingestMessageElement(element);
    }
  }

  function ingestMessageElement(element: Element): void {
    // In Twitch VOD DOM, .video-chat__message sits inside .vod-message — prefer the outer row.
    element =
      element.closest('[data-a-target="chat-line-message"], .vod-message') ??
      element.closest(".video-chat__message") ??
      element;
    const parsed = parseTwitchMessage(element, emotesEnabled ? emoteMap : null);
    if (parsed) {
      const fingerprint = JSON.stringify([
        parsed.id,
        parsed.authorName,
        parsed.text,
      ]);
      if (seen.get(element) === fingerprint) return;
      seen.set(element, fingerprint);
      onMessage?.(parsed);
    }
  }

  function checkChannelChange(): void {
    if (location.pathname === lastPathname) {
      return;
    }
    lastPathname = location.pathname;
    observedContainer = null;
    reinitAttemptedWhileCollapsed = false;
    chatObserver?.disconnect();
    chatObserver = null;
    void refreshEmoteMap();
    ensureChatObserved();
    if (isNativeChatCollapsed() && shouldRecoverCollapsedChat()) {
      reinitializeCollapsedChat();
    }
  }

  function maybeRecoverCollapsedChat(): void {
    if (isTwitchVodPage() || !isNativeChatCollapsed()) {
      reinitAttemptedWhileCollapsed = false;
      return;
    }
    if (document.querySelector(CHAT_CONTAINER_SELECTOR)) {
      reinitAttemptedWhileCollapsed = false;
      return;
    }
    if (reinitAttemptedWhileCollapsed || !shouldRecoverCollapsedChat()) {
      return;
    }
    // If container is missing while collapsed, Twitch stopped updating chat.
    // 折りたたみ中にコンテナがなくなると受信も止まるため、監視を初期化し直す。
    reinitializeCollapsedChat();
  }

  function reinitializeCollapsedChat(): void {
    if (isReinitializingChat || stopped) {
      return;
    }
    const toggle = document.querySelector(CHAT_COLLAPSE_TOGGLE_SELECTOR);
    if (!(toggle instanceof HTMLElement)) {
      return;
    }
    isReinitializingChat = true;
    reinitAttemptedWhileCollapsed = true;
    setTwitchChatReinitializing(true);
    try {
      toggle.click();
    } catch (error) {
      isReinitializingChat = false;
      setTwitchChatReinitializing(false);
      throw error;
    }
    reinitTimer = window.setTimeout(() => {
      reinitTimer = null;
      try {
        if (stopped) {
          return;
        }
        const closeToggle = document.querySelector(
          CHAT_COLLAPSE_TOGGLE_SELECTOR,
        );
        if (
          closeToggle instanceof HTMLElement &&
          isExpandedToggle(closeToggle)
        ) {
          closeToggle.click();
        }
      } finally {
        isReinitializingChat = false;
        setTwitchChatReinitializing(false);
      }
      if (!stopped) {
        ensureChatObserved();
      }
    }, CHAT_REOPEN_CLOSE_DELAY_MS);
  }
}

function isNativeChatCollapsed(): boolean {
  const toggle = document.querySelector(CHAT_COLLAPSE_TOGGLE_SELECTOR);
  if (!(toggle instanceof HTMLElement)) {
    return false;
  }
  // Expand / 展開 means currently collapsed / 「展開」＝いま閉じている
  return isChatColumnExpandLabel(toggle.getAttribute("aria-label") ?? "");
}

function isExpandedToggle(toggle: HTMLElement): boolean {
  return isChatColumnCollapseLabel(toggle.getAttribute("aria-label") ?? "");
}

const elementIds = new WeakMap<Element, string>();

export function parseTwitchMessage(
  element: Element,
  emoteMap: EmoteCodeMap | null,
): NormalizedMessage | null {
  const authorEl =
    element.querySelector(CHAT_AUTHOR_SELECTOR) ??
    element.querySelector(".vod-message__header .chat-author__display-name") ??
    element.querySelector(".chat-author__display-name") ??
    element.querySelector(
      '.vod-message__header [data-a-target="chat-message-username"]',
    );
  const authorName = authorEl?.textContent?.trim() || "unknown";
  const rawIntlLogin = element
    .querySelector(".chat-author__intl-login")
    ?.textContent?.trim();
  const authorLogin = rawIntlLogin
    ? rawIntlLogin.replace(/^\((.*)\)$/, "$1").trim() || undefined
    : undefined;
  const authorColor = readSafeTwitchAuthorColor(authorEl);

  const bodyEl =
    element.querySelector(CHAT_BODY_SELECTOR) ??
    element.querySelector(".vod-message__message") ??
    element.querySelector(".video-chat__message");
  const fromBody = extractMessageContent(bodyEl);
  let text = fromBody.text;
  let segments = fromBody.segments;

  if (
    bodyEl?.classList?.contains("video-chat__message") &&
    bodyEl.firstElementChild?.textContent?.trim() === ":"
  ) {
    if (segments[0]?.type === "text" && segments[0].text.startsWith(":")) {
      const stripped = segments[0].text.slice(1).replace(/^\s+/, "");
      if (stripped) {
        segments[0] = { type: "text", text: stripped };
      } else {
        segments.shift();
      }
    }
    text = text.replace(/^:\s*/, "");
  }

  if (!text && segments.length === 0) {
    const fragments = Array.from(
      element.querySelectorAll(
        `${CHAT_TEXT_FRAGMENT_SELECTOR}, .text-fragment`,
      ),
    );
    if (fragments.length > 0) {
      const joined = fragments
        .map((node) => extractMessageContent(node))
        .reduce(
          (acc, part) => {
            acc.text += part.text;
            acc.segments.push(...part.segments);
            return acc;
          },
          { text: "", segments: [] as typeof segments },
        );
      text = joined.text.trim();
      segments = joined.segments;
    }
  }

  if (!text && segments.length === 0) {
    text = element.querySelector(".text-fragment")?.textContent?.trim() ?? "";
  }
  if (emoteMap && emoteMap.size > 0) {
    const expanded = applyEmoteMapToSegments(segments, text, emoteMap);
    text = expanded.text;
    segments = expanded.segments;
  }
  // Allow emote-only lines / 絵文字・エモートのみの行も通す
  if (!text && segments.length === 0) {
    return null;
  }

  const badgeIcons = readTwitchBadgeIcons(element);
  const badges = badgeIcons.map((badge) => badge.alt);
  const iconsWithSrc = badgeIcons.filter(
    (badge): badge is { alt: string; src: string } => Boolean(badge.src),
  );

  const role = mapTwitchRole(badges, element);
  const selfName = resolveTwitchSelfAuthorName();
  const isSelf =
    element.classList.contains("chat-line__message--self") ||
    element.querySelector(".chat-line__message--self") !== null ||
    (selfName !== null &&
      selfName.localeCompare(authorName, undefined, {
        sensitivity: "accent",
      }) === 0);

  const displayText = text || (segments.length > 0 ? "✦" : "");
  const videoOffsetSec = readTwitchVodOffsetSec(element);
  const nativeId =
    element.getAttribute("data-id") ||
    element.getAttribute("data-message-id") ||
    element.id;
  // Without a native ID, keep hydration/edits on the same DOM row under one ID.
  // Identical virtualized posts with no ID cannot be distinguished reliably.
  let id = nativeId ? `twitch-${nativeId}` : elementIds.get(element);
  if (!id) {
    id = createMessageId("twitch-dom");
    elementIds.set(element, id);
  }

  return {
    id,
    site: "twitch",
    authorName,
    authorLogin,
    authorColor,
    text: displayText,
    segments: segments.length > 0 ? segments : undefined,
    isSelf,
    videoOffsetSec,
    timestampMs: Date.now(),
    role,
    badges,
    badgeIcons: iconsWithSrc.length > 0 ? iconsWithSrc : undefined,
    isCommand: looksLikeCommand(displayText),
  };
}

/** VOD chat timestamps look like 0:12:34 or 12:34, or `?t=` links.
 * VOD チャットの時刻表示（0:12:34 / 12:34）や `?t=` リンクを秒へ。 */
export function readTwitchVodOffsetSec(element: Element): number | undefined {
  if (!isTwitchVodPage()) {
    return undefined;
  }
  const stampNode = element.querySelector(
    '[data-a-target="chat-timestamp"], .vod-message__timestamp, .chat-line__timestamp, .vod-message__header a[href*="t="]',
  );
  // Prefer any href (anchor or mock) over instanceof — works across realms/tests.
  // Never scan links inside chat message bodies or pasted links will fake timestamps.
  const fromHref = parseTwitchTimeParam(stampNode?.getAttribute("href"));
  if (fromHref !== undefined) {
    return fromHref;
  }
  const stampCandidates = [
    stampNode?.textContent?.trim(),
    ...Array.from(
      element.querySelectorAll?.(
        ".vod-message__header button, .vod-message__header p",
      ) ?? [],
    ).map((node) => node.textContent?.trim()),
    element.getAttribute?.("data-a-target-timestamp"),
  ];
  for (const stamp of stampCandidates) {
    if (!stamp) {
      continue;
    }
    const fromClock = parseClockToSeconds(stamp);
    if (fromClock !== undefined) {
      return fromClock;
    }
  }
  // Newly dripped rows without a stamp belong at the current media time.
  // 時刻のないコメントは、現在の再生位置のコメントとして扱う。
  const media = getPageMediaTimeSec();
  return media === null ? undefined : Math.max(0, media);
}

/** Parse Twitch `t=1h2m3s` / `t=90s` style offsets / Twitch の t= 形式を秒へ */
export function parseTwitchTimeParam(
  href: string | null | undefined,
): number | undefined {
  if (!href) {
    return undefined;
  }
  try {
    const raw = href.includes("://")
      ? new URL(href).searchParams.get("t")
      : new URL(href, "https://www.twitch.tv").searchParams.get("t");
    if (!raw) {
      return undefined;
    }
    const hms = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
    if (hms && (hms[1] || hms[2] || hms[3])) {
      return (
        Number(hms[1] ?? 0) * 3600 +
        Number(hms[2] ?? 0) * 60 +
        Number(hms[3] ?? 0)
      );
    }
    const seconds = Number(raw.replace(/s$/i, ""));
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
  } catch {
    return undefined;
  }
}

function resolveTwitchSelfAuthorName(): string | null {
  return (
    document
      .querySelector(
        '[data-a-target="user-menu-dropdown__display-name"], [data-a-target="top-nav-container"] [data-a-target="user-display-name"]',
      )
      ?.textContent?.trim() || null
  );
}

function collectMatching(node: Element, selector: string): Element[] {
  const matches: Element[] = [];
  if (node.matches(selector)) {
    matches.push(node);
  }
  matches.push(...Array.from(node.querySelectorAll(selector)));
  return matches;
}

function trySendViaNativeInput(text: string): boolean {
  const input = document.querySelector(CHAT_INPUT_SELECTOR);
  if (!input) {
    return false;
  }
  const send = document.querySelector<HTMLElement>(CHAT_SEND_SELECTOR);
  if (
    !canClickNativeButton(send) ||
    !(input instanceof HTMLElement) ||
    !fillNativeInput(input, text)
  )
    return false;
  send.click();
  return true;
}

function readSafeTwitchAuthorColor(
  element: Element | null,
): string | undefined {
  if (!element) {
    return undefined;
  }
  const inline =
    element instanceof HTMLElement ? element.style?.color?.trim() : "";
  const raw = inline || extractInlineStyleColor(element.getAttribute("style"));
  if (!raw) {
    return undefined;
  }
  const rgb = parseRgbColor(raw);
  if (!rgb) {
    return undefined;
  }
  const [r, g, b] = rgb;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (luminance < 0.25) {
    // Lift very dark colors (e.g. rgb(0, 0, 255)) for legibility on dark #18181b panels.
    const mix = 0.35;
    return `rgb(${Math.round(r + (255 - r) * mix)}, ${Math.round(g + (255 - g) * mix)}, ${Math.round(b + (255 - b) * mix)})`;
  }
  return `rgb(${r}, ${g}, ${b})`;
}

function extractInlineStyleColor(styleAttr: string | null): string {
  if (!styleAttr) {
    return "";
  }
  const match = styleAttr.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
  return match?.[1]?.trim() ?? "";
}

function parseRgbColor(value: string): [number, number, number] | null {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1]!;
    if (digits.length === 3) {
      return [
        parseInt(digits[0]! + digits[0]!, 16),
        parseInt(digits[1]! + digits[1]!, 16),
        parseInt(digits[2]! + digits[2]!, 16),
      ];
    }
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
    ];
  }
  const rgb = value.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+\s*)?\)$/i,
  );
  if (!rgb) {
    return null;
  }
  const channels: [number, number, number] = [
    Number(rgb[1]),
    Number(rgb[2]),
    Number(rgb[3]),
  ];
  return channels.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)
    ? channels
    : null;
}

export function isTwitchChannelPage(): boolean {
  if (!isTwitchHost(location.hostname)) {
    return false;
  }
  if (window.top !== window) {
    return false;
  }
  if (isTwitchVodPage()) {
    return Boolean(
      document.querySelector("video") ||
      document.querySelector(".video-chat") ||
      document.querySelector(VOD_CHAT_CONTAINER_SELECTOR),
    );
  }
  return Boolean(extractTwitchChannel(location.href));
}
