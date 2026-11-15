import type { MessageRole } from "../core/message";

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
      // node 単体テストに HTMLImageElement が無いのでダックタイプする。
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
      const src = (img?.currentSrc || img?.src || "").trim();
      return src ? { alt, src } : { alt };
    })
    .filter((badge): badge is TwitchBadgeIcon => Boolean(badge));
}

export function readTwitchBadges(element: Element): string[] {
  return readTwitchBadgeIcons(element).map((badge) => badge.alt);
}

export function mapTwitchRole(badges: string[], element: Element): MessageRole {
  const blob = `${badges.join(" ")} ${element.className}`.toLowerCase();
  if (blob.includes("broadcaster") || blob.includes("配信者")) return "owner";
  if (blob.includes("moderator") || blob.includes("モデレーター"))
    return "moderator";
  if (blob.includes("subscriber") || blob.includes("購読")) return "member";
  if (blob.includes("bot")) return "bot";
  return "viewer";
}
