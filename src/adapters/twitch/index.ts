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
  extractTwitchChannelFromPage,
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
const CHAT_COLLAPSE_TOGGLE_SELECTOR =
  '[data-a-target="right-column__toggle-collapse-btn"]';
const CHAT_INPUT_SELECTOR =
  'textarea[data-a-target="chat-input"], [data-a-target="chat-input"]';
const CHAT_SEND_SELECTOR = 'button[data-a-target="chat-send-button"]';

/** Brief reopen keeps Twitch chat DOM updating while appearing collapsed.
 * 短く開閉して、見た目は閉じたまま受信 DOM を復活させる。 */
const CHAT_REOPEN_CLOSE_DELAY_MS = 80;

/**
 * Twitch live / VOD chat adapter.
 * Twitch ライブ／VOD チャットアダプタ。
 */
export function createTwitchAdapter(): SiteAdapter {
  let seen = new WeakMap<Element, string>();
  let stopped = false;
  let onMessage: ((message: NormalizedMessage) => void) | null = null;
  let chatObserver: MutationObserver | null = null;
  let bodyObserver: MutationObserver | null = null;
  let observedContainer: Element | null = null;
  let ensureTimer: number | null = null;
  let isReinitializingChat = false;
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
    },
    async sendMessage(text) {
      return stopped ? false : trySendViaNativeInput(text);
    },
  };

  async function refreshEmoteMap(next?: ExtensionSettings): Promise<void> {
    const generation = ++emoteGeneration;
    emoteAbort?.abort();
    emoteMap = new Map();
    const settings = next ?? (await loadSettings());
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
        const row = target?.closest(
          `${CHAT_MESSAGE_SELECTOR}, ${VOD_MESSAGE_ROW_SELECTOR}`,
        );
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
    // Some renderers put both selectors on different levels of one message.
    element =
      element.closest(
        '[data-a-target="chat-line-message"], .vod-message, .video-chat__message',
      ) ?? element;
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
    chatObserver?.disconnect();
    chatObserver = null;
    void refreshEmoteMap();
    ensureChatObserved();
    if (isNativeChatCollapsed()) {
      reinitializeCollapsedChat();
    }
  }

  function maybeRecoverCollapsedChat(): void {
    if (isTwitchVodPage() || !isNativeChatCollapsed()) {
      return;
    }
    // If container is missing while collapsed, Twitch stopped updating chat.
    // コラプス中にコンテナが消えている＝受信停止なので再初期化。
    if (!document.querySelector(CHAT_CONTAINER_SELECTOR)) {
      reinitializeCollapsedChat();
    }
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
    toggle.click();
    window.setTimeout(() => {
      if (stopped) {
        isReinitializingChat = false;
        return;
      }
      const closeToggle = document.querySelector(CHAT_COLLAPSE_TOGGLE_SELECTOR);
      if (closeToggle instanceof HTMLElement && isExpandedToggle(closeToggle)) {
        closeToggle.click();
      }
      isReinitializingChat = false;
      ensureChatObserved();
    }, CHAT_REOPEN_CLOSE_DELAY_MS);
  }
}

function isNativeChatCollapsed(): boolean {
  const toggle = document.querySelector(CHAT_COLLAPSE_TOGGLE_SELECTOR);
  if (!(toggle instanceof HTMLElement)) {
    return false;
  }
  const label = (toggle.getAttribute("aria-label") ?? "").toLowerCase();
  // Expand / 展開 means currently collapsed / 「展開」＝いま閉じている
  return (
    label.includes("expand") ||
    label.includes("展開") ||
    label.includes("show") ||
    label.includes("表示")
  );
}

function isExpandedToggle(toggle: HTMLElement): boolean {
  const label = (toggle.getAttribute("aria-label") ?? "").toLowerCase();
  return (
    label.includes("collapse") ||
    label.includes("折りたた") ||
    label.includes("hide") ||
    label.includes("非表示")
  );
}

const elementIds = new WeakMap<Element, string>();

export function parseTwitchMessage(
  element: Element,
  emoteMap: EmoteCodeMap | null,
): NormalizedMessage | null {
  const authorName =
    element.querySelector(CHAT_AUTHOR_SELECTOR)?.textContent?.trim() ??
    element
      .querySelector(".vod-message__header .chat-author__display-name")
      ?.textContent?.trim() ??
    element.querySelector(".chat-author__display-name")?.textContent?.trim() ??
    element
      .querySelector(
        '.vod-message__header [data-a-target="chat-message-username"]',
      )
      ?.textContent?.trim() ??
    "unknown";

  const bodyEl =
    element.querySelector(CHAT_BODY_SELECTOR) ??
    element.querySelector(".vod-message__message") ??
    element.querySelector(".video-chat__message");
  const fromBody = extractMessageContent(bodyEl);
  let text = fromBody.text;
  let segments = fromBody.segments;

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
    '[data-a-target="chat-timestamp"], .vod-message__timestamp, .chat-line__timestamp, a[href*="t="]',
  );
  // Prefer any href (anchor or mock) over instanceof — works across realms/tests.
  // アンカー判定は href 優先（realm／テストでも動く）。
  const fromHref = parseTwitchTimeParam(
    stampNode?.getAttribute("href") ??
      element.querySelector("a[href*='t=']")?.getAttribute("href"),
  );
  if (fromHref !== undefined) {
    return fromHref;
  }
  const stamp =
    stampNode?.textContent?.trim() ||
    element.getAttribute?.("data-a-target-timestamp") ||
    "";
  const fromClock = parseClockToSeconds(stamp);
  if (fromClock !== undefined) {
    return fromClock;
  }
  // Newly dripped rows without a stamp belong at the current media time.
  // 時刻無しで流れ込む行は、いまの再生位置向けとして扱う。
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
    return Number.isFinite(seconds) ? seconds : undefined;
  } catch {
    return undefined;
  }
}

export function parseClockToSeconds(value: string): number | undefined {
  const match = value.trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return undefined;
  }
  if (match[3] !== undefined) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    return hours * 3600 + minutes * 60 + seconds;
  }
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  return minutes * 60 + seconds;
}

function resolveTwitchSelfAuthorName(): string | null {
  return (
    document
      .querySelector(
        '[data-a-target="user-display-name"], h5[data-a-target="user-display-name"], [data-a-target="user-card-username"]',
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

export function isTwitchChannelPage(): boolean {
  if (!/(^|\.)twitch\.tv$/i.test(location.hostname)) {
    return false;
  }
  if (window.top !== window) {
    return false;
  }
  const path = location.pathname;
  if (
    path.startsWith("/directory") ||
    path.startsWith("/settings") ||
    path.startsWith("/inventory") ||
    path.startsWith("/subscriptions") ||
    path === "/"
  ) {
    return false;
  }
  if (isTwitchVodPage()) {
    return Boolean(
      document.querySelector("video") ||
      document.querySelector(".video-chat") ||
      document.querySelector(VOD_CHAT_CONTAINER_SELECTOR),
    );
  }
  return Boolean(document.querySelector("video") || path.length > 1);
}
