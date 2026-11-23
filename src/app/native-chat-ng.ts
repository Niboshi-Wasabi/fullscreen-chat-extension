import { mapTwitchRole, readTwitchBadges } from "../shared/twitch-role";
/**
 * Hide NG-matching lines inside official chat iframes / embeds.
 * 公式チャットの iframe や埋め込み表示で、NG フィルタに該当する投稿を隠す。
 */

import { looksLikeCommand, type NormalizedMessage } from "../core/message";
import { shouldDropMessage } from "../core/filter";
import { extractMessageContent } from "../shared/message-content";
import { readYouTubeAuthorRole } from "../shared/youtube-page";
import {
  loadSettings,
  watchSettings,
  type ExtensionSettings,
} from "../shared/settings";

const HIDDEN_ATTR = "data-fce-ng-hidden";

export type NativeChatNgSite = "youtube-live" | "twitch";

/**
 * Observe native chat DOM and toggle visibility from shared NG settings.
 * 公式チャット DOM を監視し、共通 NG 設定で表示／非表示を切り替える。
 */
export function startNativeChatNgHider(site: NativeChatNgSite): () => void {
  let settings: ExtensionSettings["filter"] | null = null;
  let stopped = false;

  let enabled = true;
  const originalDisplay = new WeakMap<
    HTMLElement,
    { value: string; priority: string }
  >();
  const restore = (node: HTMLElement) => {
    const previous = originalDisplay.get(node);
    node.removeAttribute(HIDDEN_ATTR);
    if (previous?.value)
      node.style.setProperty("display", previous.value, previous.priority);
    else node.style.removeProperty("display");
    originalDisplay.delete(node);
  };

  const clearHidden = () => {
    document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((node) => {
      if (node instanceof HTMLElement) {
        restore(node);
      }
    });
  };

  const apply = () => {
    if (stopped || !settings) {
      return;
    }
    if (!enabled) {
      clearHidden();
      return;
    }
    const nodes = document.querySelectorAll(rowSelector(site));
    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      const parsed = parseNativeRow(site, node);
      if (!parsed) {
        return;
      }
      const hide = shouldDropMessage(parsed, settings!);
      if (hide) {
        if (!originalDisplay.has(node))
          originalDisplay.set(node, {
            value: node.style.getPropertyValue("display"),
            priority: node.style.getPropertyPriority("display"),
          });
        node.setAttribute(HIDDEN_ATTR, "1");
        node.style.setProperty("display", "none", "important");
      } else if (node.getAttribute(HIDDEN_ATTR) === "1") {
        restore(node);
      }
    });
  };

  const observer = new MutationObserver(() => apply());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  let settingsRevision = 0;
  const applySettings = (next: ExtensionSettings) => {
    settingsRevision += 1;
    settings = next.filter;
    enabled =
      next.enabled &&
      (site === "twitch" ? next.twitch.enabled : next.youtubeLive.enabled) &&
      next.filter.applyToNativeChat;
    apply();
  };

  const initialRevision = settingsRevision;
  void loadSettings()
    .then((next) => {
      if (stopped || settingsRevision !== initialRevision) return;
      applySettings(next);
    })
    .catch((error: unknown) => {
      console.warn("[fce] native-chat-ng loadSettings failed", error);
    });
  const unwatch = watchSettings(applySettings);

  return () => {
    stopped = true;
    unwatch();
    observer.disconnect();
    clearHidden();
  };
}

function rowSelector(site: NativeChatNgSite): string {
  if (site === "youtube-live") {
    return [
      "yt-live-chat-text-message-renderer",
      "yt-live-chat-paid-message-renderer",
      "yt-live-chat-membership-item-renderer",
    ].join(", ");
  }
  return [
    '[data-a-target="chat-line-message"]',
    ".vod-message",
    ".chat-line__message",
  ].join(", ");
}

function parseNativeRow(
  site: NativeChatNgSite,
  element: Element,
): NormalizedMessage | null {
  if (site === "youtube-live") {
    const authorName =
      element
        .querySelector("#author-name, #author-name span")
        ?.textContent?.trim() ?? "unknown";
    const messageEl = element.querySelector("#message");
    const { text: extractedText, segments } = extractMessageContent(
      messageEl instanceof Element ? messageEl : null,
    );
    const text = messageEl
      ? extractedText || messageEl.textContent?.trim() || ""
      : element
          .querySelector("#header-subtext, #header-primary-text")
          ?.textContent?.trim() ||
        element.textContent?.trim() ||
        "";
    const isPaidOrMembership =
      element.tagName.toLowerCase() !== "yt-live-chat-text-message-renderer";
    if (!text && segments.length === 0 && !isPaidOrMembership) {
      return null;
    }
    return {
      id: `ng-yt-${authorName}-${text.slice(0, 40)}`,
      site: "youtube-live",
      authorName,
      text: text || (segments.length > 0 ? "✦" : ""),
      timestampMs: Date.now(),
      role: readYouTubeAuthorRole(element),
      badges: [],
      isCommand: looksLikeCommand(text),
    };
  }

  const authorName =
    element
      .querySelector('[data-a-target="chat-message-username"]')
      ?.textContent?.trim() ||
    element.querySelector(".chat-author__display-name")?.textContent?.trim() ||
    "unknown";
  const rawLogin = element
    .querySelector(".chat-author__intl-login")
    ?.textContent?.trim();
  const authorLogin = rawLogin?.replace(/^\((.*)\)$/, "$1").trim() || undefined;
  const body =
    element.querySelector('[data-a-target="chat-line-message-body"]') ??
    element.querySelector(".vod-message__message") ??
    element.querySelector(".video-chat__message");
  // Match the adapter's full message, including emote names, rather than only
  // the first text fragment. / 先頭断片だけでなく絵文字名を含む全文で判定する。
  let text =
    (body
      ? extractMessageContent(body).text
      : [
          ...element.querySelectorAll(
            '[data-a-target="chat-message-text"], .text-fragment',
          ),
        ]
          .map((node) => extractMessageContent(node).text)
          .join("")
    ).trim() ||
    element.textContent?.trim() ||
    "";
  if (
    body?.classList.contains("video-chat__message") &&
    body.firstElementChild?.textContent?.trim() === ":"
  ) {
    text = text.replace(/^:\s*/, "");
  }
  if (!text) {
    return null;
  }
  return {
    id: `ng-tw-${authorName}-${text.slice(0, 40)}`,
    site: "twitch",
    authorName,
    authorLogin,
    text,
    timestampMs: Date.now(),
    role: mapTwitchRole(readTwitchBadges(element), element),
    badges: readTwitchBadges(element),
    isCommand: looksLikeCommand(text),
  };
}
