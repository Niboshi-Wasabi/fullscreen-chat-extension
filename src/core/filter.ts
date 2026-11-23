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
type CompiledNgMatcher = (text: string, lowerText: string) => boolean;

function compileNgMatcher(
  settings: ExtensionSettings["filter"],
): CompiledNgMatcher | null {
  const words = settings.ngWords.filter((word) => word.length > 0);
  if (words.length === 0) {
    return null;
  }
  if (!settings.ngRegex) {
    const lowerWords = words.map((word) => word.toLowerCase());
    return (_text, lowerText) =>
      lowerWords.some((word) => lowerText.includes(word));
  }
  const matchers = words.map((pattern) => {
    try {
      const regex = new RegExp(pattern, "i");
      return (text: string) => regex.test(text);
    } catch {
      const lower = pattern.toLowerCase();
      return (_text: string, lowerText: string) => lowerText.includes(lower);
    }
  });
  return (text, lowerText) => matchers.some((match) => match(text, lowerText));
}

export function applyNgFilter(
  messages: NormalizedMessage[],
  settings: ExtensionSettings["filter"],
): FilterResult {
  let droppedCount = 0;
  const visible: NormalizedMessage[] = [];
  const ngMatcher = compileNgMatcher(settings);

  for (const message of messages) {
    if (shouldDrop(message, settings, ngMatcher)) {
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

/** True when NG rules would hide this line / NG フィルタで非表示にする投稿なら true */
export function shouldDropMessage(
  message: NormalizedMessage,
  settings: ExtensionSettings["filter"],
): boolean {
  return shouldDrop(message, settings, compileNgMatcher(settings));
}

function shouldDrop(
  message: NormalizedMessage,
  settings: ExtensionSettings["filter"],
  ngMatcher: CompiledNgMatcher | null,
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

  const authorKeys = [message.authorId, message.authorName, message.authorLogin]
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => entry.toLowerCase());
  if (
    settings.blockedUsers.some((entry) => {
      const target = entry.trim().toLowerCase();
      return target.length > 0 && authorKeys.includes(target);
    })
  ) {
    return true;
  }

  if (
    ngMatcher &&
    ngMatcher(message.text, message.text.toLowerCase()) &&
    !protectedByRole
  ) {
    return true;
  }

  return false;
}
