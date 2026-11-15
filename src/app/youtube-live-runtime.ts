import {
  createYouTubeLiveAdapter,
  isYouTubeWatchWithLiveChat,
} from "../adapters/youtube-live";
import { startSiteRuntime } from "./site-runtime";

/**
 * YouTube Live vertical slice runtime.
 * YouTube Live 縦通しランタイム。
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
    },
    signal,
  );
}
