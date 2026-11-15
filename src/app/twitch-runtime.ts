import { createTwitchAdapter, isTwitchChannelPage } from "../adapters/twitch";
import { startSiteRuntime } from "./site-runtime";

/**
 * Twitch live/VOD runtime — same panel/filter pipeline as YouTube.
 * Twitch ライブ／VOD ランタイム。YT と同じパネル／フィルタ経路。
 */
export function startTwitchRuntime(signal?: AbortSignal): Promise<() => void> {
  return startSiteRuntime(
    {
      site: "twitch",
      createAdapter: createTwitchAdapter,
      isSiteActive: isTwitchChannelPage,
      isSiteEnabled: (settings) => settings.twitch.enabled,
      resolveMountParent: () =>
        document.querySelector<HTMLElement>(".video-player__container") ??
        document.querySelector<HTMLElement>("[data-a-target='video-player']") ??
        document.querySelector<HTMLElement>("video")?.parentElement ??
        document.body,
    },
    signal,
  );
}
