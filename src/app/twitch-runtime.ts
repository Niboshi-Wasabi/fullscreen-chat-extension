import { createTwitchAdapter, isTwitchChannelPage } from "../adapters/twitch";
import {
  extractTwitchChannelFromPage,
  isTwitchVodPage,
} from "../shared/site-ids";
import { startSiteRuntime } from "./site-runtime";

function resolveCurrentHref(): string | undefined {
  if (typeof location === "undefined") {
    return undefined;
  }
  if (location.href) {
    return location.href;
  }
  if (location.hostname) {
    return `https://${location.hostname}${location.pathname ?? "/"}`;
  }
  return undefined;
}

/**
 * Twitch live/VOD runtime — same panel/filter pipeline as YouTube.
 * Twitch ライブ／VOD ランタイム。YouTube と同じパネルとフィルタの処理を使う。
 */
export function startTwitchRuntime(signal?: AbortSignal): Promise<() => void> {
  return startSiteRuntime(
    {
      site: "twitch",
      createAdapter: (context) =>
        createTwitchAdapter({
          shouldRecoverCollapsedChat: context?.needsDomMessages,
        }),
      isSiteActive: isTwitchChannelPage,
      isSiteEnabled: (settings) => settings.twitch.enabled,
      resolveMountParent: resolveTwitchMountParent,
      isCrossSiteBridgeEligible: () => !isTwitchVodPage(resolveCurrentHref()),
      resolveBridgeChannelLogin: () => {
        const href = resolveCurrentHref();
        if (!href || isTwitchVodPage(href)) {
          return null;
        }
        return extractTwitchChannelFromPage(href);
      },
    },
    signal,
  );
}

function resolveTwitchMountParent(): HTMLElement {
  const container = pickMountCandidate(".video-player__container");
  if (container) {
    return container;
  }
  const player = pickMountCandidate("[data-a-target='video-player']");
  if (player) {
    return player;
  }
  const video = pickMountCandidate("video");
  if (video) {
    return (
      video.closest<HTMLElement>(
        ".video-player__container, [data-a-target='video-player']",
      ) ??
      video.parentElement ??
      document.body
    );
  }
  return document.body;
}

function pickMountCandidate(selector: string): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  for (const candidate of document.querySelectorAll<HTMLElement>(selector)) {
    if (!candidate.isConnected) {
      continue;
    }
    fallback ??= candidate;
    const rect = candidate.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return candidate;
    }
  }
  return fallback;
}
