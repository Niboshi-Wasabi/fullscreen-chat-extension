/**
 * Detect the site's own chat column so the video overlay does not duplicate it.
 * ページ側のチャット欄が見えているかを判定し、動画上の公式チャットと二重にしない。
 */

export const TWITCH_COLLAPSE_TOGGLE =
  '[data-a-target="right-column__toggle-collapse-btn"]';
const TWITCH_CHAT_COLUMN =
  ".channel-root__right-column, [data-a-target='right-column']";

// Suppresses false "column open" readings during Twitch adapter's brief reopen.
// Twitch アダプタの一時開閉中に「ページ側チャット欄が開いた」と誤判定しないためのフラグ。
let twitchChatReinitializing = false;

export function setTwitchChatReinitializing(active: boolean): void {
  twitchChatReinitializing = active;
}

/**
 * Label on a control that opens a currently closed chat column.
 * "非表示" contains "表示", so closing words are ruled out first.
 * 「非表示」は「表示」を含むので、閉じる側の語を先に除く。
 */
export function isChatColumnExpandLabel(label: string): boolean {
  if (isChatColumnCollapseLabel(label)) {
    return false;
  }
  const value = label.toLowerCase();
  return (
    value.includes("expand") ||
    value.includes("展開") ||
    value.includes("show") ||
    value.includes("表示")
  );
}

/** Label on a control that closes a currently open chat column. */
export function isChatColumnCollapseLabel(label: string): boolean {
  const value = label.toLowerCase();
  return (
    value.includes("collapse") ||
    value.includes("折りたた") ||
    value.includes("hide") ||
    value.includes("非表示")
  );
}

/**
 * True when the page's own chat column is on screen.
 * Unknown markup returns false so a missing column does not hide the overlay.
 * ページ側のチャット欄が見えていれば true。見つからないときは false。
 */
export function isPageChatColumnOpen(doc: Document = document): boolean {
  const hostname = doc.location?.hostname ?? "";
  if (/(^|\.)youtube\.com$/i.test(hostname)) {
    return isYouTubeChatColumnOpen(doc);
  }
  if (/(^|\.)twitch\.tv$/i.test(hostname)) {
    return isTwitchChatColumnOpen(doc);
  }
  return false;
}

/**
 * Official-chat overlay belongs on the video only when that column is closed
 * or the player is fullscreen. The extension's own list stays available.
 * 公式チャットを動画に重ねるのは、ページのチャット欄を閉じているとき、または全画面のときに限る。拡張機能のリストは表示したままにする。
 */
export function shouldMountVideoPanel(input: {
  useNativeChat: boolean;
  fullscreen: boolean;
  pageChatOpen: boolean;
}): boolean {
  if (!input.useNativeChat) {
    return true;
  }
  if (input.fullscreen) {
    return true;
  }
  return !input.pageChatOpen;
}

function isYouTubeChatColumnOpen(doc: Document): boolean {
  const frame = doc.querySelector("ytd-live-chat-frame, #chat");
  if (!frame || !isShown(frame)) {
    return false;
  }
  if (frame.hasAttribute("collapsed") || frame.hasAttribute("hidden")) {
    return false;
  }
  return hasVisibleBox(frame);
}

function isTwitchChatColumnOpen(doc: Document): boolean {
  if (twitchChatReinitializing) {
    return false;
  }
  const toggle = doc.querySelector(TWITCH_COLLAPSE_TOGGLE);
  if (toggle) {
    const label = toggle.getAttribute("aria-label") ?? "";
    if (isChatColumnExpandLabel(label)) {
      return false;
    }
    if (isChatColumnCollapseLabel(label)) {
      return true;
    }
  }
  const column = doc.querySelector(TWITCH_CHAT_COLUMN);
  if (!column || !isShown(column)) {
    return false;
  }
  if (
    column.classList.contains("right-column--collapsed") ||
    column.classList.contains("channel-root__right-column--collapsed")
  ) {
    return false;
  }
  return hasVisibleBox(column);
}

function isShown(element: Element): boolean {
  if (element.hasAttribute("hidden")) {
    return false;
  }
  const style = element.getAttribute("style") ?? "";
  return !/display\s*:\s*none/i.test(style);
}

function hasVisibleBox(element: Element): boolean {
  if (typeof element.getBoundingClientRect !== "function") {
    return true;
  }
  const box = element.getBoundingClientRect();
  return box.width >= 8 && box.height >= 8;
}
