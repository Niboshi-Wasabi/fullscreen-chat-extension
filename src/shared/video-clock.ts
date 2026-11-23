/**
 * Read the host page's media clock (YouTube / Twitch player).
 * ホストページの再生時刻（YouTube / Twitch プレイヤー）を読む。
 */

const YOUTUBE_AD_SELECTOR =
  "#movie_player.ad-showing, .html5-video-player.ad-showing";
const TWITCH_VIDEO_AD_SELECTOR =
  '[data-a-target="video-ad-label"], [data-a-target="video-ad-countdown"], [data-test-selector="ad-banner-default-text"]';
const YOUTUBE_PLAYER_SELECTOR = "#movie_player, .html5-video-player";
const TWITCH_PLAYER_SELECTOR =
  "[data-a-target='video-player'], .video-player__container";

interface ElementLike {
  hidden?: unknown;
  isConnected?: unknown;
  style?: {
    display?: unknown;
    visibility?: unknown;
    opacity?: unknown;
    contentVisibility?: unknown;
  };
  parentElement?: ElementLike | null;
  parentNode?: ParentNode | { host?: ElementLike | Element | null } | null;
  getAttribute?: (name: string) => string | null;
  checkVisibility?: (options?: {
    checkOpacity?: boolean;
    checkVisibilityCSS?: boolean;
    opacityProperty?: boolean;
    visibilityProperty?: boolean;
  }) => boolean;
}

function normalizeCssValue(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isNodeHidden(node: ElementLike): boolean {
  if (node.isConnected === false) {
    return true;
  }
  if (typeof node.getAttribute === "function") {
    if (
      node.getAttribute("hidden") !== null ||
      node.getAttribute("aria-hidden") === "true"
    ) {
      return true;
    }
  }
  if (node.hidden === true) {
    return true;
  }
  const inlineDisplay = normalizeCssValue(node.style?.display);
  const inlineVisibility = normalizeCssValue(node.style?.visibility);
  const inlineContentVisibility = normalizeCssValue(
    node.style?.contentVisibility,
  );
  const inlineOpacity =
    typeof node.style?.opacity === "string" ? node.style.opacity.trim() : "";
  if (
    inlineDisplay === "none" ||
    inlineVisibility === "hidden" ||
    inlineVisibility === "collapse" ||
    inlineContentVisibility === "hidden" ||
    (inlineOpacity !== "" && Number(inlineOpacity) === 0)
  ) {
    return true;
  }
  if (
    typeof Element !== "undefined" &&
    node instanceof Element &&
    typeof window !== "undefined" &&
    typeof window.getComputedStyle === "function"
  ) {
    const style = window.getComputedStyle(node) as CSSStyleDeclaration & {
      contentVisibility?: string;
    };
    const display = normalizeCssValue(style.display);
    const visibility = normalizeCssValue(style.visibility);
    const contentVisibility = normalizeCssValue(style.contentVisibility);
    const opacity =
      typeof style.opacity === "string" ? style.opacity.trim() : "";
    if (
      display === "none" ||
      visibility === "hidden" ||
      visibility === "collapse" ||
      contentVisibility === "hidden" ||
      (opacity !== "" && Number.parseFloat(opacity) === 0)
    ) {
      return true;
    }
  }
  return false;
}

function getParentElementLike(node: ElementLike): ElementLike | null {
  if (node.parentElement) {
    return node.parentElement;
  }
  if (node.parentNode && "host" in node.parentNode && node.parentNode.host) {
    return node.parentNode.host as ElementLike;
  }
  return null;
}

function isAdMarkerVisible(element: Element | null): boolean {
  if (!element) {
    return false;
  }
  const visited = new Set<unknown>();
  let current: ElementLike | null = element as ElementLike;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (isNodeHidden(current)) {
      return false;
    }
    current = getParentElementLike(current);
  }
  if (typeof Element !== "undefined" && element instanceof Element) {
    const elementWithVisibility = element as ElementLike;
    if (typeof elementWithVisibility.checkVisibility === "function") {
      const display =
        typeof window !== "undefined" &&
        typeof window.getComputedStyle === "function"
          ? normalizeCssValue(window.getComputedStyle(element).display)
          : "";
      if (
        display !== "contents" &&
        !elementWithVisibility.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
          checkOpacity: true,
          checkVisibilityCSS: true,
        })
      ) {
        return false;
      }
    }
  }
  return true;
}

export function isHostVideoAdPlaying(): boolean {
  if (
    typeof document === "undefined" ||
    typeof document.querySelector !== "function"
  ) {
    return false;
  }
  if (document.querySelector(YOUTUBE_AD_SELECTOR)) {
    return true;
  }
  if (typeof document.querySelectorAll === "function") {
    for (const marker of Array.from(
      document.querySelectorAll(TWITCH_VIDEO_AD_SELECTOR),
    )) {
      if (isAdMarkerVisible(marker)) {
        return true;
      }
    }
    return false;
  }
  return isAdMarkerVisible(document.querySelector(TWITCH_VIDEO_AD_SELECTOR));
}

