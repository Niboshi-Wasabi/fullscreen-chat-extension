import type { NormalizedMessage } from "./message";
import type { ExtensionSettings } from "../shared/settings";

const KNOWN_BOT_NAMES = new Set(
  ["streamelements", "nightbot", "moobot", "fossabot", "wizebot"].map((name) =>
    name.toLowerCase(),
  ),
);

const PROTECTED_ROLES = new Set(["moderator", "owner", "member"]);

export interface FilterResult {
  visible: NormalizedMessage[];
  droppedCount: number;
}

/**
 * Apply NG / role / density filters across all display modes.
 * 全表示モード共通の NG・ロール・間引きフィルタ。
 */
export function applyNgFilter(
  messages: NormalizedMessage[],
  settings: ExtensionSettings["filter"],
): FilterResult {
  let droppedCount = 0;
  const visible: NormalizedMessage[] = [];

  for (const message of messages) {
    if (shouldDrop(message, settings)) {
      droppedCount += 1;
      continue;
    }
    visible.push(message);
  }

  const capped =
    visible.length > settings.maxVisible
      ? visible.slice(visible.length - settings.maxVisible)
      : visible;

  return {
    visible: capped,
    droppedCount: droppedCount + (visible.length - capped.length),
  };
}

/** True when NG rules would hide this line / NG 規則で隠すべき行なら true */
export function shouldDropMessage(
  message: NormalizedMessage,
  settings: ExtensionSettings["filter"],
): boolean {
  return shouldDrop(message, settings);
}

function shouldDrop(
  message: NormalizedMessage,
  settings: ExtensionSettings["filter"],
): boolean {
  // Always keep the viewer's own lines / 自分の投稿は常に残す
  if (message.isSelf) {
    return false;
  }

  const protectedByRole =
    settings.protectRoles && PROTECTED_ROLES.has(message.role);

  if (settings.hideCommands && message.isCommand && !protectedByRole) {
    return true;
  }

  if (
    settings.hideBots &&
    (message.role === "bot" ||
      KNOWN_BOT_NAMES.has(message.authorName.toLowerCase())) &&
    !protectedByRole
  ) {
    return true;
  }

  const authorKey = (message.authorId ?? message.authorName).toLowerCase();
  if (
    settings.blockedUsers.some((entry) => entry.toLowerCase() === authorKey)
  ) {
    return true;
  }

  if (matchesNgWords(message.text, settings) && !protectedByRole) {
    return true;
  }

  return false;
}

function matchesNgWords(
  text: string,
  settings: ExtensionSettings["filter"],
): boolean {
  if (settings.ngWords.length === 0) {
    return false;
  }

  if (settings.ngRegex) {
    for (const pattern of settings.ngWords) {
      try {
        if (new RegExp(pattern, "i").test(text)) {
          return true;
        }
      } catch {
        // Invalid regex from user input — treat as literal / 不正な正規表現はリテラル扱い
        if (text.toLowerCase().includes(pattern.toLowerCase())) {
          return true;
        }
      }
    }
    return false;
  }

  const lower = text.toLowerCase();
  return settings.ngWords.some((word) => lower.includes(word.toLowerCase()));
}
