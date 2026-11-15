import type { NormalizedMessage } from "../core/message";
import { NATIVE_CHAT_FRAME_ID } from "./dom-ids";

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length <= max;
export function isYouTubeChatMessage(
  value: unknown,
): value is NormalizedMessage {
  if (
    !record(value) ||
    value.site !== "youtube-live" ||
    !text(value.id, 2048) ||
    !value.id ||
    !text(value.authorName, 1000) ||
    !text(value.text, 20000)
  )
    return false;
  if (
    typeof value.timestampMs !== "number" ||
    !Number.isFinite(value.timestampMs) ||
    typeof value.isCommand !== "boolean" ||
    !["viewer", "member", "moderator", "owner", "bot", "unknown"].includes(
      String(value.role),
    )
  )
    return false;
  if (
    !Array.isArray(value.badges) ||
    value.badges.length > 100 ||
    !value.badges.every((b) => text(b, 1000))
  )
    return false;
  if (value.authorId !== undefined && !text(value.authorId, 2048)) return false;
  if (value.isSelf !== undefined && typeof value.isSelf !== "boolean")
    return false;
  if (
    value.videoOffsetSec !== undefined &&
    (typeof value.videoOffsetSec !== "number" ||
      !Number.isFinite(value.videoOffsetSec) ||
      value.videoOffsetSec < 0)
  )
    return false;
  if (
    value.segments !== undefined &&
    (!Array.isArray(value.segments) ||
      value.segments.length > 500 ||
      !value.segments.every((segment) => {
        if (!record(segment)) return false;
        if (segment.type === "text") return text(segment.text, 20000);
        if (
          segment.type !== "emoji" ||
          !text(segment.alt, 1000) ||
          !text(segment.src, 8192)
        )
          return false;
        try {
          const url = new URL(segment.src);
          return url.protocol === "https:" && !url.username && !url.password;
        } catch {
          return false;
        }
      }))
  )
    return false;
  return true;
}

export function isChatFrameSource(event: MessageEvent): boolean {
  if (!event.isTrusted || !event.source || event.source === window)
    return false;
  const frames = document.querySelectorAll<HTMLIFrameElement>(
    `iframe#chatframe, ytd-live-chat-frame iframe, iframe#${NATIVE_CHAT_FRAME_ID}, iframe#fce-hidden-live-chat-frame`,
  );
  return [...frames].some((frame) => {
    if (frame.contentWindow !== event.source) return false;
    try {
      const url = new URL(frame.src);
      return (
        url.protocol === "https:" &&
        /(^|\.)youtube\.com$/i.test(url.hostname) &&
        /^\/live_chat(?:_replay)?$/.test(url.pathname) &&
        event.origin === url.origin
      );
    } catch {
      return false;
    }
  });
}