export function getPageMediaTimeSec(): number | null {
  if (isHostVideoAdPlaying()) {
    return null;
  }
  const video = resolvePrimaryVideo();
  if (!video) {
    return null;
  }
  if (!Number.isFinite(video.currentTime)) {
    return null;
  }
  return video.currentTime;
}

export function resolvePrimaryVideo(): HTMLVideoElement | null {
  if (
    typeof document === "undefined" ||
    typeof document.querySelectorAll !== "function" ||
    typeof HTMLVideoElement === "undefined"
  ) {
    return null;
  }
  const candidates = Array.from(document.querySelectorAll("video"));
  let best: HTMLVideoElement | null = null;
  let bestArea = 0;
  for (const video of candidates) {
    if (!(video instanceof HTMLVideoElement)) {
      continue;
    }
    const rect = video.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area > bestArea) {
      best = video;
      bestArea = area;
    }
  }
  return best;
}

/** Bind timeupdate/seeking/seeked for archive sync / アーカイブ同期用の再生イベント */
export function watchMediaClock(
  onTick: (
    timeSec: number,
    meta: { seeked: boolean; seeking?: boolean; initial?: boolean },
  ) => void,
): () => void {
  let video: HTMLVideoElement | null = null;
  let attached: HTMLVideoElement | null = null;
  let lastTimeSec: number | null = null;

  const onTimeUpdate = () => {
    if (
      !video ||
      !Number.isFinite(video.currentTime) ||
      isHostVideoAdPlaying()
    ) {
      return;
    }
    if (video.seeking) {
      lastTimeSec = video.currentTime;
      onTick(video.currentTime, { seeked: true, seeking: true });
      return;
    }
    const current = video.currentTime;
    const isInitial = lastTimeSec === null;
    const jumped =
      lastTimeSec !== null &&
      (current < lastTimeSec - 1 || current - lastTimeSec > 6);
    lastTimeSec = current;
    onTick(current, {
      seeked: jumped || isInitial,
      seeking: false,
      ...(isInitial ? { initial: true } : {}),
    });
  };
  const onSeeking = () => {
    if (
      !video ||
      !Number.isFinite(video.currentTime) ||
      isHostVideoAdPlaying()
    ) {
      return;
    }
    lastTimeSec = video.currentTime;
    onTick(video.currentTime, { seeked: true, seeking: true });
  };
  const onSeeked = () => {
    if (
      !video ||
      !Number.isFinite(video.currentTime) ||
      isHostVideoAdPlaying()
    ) {
      return;
    }
    const isInitial = lastTimeSec === null;
    lastTimeSec = video.currentTime;
    onTick(video.currentTime, {
      seeked: true,
      seeking: false,
      ...(isInitial ? { initial: true } : {}),
    });
  };

  const bind = (next: HTMLVideoElement | null) => {
    if (attached === next) {
      return;
    }
    if (attached) {
      attached.removeEventListener("timeupdate", onTimeUpdate);
      attached.removeEventListener("seeking", onSeeking);
      attached.removeEventListener("seeked", onSeeked);
    }
    attached = next;
    video = next;
    lastTimeSec = null;
    if (attached) {
      attached.addEventListener("timeupdate", onTimeUpdate);
      attached.addEventListener("seeking", onSeeking);
      attached.addEventListener("seeked", onSeeked);
      if (!isHostVideoAdPlaying() && Number.isFinite(attached.currentTime)) {
        lastTimeSec = attached.currentTime;
        onTick(attached.currentTime, {
          seeked: true,
          seeking: Boolean(attached.seeking),
          initial: true,
        });
      }
    }
  };

  bind(resolvePrimaryVideo());
  const timer = window.setInterval(() => {
    bind(resolvePrimaryVideo());
  }, 1500);

  return () => {
    window.clearInterval(timer);
    bind(null);
  };
}

export type LivePlaybackInterruption = "pause" | "seek" | "ad";

/** Return the current live-playback interruption reason, or null while playing normally.
 * ライブ再生が中断している理由を返す。通常再生中（または動画未検出時）は null。 */
export function getLivePlaybackInterruption(
  video: HTMLVideoElement | null = resolvePrimaryVideo(),
): LivePlaybackInterruption | null {
  if (isHostVideoAdPlaying()) {
    return "ad";
  }
  if (!video) {
    return null;
  }
  if (video.error) {
    return "pause";
  }
  if (video.seeking) {
    return "seek";
  }
  if (video.paused && !video.ended) {
    return "pause";
  }
  return null;
}

