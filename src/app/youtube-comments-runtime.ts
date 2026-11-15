import {
  createYouTubeCommentsAdapter,
  isYouTubeWatchWithComments,
} from "../adapters/youtube-comments";
import { startSiteRuntime } from "./site-runtime";

/**
 * YouTube VOD / regular-video comments runtime (panel only).
 * YouTube 通常コメント用ランタイム（パネルのみ）。
 */
export function startYouTubeCommentsRuntime(
  signal?: AbortSignal,
): Promise<() => void> {
  return startSiteRuntime(
    {
      site: "youtube-comments",
      createAdapter: createYouTubeCommentsAdapter,
      isSiteActive: isYouTubeWatchWithComments,
      isSiteEnabled: (settings) => settings.youtubeComments.enabled,
      resolveMountParent: () =>
        document.querySelector<HTMLElement>(".html5-video-player") ??
        document.querySelector<HTMLElement>("#movie_player") ??
        document.body,
    },
    signal,
  );
}
