/**
 * Read the host page's media clock (YouTube / Twitch player).
 * ホストページの再生時刻（YouTube / Twitch プレイヤー）を読む。
 */

export function getPageMediaTimeSec(): number | null {
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

/** Bind timeupdate/seeked for archive sync / アーカイブ同期用の再生イベント */
export function watchMediaClock(
  onTick: (timeSec: number, meta: { seeked: boolean }) => void,
): () => void {
  let video: HTMLVideoElement | null = null;
  let attached: HTMLVideoElement | null = null;

  const onTimeUpdate = () => {
    if (!video || !Number.isFinite(video.currentTime)) {
      return;
    }
    onTick(video.currentTime, { seeked: false });
  };
  const onSeeked = () => {
    if (!video || !Number.isFinite(video.currentTime)) {
      return;
    }
    onTick(video.currentTime, { seeked: true });
  };

  const bind = (next: HTMLVideoElement | null) => {
    if (attached === next) {
      return;
    }
    if (attached) {
      attached.removeEventListener("timeupdate", onTimeUpdate);
      attached.removeEventListener("seeked", onSeeked);
    }
    attached = next;
    video = next;
    if (attached) {
      attached.addEventListener("timeupdate", onTimeUpdate);
      attached.addEventListener("seeked", onSeeked);
      onTick(attached.currentTime, { seeked: true });
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