/** Watch live video interruptions (pause / seek / ad / error) for delay sync suspension.
 * ライブ再生の中断（一時停止・シーク・広告・エラー）を監視し、遅延同期の一時非表示に使う。 */
export function watchLivePlaybackInterruptions(
  onInterrupt: (reason: LivePlaybackInterruption) => void,
): () => void {
  let attached: HTMLVideoElement | null = null;
  let lastTimeSec: number | null = null;
  let lastAdPlaying = isHostVideoAdPlaying();
  let observedPlayer: Element | null = null;
  let observedPlayerKind: "youtube" | "twitch" | null = null;

  if (lastAdPlaying) {
    onInterrupt("ad");
  }

  const checkAd = () => {
    const playing = isHostVideoAdPlaying();
    if (playing && !lastAdPlaying) {
      lastAdPlaying = true;
      onInterrupt("ad");
    } else if (!playing) {
      lastAdPlaying = false;
    }
  };

  const adObserver =
    typeof MutationObserver !== "undefined"
      ? new MutationObserver(checkAd)
      : null;

  const ensurePlayerObserved = () => {
    if (!adObserver || typeof document === "undefined") {
      return;
    }
    const ytPlayer = document.querySelector(YOUTUBE_PLAYER_SELECTOR);
    const nextKind: "youtube" | "twitch" | null = ytPlayer
      ? "youtube"
      : document.querySelector(TWITCH_PLAYER_SELECTOR)
        ? "twitch"
        : null;
    const player =
      ytPlayer ??
      (nextKind === "twitch"
        ? document.querySelector(TWITCH_PLAYER_SELECTOR)
        : null);
    if (player === observedPlayer && nextKind === observedPlayerKind) {
      return;
    }
    adObserver.disconnect();
    observedPlayer = player;
    observedPlayerKind = nextKind;
    if (player && nextKind === "youtube") {
      adObserver.observe(player, {
        attributes: true,
        attributeFilter: ["class"],
      });
    } else if (player && nextKind === "twitch") {
      adObserver.observe(player, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "hidden", "style", "aria-hidden"],
      });
    }
  };

  const onPause = () => {
    if (!attached || attached.ended || isHostVideoAdPlaying()) {
      return;
    }
    onInterrupt("pause");
  };

  const onSeeking = () => {
    if (!attached || isHostVideoAdPlaying()) {
      return;
    }
    if (Number.isFinite(attached.currentTime)) {
      lastTimeSec = attached.currentTime;
    }
    onInterrupt("seek");
  };

  const onError = () => {
    if (!attached) {
      return;
    }
    if (isHostVideoAdPlaying()) {
      lastAdPlaying = true;
      onInterrupt("ad");
      return;
    }
    onInterrupt("pause");
  };

  const onTimeUpdate = () => {
    if (
      !attached ||
      !Number.isFinite(attached.currentTime) ||
      isHostVideoAdPlaying()
    ) {
      return;
    }
    const current = attached.currentTime;
    if (
      lastTimeSec !== null &&
      (current < lastTimeSec - 1 || current - lastTimeSec > 6)
    ) {
      lastTimeSec = current;
      onInterrupt("seek");
      return;
    }
    lastTimeSec = current;
  };

  const bind = (next: HTMLVideoElement | null) => {
    if (attached === next) {
      return;
    }
    if (attached) {
      attached.removeEventListener("pause", onPause);
      attached.removeEventListener("seeking", onSeeking);
      attached.removeEventListener("error", onError);
      attached.removeEventListener("timeupdate", onTimeUpdate);
    }
    attached = next;
    lastTimeSec = null;
    if (attached) {
      attached.addEventListener("pause", onPause);
      attached.addEventListener("seeking", onSeeking);
      attached.addEventListener("error", onError);
      attached.addEventListener("timeupdate", onTimeUpdate);
      if (Number.isFinite(attached.currentTime)) {
        lastTimeSec = attached.currentTime;
      }
      if (!lastAdPlaying) {
        const initialReason = getLivePlaybackInterruption(attached);
        if (initialReason !== null) {
          if (initialReason === "ad") {
            lastAdPlaying = true;
          }
          onInterrupt(initialReason);
        }
      }
    }
  };

  ensurePlayerObserved();
  bind(resolvePrimaryVideo());
  const rebindTimer = globalThis.setInterval(() => {
    ensurePlayerObserved();
    bind(resolvePrimaryVideo());
  }, 1500);
  const adTimer = globalThis.setInterval(checkAd, 500);

  return () => {
    globalThis.clearInterval(rebindTimer);
    globalThis.clearInterval(adTimer);
    adObserver?.disconnect();
    observedPlayer = null;
    observedPlayerKind = null;
    bind(null);
  };
}
