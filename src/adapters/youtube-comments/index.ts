import {
  fillNativeInput,
  canClickNativeButton,
} from "../../shared/native-compose";
import { looksLikeCommand, type NormalizedMessage } from "../../core/message";
import { loadSettings } from "../../shared/settings";
import { isYouTubeWatchWithComments as pageIsComments } from "../../shared/youtube-page";
import type { SiteAdapter } from "../types";

const COMMENT_SELECTORS = [
  "ytd-comment-thread-renderer",
  "ytd-comment-view-model",
  "ytd-comment-renderer",
].join(", ");
const LOAD_MORE_SELECTORS = [
  "#more-replies button",
  "ytd-button-renderer#more-replies button",
  "ytd-continuation-item-renderer button",
  "#continuations button",
  "tp-yt-paper-button#more-replies",
  "button[aria-label*='more replies' i]",
  "button[aria-label*='返信' i]",
  "button[aria-label*='Show more' i]",
  "button[aria-label*='もっと見る' i]",
].join(", ");

/**
 * YouTube watch-page threaded comments (panel only; no danmaku).
 * YouTube 通常動画のスレッドコメント（パネルのみ。弾幕なし）。
 */
export function createYouTubeCommentsAdapter(): SiteAdapter {
  let seen = new WeakSet<Element>();
  let stopped = false;
  let onMessage: ((message: NormalizedMessage) => void) | null = null;
  let observer: MutationObserver | null = null;
  let ensureTimer: number | null = null;
  let didNudgeComments = false;
  let lastAppliedSort: "top" | "newest" | null = null;
  let sortAttempts = 0;
  const elementById = new Map<string, Element>();

  return {
    site: "youtube-comments",
    start(callback) {
      stopped = false;
      seen = new WeakSet<Element>();
      onMessage = callback;
      sortAttempts = 0;
      elementById.clear();
      nudgeCommentsIntoView();
      void applyPreferredSort();
      scrapeComments();
      maybeLoadMore();
      observer = new MutationObserver(() => {
        if (!stopped) {
          scrapeComments();
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      ensureTimer = window.setInterval(() => {
        if (!stopped) {
          nudgeCommentsIntoView();
          void applyPreferredSort();
          scrapeComments();
          maybeLoadMore();
        }
      }, 2500);
    },
    stop() {
      stopped = true;
      onMessage = null;
      observer?.disconnect();
      observer = null;
      lastAppliedSort = null;
      sortAttempts = 0;
      elementById.clear();
      if (ensureTimer !== null) {
        window.clearInterval(ensureTimer);
        ensureTimer = null;
      }
    },
    async sendMessage(text) {
      return stopped ? false : trySendComment(text, () => !stopped);
    },
    async replyTo(messageId, text) {
      const element = elementById.get(messageId);
      if (stopped || !element?.isConnected) {
        return false;
      }
      const replyInput = await openNativeReply(element);
      if (stopped || !replyInput) {
        return false;
      }
      return fillActiveCommentBox(text, replyInput, () => !stopped);
    },
  };

  function nudgeCommentsIntoView(): void {
    if (didNudgeComments) {
      return;
    }
    const section = document.querySelector<HTMLElement>(
      "#comments, ytd-comments, ytd-item-section-renderer#sections",
    );
    if (!section) {
      return;
    }
    didNudgeComments = true;
    // Lazy comments often need a scroll before threads hydrate.
    // 遅延コメントはスクロールで水和されることが多い。
    section.scrollIntoView({ block: "nearest", behavior: "auto" });
  }

  function scrapeComments(): void {
    if (stopped || !onMessage) {
      return;
    }
    const nodes = document.querySelectorAll(COMMENT_SELECTORS);
    nodes.forEach((node) => {
      if (seen.has(node)) {
        return;
      }
      const parsed = parseCommentElement(node);
      if (!parsed) {
        return;
      }
      seen.add(node);
      elementById.set(parsed.id, node);
      if (elementById.size > 800) {
        const first = elementById.keys().next().value;
        if (first) {
          elementById.delete(first);
        }
      }
      onMessage?.(parsed);
    });
  }

  async function applyPreferredSort(): Promise<void> {
    const settings = await loadSettings();
    const wanted = settings.youtubeComments.sort;
    if (lastAppliedSort === wanted) {
      return;
    }
    // Avoid hammering the sort menu when the control is missing.
    // 並び替え UI が無いときにメニューを叩き続けない。
    if (sortAttempts >= 4) {
      return;
    }
    sortAttempts += 1;
    const applied = await clickNativeSort(wanted);
    if (applied) {
      lastAppliedSort = wanted;
      sortAttempts = 0;
      // Re-scrape after sort swaps the thread list.
      // 並び替えで一覧が差し替わるので再走査する。
      seen = new WeakSet<Element>();
      scrapeComments();
    }
  }

  async function maybeLoadMore(): Promise<void> {
    const settings = await loadSettings();
    if (!settings.youtubeComments.autoLoadMore) {
      return;
    }
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>(LOAD_MORE_SELECTORS),
    ).filter((button) => {
      if (button.getAttribute("aria-disabled") === "true") {
        return false;
      }
      if ((button as HTMLButtonElement).disabled) {
        return false;
      }
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    // Cap clicks per tick to avoid runaway loops / 1 ティックあたりのクリック上限
    for (const button of buttons.slice(0, 3)) {
      button.click();
    }
  }
}

async function clickNativeSort(sort: "top" | "newest"): Promise<boolean> {
  const sortButton = document.querySelector<HTMLElement>(
    [
      "yt-sort-filter-sub-menu-renderer yt-dropdown-menu",
      "#sort-menu yt-dropdown-menu",
      "ytd-comments #sort-menu button",
      "tp-yt-paper-button[aria-label*='Sort' i]",
      "tp-yt-paper-button[aria-label*='並び替え' i]",
    ].join(", "),
  );
  if (!sortButton) {
    return false;
  }
  sortButton.click();
  await new Promise((resolve) => window.setTimeout(resolve, 120));

  const items = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        "tp-yt-paper-listbox tp-yt-paper-item",
        "tp-yt-paper-listbox a",
        "#menu a.yt-simple-endpoint",
        "ytd-menu-popup-renderer tp-yt-paper-item",
      ].join(", "),
    ),
  );
  const needle =
    sort === "newest"
      ? [/newest/i, /新しい/, /新着/, /recent/i]
      : [/top/i, /人気/, /評価/, /relevant/i];
  const match = items.find((item) => {
    const label = (item.textContent ?? "").trim();
    return needle.some((pattern) => pattern.test(label));
  });
  if (!match) {
    // Close menu with Escape if we opened it / 開けたメニューは Escape で閉じる
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    return false;
  }
  match.click();
  await new Promise((resolve) => window.setTimeout(resolve, 200));
  return true;
}

function parseCommentElement(element: Element): NormalizedMessage | null {
  const authorName =
    element
      .querySelector(
        "#author-text, a#author-text, #author-text span, #author-name, span[id='author-text']",
      )
      ?.textContent?.trim() ||
    element
      .querySelector("a[href*='/@'], a[href*='/channel/']")
      ?.textContent?.trim() ||
    "unknown";

  const textCandidates = [
    element.querySelector("#content-text"),
    element.querySelector("yt-formatted-string#content-text"),
    element.querySelector("#content yt-attributed-string"),
    element.querySelector("yt-attributed-string"),
    element.querySelector("#content"),
  ];
  let text = "";
  for (const candidate of textCandidates) {
    const value = candidate?.textContent?.trim() ?? "";
    if (value) {
      text = value;
      break;
    }
  }
  if (!text) {
    return null;
  }

  const replyButton = findReplyButton(element);
  const stableKey =
    element.getAttribute("id") ||
    `${authorName}|${text.slice(0, 160)}|${text.length}`;
  return {
    id: `yt-comment-${hashString(stableKey)}`,
    site: "youtube-comments",
    authorName,
    text,
    timestampMs: Date.now(),
    role: "viewer",
    badges: replyButton ? ["replyable"] : [],
    canReply: Boolean(replyButton),
    isCommand: looksLikeCommand(text),
  };
}

function findReplyButton(element: Element): HTMLElement | null {
  return (
    element.querySelector<HTMLElement>(
      [
        "#reply-button-end button",
        "#reply-button button",
        "button[aria-label*='Reply' i]",
        "button[aria-label*='返信' i]",
      ].join(", "),
    ) ?? null
  );
}

async function openNativeReply(
  element: Element,
): Promise<HTMLElement | HTMLTextAreaElement | null> {
  const replyButton = findReplyButton(element);
  if (!replyButton) {
    return null;
  }
  replyButton.click();
  await new Promise((resolve) => window.setTimeout(resolve, 160));
  return findActiveCommentInput(
    element.closest("ytd-comment-thread-renderer") ?? element,
  );
}

async function trySendComment(
  text: string,
  isActive: () => boolean,
): Promise<boolean> {
  const placeholder = document.querySelector<HTMLElement>(
    "#simplebox-placeholder, ytd-comment-simplebox-renderer #placeholder-area, #placeholder-area",
  );
  placeholder?.click();
  await new Promise((resolve) => window.setTimeout(resolve, 80));
  return fillActiveCommentBox(text, findActiveCommentInput(), isActive);
}

async function fillActiveCommentBox(
  text: string,
  input: HTMLElement | HTMLTextAreaElement | null,
  isActive: () => boolean,
): Promise<boolean> {
  if (!input?.isConnected || !isActive()) {
    return false;
  }
  if (!fillNativeInput(input, text)) return false;

  await new Promise((resolve) => window.setTimeout(resolve, 80));
  const scope = input.closest(
    "ytd-commentbox, ytd-comment-simplebox-renderer, #comment-dialog, ytd-comment-reply-dialog-renderer",
  );
  if (!scope || !input.isConnected || !isActive()) return false;
  const submit = scope.querySelector<HTMLElement>(
    "#submit-button button:not([disabled]), ytd-button-renderer#submit-button button",
  );
  if (!canClickNativeButton(submit)) return false;
  submit.click();
  return true;
}

function findActiveCommentInput(
  scope: ParentNode = document,
): HTMLElement | HTMLTextAreaElement | null {
  return (
    scope.querySelector<HTMLElement>(
      "#contenteditable-root[contenteditable='true'], div#contenteditable-root[contenteditable='true']",
    ) ??
    scope.querySelector<HTMLTextAreaElement>(
      "ytd-comment-simplebox-renderer textarea, #comment-dialog textarea, ytd-commentbox textarea",
    )
  );
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return `${Math.abs(hash)}`;
}

export function isYouTubeWatchWithComments(): boolean {
  return pageIsComments();
}
