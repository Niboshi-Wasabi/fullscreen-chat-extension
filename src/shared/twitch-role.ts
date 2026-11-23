import type { MessageRole } from "../core/message";
import { isSafeHttpsImageUrl } from "./safe-image-url";

export interface TwitchBadgeIcon {
  alt: string;
  src?: string;
}

/** Collect badge alt (+ optional image src) from a chat/VOD row.
 * チャット／VOD 行からバッジ alt（と画像 src）を集める。 */
export function readTwitchBadgeIcons(element: Element): TwitchBadgeIcon[] {
  return [
    ...element.querySelectorAll(
      'img.chat-badge, [data-a-target="chat-badge"], .chat-badge',
    ),
  ]
    .map((badge) => {
      const alt =
        badge.getAttribute("alt") ?? badge.getAttribute("aria-label") ?? "";
      if (!alt) {
        return null;
      }
      // Duck-type img — node unit tests have no HTMLImageElement.
      // Node.js の単体テストでも使えるよう、HTMLImageElement の型で判定せずにプロパティを確認する。
      const maybeImg = badge as {
        currentSrc?: string;
        src?: string;
        querySelector?: (sel: string) => Element | null;
      };
      const nested =
        typeof maybeImg.querySelector === "function"
          ? (maybeImg.querySelector("img") as {
              currentSrc?: string;
              src?: string;
            } | null)
          : null;
      const img =
        maybeImg.currentSrc !== undefined || maybeImg.src !== undefined
          ? maybeImg
          : nested;
      const rawSrc = (img?.currentSrc || img?.src || "").trim();
      const src = rawSrc && isSafeHttpsImageUrl(rawSrc) ? rawSrc : "";
      return src ? { alt, src } : { alt };
    })
    .filter((badge): badge is TwitchBadgeIcon => Boolean(badge));
}

export function readTwitchBadges(element: Element): string[] {
  return readTwitchBadgeIcons(element).map((badge) => badge.alt);
}

export function mapTwitchRole(badges: string[], element: Element): MessageRole {
  const cls =
    element.getAttribute?.("class") ??
    (typeof element.className === "string" ? element.className : "");
  const blob = `${badges.join(" ")} ${cls}`.toLowerCase();
  if (blob.includes("broadcaster") || blob.includes("配信者")) return "owner";
  if (blob.includes("moderator") || blob.includes("モデレーター"))
    return "moderator";
  if (blob.includes("subscriber") || blob.includes("購読")) return "member";
  if (blob.includes("bot")) return "bot";
  return "viewer";
}
