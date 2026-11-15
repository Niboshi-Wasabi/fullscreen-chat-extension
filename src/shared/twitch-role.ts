import type { MessageRole } from "../core/message";

export function readTwitchBadges(element: Element): string[] {
  return [
    ...element.querySelectorAll(
      'img.chat-badge, [data-a-target="chat-badge"], .chat-badge',
    ),
  ]
    .map(
      (badge) =>
        badge.getAttribute("alt") ?? badge.getAttribute("aria-label") ?? "",
    )
    .filter(Boolean);
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
