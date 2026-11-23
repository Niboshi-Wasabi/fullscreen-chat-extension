import type { NormalizedMessage } from "../core/message";
import { HIDDEN_LIVE_CHAT_FRAME_ID, NATIVE_CHAT_FRAME_ID } from "./dom-ids";
import { isSafeHttpsImageUrl } from "./safe-image-url";
import {
  isStaleYouTubeChatFrameUrl,
  resolveYouTubePageVideoId,
} from "./site-ids";
import { readYouTubeIframeUrl } from "./youtube-page";

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
  if (value.authorLogin !== undefined && !text(value.authorLogin, 1000))
    return false;
  if (
    value.authorColor !== undefined &&
    (!text(value.authorColor, 64) ||
      !/^(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*[\d.]+)?\s*\))$/i.test(
        value.authorColor,
      ))
  )
    return false;
  if (value.isSelf !== undefined && typeof value.isSelf !== "boolean")
    return false;
  if (
    value.videoOffsetSec !== undefined &&
    (typeof value.videoOffsetSec !== "number" ||
      !Number.isFinite(value.videoOffsetSec))
  )
    return false;
  if (
    value.badgeIcons !== undefined &&
    (!Array.isArray(value.badgeIcons) ||
      value.badgeIcons.length > 100 ||
      !value.badgeIcons.every((icon) => {
        if (!record(icon) || !text(icon.alt, 1000)) return false;
        return text(icon.src, 8192) && isSafeHttpsImageUrl(icon.src);
      }))
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
        return isSafeHttpsImageUrl(segment.src);
      }))
  )
    return false;
  return true;
}

/** Return a whitelisted copy without unvalidated extra fields (e.g. `raw`). */
export function sanitizeYouTubeChatMessage(
  value: NormalizedMessage,
): NormalizedMessage {
  return {
    id: value.id,
    site: "youtube-live",
    authorName: value.authorName,
    ...(value.authorLogin !== undefined
      ? { authorLogin: value.authorLogin }
      : {}),
    ...(value.authorId !== undefined ? { authorId: value.authorId } : {}),
    ...(value.authorColor !== undefined
      ? { authorColor: value.authorColor }
      : {}),
    role: value.role,
    badges: [...value.badges],
    ...(value.badgeIcons !== undefined
      ? {
          badgeIcons: value.badgeIcons.map((icon) => ({
            alt: icon.alt,
            src: icon.src,
          })),
        }
      : {}),
    text: value.text,
    ...(value.segments !== undefined
      ? {
          segments: value.segments.map((segment) =>
            segment.type === "text"
              ? { type: "text" as const, text: segment.text }
              : {
                  type: "emoji" as const,
                  src: segment.src,
                  alt: segment.alt,
                },
          ),
        }
      : {}),
    timestampMs: value.timestampMs,
    ...(value.videoOffsetSec !== undefined
      ? { videoOffsetSec: value.videoOffsetSec }
      : {}),
    isCommand: value.isCommand,
    ...(value.isSelf !== undefined ? { isSelf: value.isSelf } : {}),
  };
}

export function isChatFrameSource(event: MessageEvent): boolean {
  if (!event.isTrusted || !event.source || event.source === window)
    return false;
  const pageHref =
    document.location?.href ??
    (typeof location !== "undefined" ? location.href : undefined);
  const currentVideoId = pageHref
    ? resolveYouTubePageVideoId(pageHref, document)
    : null;
  const frames = document.querySelectorAll<HTMLIFrameElement>(
    `iframe#chatframe, ytd-live-chat-frame iframe, iframe#${NATIVE_CHAT_FRAME_ID}, iframe#${HIDDEN_LIVE_CHAT_FRAME_ID}`,
  );
  return [...frames].some((frame) => {
    if (frame.contentWindow !== event.source) return false;
    try {
      const frameHref = readYouTubeIframeUrl(frame);
      if (isStaleYouTubeChatFrameUrl(frameHref, currentVideoId)) {
        return false;
      }
      const url = new URL(frameHref);
      return (
        url.protocol === "https:" &&
        /(^|\.)youtube\.com$/i.test(url.hostname) &&
        /^\/live_chat(?:_replay)?\/?$/.test(url.pathname) &&
        event.origin === url.origin
      );
    } catch {
      return false;
    }
  });
}
