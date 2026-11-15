/**
 * BTTV / FFZ / 7TV emote maps for Twitch chat text tokens.
 * Twitch チャット語句向け BTTV / FFZ / 7TV エモート表。
 */

import type { MessageSegment } from "../core/message";

export type EmoteCodeMap = Map<string, { src: string; alt: string }>;

interface CachedMaps {
  channelKey: string;
  loadedAtMs: number;
  map: EmoteCodeMap;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
let cache: CachedMaps | null = null;

/** Best-effort Twitch numeric user id from the watch page / 視聴ページから Twitch 数値 ID */
export function extractTwitchUserIdFromPage(): string | null {
  const fromLink =
    document
      .querySelector<HTMLElement>("[data-channel-id], [data-a-channel-id]")
      ?.getAttribute("data-channel-id") ??
    document
      .querySelector<HTMLElement>("[data-a-channel-id]")
      ?.getAttribute("data-a-channel-id");
  if (fromLink && /^\d+$/.test(fromLink)) {
    return fromLink;
  }
  const scripts = Array.from(document.querySelectorAll("script"));
  for (const script of scripts) {
    const text = script.textContent ?? "";
    const match =
      text.match(/"channelID"\s*:\s*"?(\d+)"?/) ??
      text.match(/"channel_id"\s*:\s*"?(\d+)"?/) ??
      text.match(/"id"\s*:\s*(\d{5,}).{0,40}"login"/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export async function loadTwitchEmoteMap(options: {
  channelLogin: string | null;
  channelId: string | null;
  signal?: AbortSignal;
}): Promise<EmoteCodeMap> {
  const channelKey = `${options.channelLogin ?? ""}:${options.channelId ?? ""}`;
  if (
    cache &&
    cache.channelKey === channelKey &&
    Date.now() - cache.loadedAtMs < CACHE_TTL_MS
  ) {
    return cache.map;
  }
  const map: EmoteCodeMap = new Map();
  await Promise.all([
    mergeBttv(map, options.channelId, options.signal),
    mergeFfz(map, options.channelLogin, options.signal),
    mergeSevenTv(map, options.channelId, options.signal),
  ]);
  if (!options.signal?.aborted)
    cache = { channelKey, loadedAtMs: Date.now(), map };
  return map;
}

/**
 * Expand plain-text emote codes into image segments (keeps existing images).
 * 平文エモートコードを画像断片へ展開（既存画像は維持）。
 */
export function applyEmoteMapToSegments(
  segments: MessageSegment[] | undefined,
  text: string,
  map: EmoteCodeMap,
): { text: string; segments: MessageSegment[] } {
  if (map.size === 0) {
    return {
      text,
      segments:
        segments && segments.length > 0 ? segments : [{ type: "text", text }],
    };
  }
  if (segments && segments.some((segment) => segment.type === "emoji")) {
    // Already has images from DOM — only expand remaining pure-text runs.
    // DOM 由来の画像がある場合は、残りのテキスト断片だけ展開する。
    const expanded: MessageSegment[] = [];
    for (const segment of segments) {
      if (segment.type === "emoji") {
        expanded.push(segment);
        continue;
      }
      expanded.push(...tokenizeTextWithEmotes(segment.text, map));
    }
    return {
      text: flatten(expanded),
      segments: expanded,
    };
  }
  const expanded = tokenizeTextWithEmotes(text, map);
  return { text: flatten(expanded), segments: expanded };
}

function tokenizeTextWithEmotes(
  value: string,
  map: EmoteCodeMap,
): MessageSegment[] {
  if (!value) {
    return [];
  }
  const parts = value.split(/(\s+)/);
  const out: MessageSegment[] = [];
  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (/^\s+$/.test(part)) {
      out.push({ type: "text", text: part });
      continue;
    }
    const emote = map.get(part);
    if (emote) {
      out.push({ type: "emoji", src: emote.src, alt: emote.alt });
      continue;
    }
    out.push({ type: "text", text: part });
  }
  return out;
}

function flatten(segments: MessageSegment[]): string {
  return segments
    .map((segment) =>
      segment.type === "text"
        ? segment.text
        : segment.alt
          ? `:${segment.alt}:`
          : "✦",
    )
    .join("")
    .trim();
}

async function mergeBttv(
  map: EmoteCodeMap,
  channelId: string | null,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const globalRes = await fetch(
      "https://api.betterttv.net/3/cached/emotes/global",
      { signal },
    );
    if (globalRes.ok) {
      const list = (await globalRes.json()) as Array<{
        id: string;
        code: string;
      }>;
      for (const entry of list) {
        map.set(entry.code, {
          alt: entry.code,
          src: `https://cdn.betterttv.net/emote/${entry.id}/1x.webp`,
        });
      }
    }
    if (channelId) {
      const userRes = await fetch(
        `https://api.betterttv.net/3/cached/users/twitch/${encodeURIComponent(channelId)}`,
        { signal },
      );
      if (userRes.ok) {
        const user = (await userRes.json()) as {
          channelEmotes?: Array<{ id: string; code: string }>;
          sharedEmotes?: Array<{ id: string; code: string }>;
        };
        for (const entry of [
          ...(user.channelEmotes ?? []),
          ...(user.sharedEmotes ?? []),
        ]) {
          map.set(entry.code, {
            alt: entry.code,
            src: `https://cdn.betterttv.net/emote/${entry.id}/1x.webp`,
          });
        }
      }
    }
  } catch {
    // Optional dependency — ignore network failures / 任意依存。通信失敗は無視
  }
}

async function mergeFfz(
  map: EmoteCodeMap,
  channelLogin: string | null,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const globalRes = await fetch(
      "https://api.frankerfacez.com/v1/set/global",
      { signal },
    );
    if (globalRes.ok) {
      const payload = (await globalRes.json()) as {
        sets?: Record<string, { emoticons?: FfzEmote[] }>;
      };
      for (const set of Object.values(payload.sets ?? {})) {
        for (const emote of set.emoticons ?? []) {
          const src = pickFfzSrc(emote);
          if (src) {
            map.set(emote.name, { alt: emote.name, src });
          }
        }
      }
    }
    if (channelLogin) {
      const roomRes = await fetch(
        `https://api.frankerfacez.com/v1/room/${encodeURIComponent(channelLogin)}`,
        { signal },
      );
      if (roomRes.ok) {
        const room = (await roomRes.json()) as {
          sets?: Record<string, { emoticons?: FfzEmote[] }>;
        };
        for (const set of Object.values(room.sets ?? {})) {
          for (const emote of set.emoticons ?? []) {
            const src = pickFfzSrc(emote);
            if (src) {
              map.set(emote.name, { alt: emote.name, src });
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }
}

interface FfzEmote {
  name: string;
  urls?: Record<string, string>;
}

function pickFfzSrc(emote: FfzEmote): string | null {
  const urls = emote.urls ?? {};
  const candidate =
    urls["2"] ?? urls["1"] ?? urls["4"] ?? Object.values(urls)[0];
  if (!candidate) {
    return null;
  }
  return candidate.startsWith("//") ? `https:${candidate}` : candidate;
}

async function mergeSevenTv(
  map: EmoteCodeMap,
  channelId: string | null,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const globalRes = await fetch("https://7tv.io/v3/emote-sets/global", {
      signal,
    });
    if (globalRes.ok) {
      const payload = (await globalRes.json()) as {
        emotes?: SevenTvEmote[];
      };
      for (const emote of payload.emotes ?? []) {
        const src = pickSevenTvSrc(emote);
        if (src) {
          map.set(emote.name, { alt: emote.name, src });
        }
      }
    }
    if (channelId) {
      const userRes = await fetch(
        `https://7tv.io/v3/users/twitch/${encodeURIComponent(channelId)}`,
        { signal },
      );
      if (userRes.ok) {
        const user = (await userRes.json()) as {
          emote_set?: { emotes?: SevenTvEmote[] };
        };
        for (const emote of user.emote_set?.emotes ?? []) {
          const src = pickSevenTvSrc(emote);
          if (src) {
            map.set(emote.name, { alt: emote.name, src });
          }
        }
      }
    }
  } catch {
    // ignore
  }
}

interface SevenTvEmote {
  name: string;
  data?: {
    host?: {
      url?: string;
      files?: Array<{ name: string; format?: string }>;
    };
  };
}

function pickSevenTvSrc(emote: SevenTvEmote): string | null {
  const host = emote.data?.host;
  if (!host?.url || !host.files?.length) {
    return null;
  }
  const file =
    host.files.find((entry) => entry.name === "1x.webp") ??
    host.files.find((entry) => entry.name.includes("1x")) ??
    host.files[0];
  if (!file) {
    return null;
  }
  const base = host.url.startsWith("//") ? `https:${host.url}` : host.url;
  return `${base}/${file.name}`;
}
