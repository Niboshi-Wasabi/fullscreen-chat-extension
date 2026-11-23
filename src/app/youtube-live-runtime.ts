import {
  createYouTubeLiveAdapter,
  isYouTubeWatchWithLiveChat,
} from "../adapters/youtube-live";
import { resolveYouTubePageVideoId } from "../shared/site-ids";
import { isYouTubeChatReplay } from "../shared/youtube-page";
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

function resolveYouTubeBridgeLabel(): string | null {
  const href = resolveCurrentHref();
  const videoId = href ? resolveYouTubePageVideoId(href) : null;
  if (
    typeof document !== "undefined" &&
    typeof document.querySelector === "function"
  ) {
    const heading = document
      .querySelector("ytd-watch-metadata h1, h1.ytd-watch-metadata")
      ?.textContent?.trim();
    if (heading) {
      return heading.slice(0, 80);
    }
    const title = document.title?.replace(/\s*-\s*YouTube\s*$/i, "").trim();
    if (title) {
      return title.slice(0, 80);
    }
  }
  return videoId ? `YouTube (${videoId})` : null;
}

/**
 * YouTube Live vertical slice runtime.
 * YouTube ライブの実行処理。
 */
export function startYouTubeLiveRuntime(
  signal?: AbortSignal,
): Promise<() => void> {
  return startSiteRuntime(
    {
      site: "youtube-live",
      createAdapter: createYouTubeLiveAdapter,
      isSiteActive: isYouTubeWatchWithLiveChat,
      isSiteEnabled: (settings) => settings.youtubeLive.enabled,
      resolveMountParent: () =>
        document.querySelector<HTMLElement>(".html5-video-player") ??
        document.querySelector<HTMLElement>("#movie_player") ??
        document.querySelector<HTMLElement>("#player-container-inner") ??
        document.querySelector<HTMLElement>("#player") ??
        document.body,
      isCrossSiteBridgeEligible: () => !isYouTubeChatReplay(),
      resolveBridgeChannelLogin: () => {
        if (isYouTubeChatReplay()) {
          return null;
        }
        const href = resolveCurrentHref();
        return href ? resolveYouTubePageVideoId(href) : null;
      },
      resolveBridgeLabel: resolveYouTubeBridgeLabel,
    },
    signal,
  );
}
