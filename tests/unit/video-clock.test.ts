import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLivePlaybackInterruption,
  watchLivePlaybackInterruptions,
} from "../../src/shared/video-clock";

class FakeVideoElement extends EventTarget {
  paused = false;
  ended = false;
  seeking = false;
  error: { code: number } | null = null;
  currentTime = 0;

  constructor(
    private readonly width = 640,
    private readonly height = 360,
  ) {
    super();
  }

  getBoundingClientRect() {
    return { width: this.width, height: this.height };
  }
}

let videos: FakeVideoElement[] = [];
let adShowing = false;

beforeEach(() => {
  videos = [];
  adShowing = false;
  vi.stubGlobal("HTMLVideoElement", FakeVideoElement);
  vi.stubGlobal("document", {
    querySelector: (selector: string) => {
      if (selector.includes("ad-showing")) {
        return adShowing ? {} : null;
      }
      return null;
    },
    querySelectorAll: (selector: string) =>
      selector === "video" ? videos : [],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("live playback interruption watch", () => {
  it("interrupts immediately on an already-paused video without firing duplicates across rebind ticks", () => {
    vi.useFakeTimers();
    const video = new FakeVideoElement();
    video.paused = true;
    videos = [video];

    expect(getLivePlaybackInterruption()).toBe("pause");

    const onInterrupt = vi.fn();
    const stop = watchLivePlaybackInterruptions(onInterrupt);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(onInterrupt).toHaveBeenCalledWith("pause");

    vi.advanceTimersByTime(4_500);
    expect(onInterrupt).toHaveBeenCalledTimes(1);

    stop();
  });

  it("interrupts immediately for seeking or errored video and ignores ended paused video", () => {
    const seekingVideo = new FakeVideoElement();
    seekingVideo.seeking = true;
    videos = [seekingVideo];
    expect(getLivePlaybackInterruption()).toBe("seek");
    const onSeekingInterrupt = vi.fn();
    const stopSeeking = watchLivePlaybackInterruptions(onSeekingInterrupt);
    expect(onSeekingInterrupt).toHaveBeenCalledTimes(1);
    expect(onSeekingInterrupt).toHaveBeenCalledWith("seek");
    stopSeeking();

    const erroredVideo = new FakeVideoElement();
    erroredVideo.error = { code: 2 };
    videos = [erroredVideo];
    expect(getLivePlaybackInterruption()).toBe("pause");
    const onErrorInterrupt = vi.fn();
    const stopErrored = watchLivePlaybackInterruptions(onErrorInterrupt);
    expect(onErrorInterrupt).toHaveBeenCalledWith("pause");
    stopErrored();

    const endedVideo = new FakeVideoElement();
    endedVideo.paused = true;
    endedVideo.ended = true;
    videos = [endedVideo];
    expect(getLivePlaybackInterruption()).toBeNull();
    const onEndedInterrupt = vi.fn();
    const stopEnded = watchLivePlaybackInterruptions(onEndedInterrupt);
    expect(onEndedInterrupt).not.toHaveBeenCalled();
    stopEnded();
  });

  it("keeps ad interruption precedence over a paused video at startup", () => {
    const video = new FakeVideoElement();
    video.paused = true;
    videos = [video];
    adShowing = true;

    expect(getLivePlaybackInterruption()).toBe("ad");

    const onInterrupt = vi.fn();
    const stop = watchLivePlaybackInterruptions(onInterrupt);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(onInterrupt).toHaveBeenCalledWith("ad");

    stop();
  });

  it("emits on error without pause, seeking, pause, and timeupdate jumps, then detaches on stop", () => {
    const video = new FakeVideoElement();
    video.currentTime = 10;
    videos = [video];

    expect(getLivePlaybackInterruption()).toBeNull();

    const onInterrupt = vi.fn();
    const stop = watchLivePlaybackInterruptions(onInterrupt);
    expect(onInterrupt).not.toHaveBeenCalled();

    video.dispatchEvent(new Event("error"));
    expect(onInterrupt).toHaveBeenNthCalledWith(1, "pause");

    video.dispatchEvent(new Event("seeking"));
    expect(onInterrupt).toHaveBeenNthCalledWith(2, "seek");

    video.dispatchEvent(new Event("pause"));
    expect(onInterrupt).toHaveBeenNthCalledWith(3, "pause");

    video.currentTime = 20;
    video.dispatchEvent(new Event("timeupdate"));
    expect(onInterrupt).toHaveBeenNthCalledWith(4, "seek");

    video.currentTime = 18;
    video.dispatchEvent(new Event("timeupdate"));
    expect(onInterrupt).toHaveBeenNthCalledWith(5, "seek");

    stop();
    video.dispatchEvent(new Event("error"));
    video.dispatchEvent(new Event("seeking"));
    video.dispatchEvent(new Event("pause"));
    video.currentTime = 50;
    video.dispatchEvent(new Event("timeupdate"));
    expect(onInterrupt).toHaveBeenCalledTimes(5);
  });

  it("detaches listeners from replaced video and interrupts immediately if the new video is paused", () => {
    vi.useFakeTimers();
    const first = new FakeVideoElement();
    const second = new FakeVideoElement();
    second.paused = true;
    videos = [first];

    const onInterrupt = vi.fn();
    const stop = watchLivePlaybackInterruptions(onInterrupt);
    expect(onInterrupt).not.toHaveBeenCalled();

    videos = [second];
    vi.advanceTimersByTime(1_500);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(onInterrupt).toHaveBeenCalledWith("pause");

    first.dispatchEvent(new Event("error"));
    expect(onInterrupt).toHaveBeenCalledTimes(1);

    second.dispatchEvent(new Event("seeking"));
    expect(onInterrupt).toHaveBeenCalledTimes(2);
    expect(onInterrupt).toHaveBeenLastCalledWith("seek");

    stop();
  });

  it("detects visible Twitch video ad markers, ignores hidden or banner display ads, and emits via player observer", () => {
    vi.useFakeTimers();
    const player = {
      hidden: false,
      style: { display: "" },
    };
    const makeMarker = (attrs?: {
      hiddenAttr?: boolean;
      ariaHidden?: string;
      display?: string;
    }) => ({
      getAttribute: (name: string) => {
        if (name === "hidden") return attrs?.hiddenAttr ? "" : null;
        if (name === "aria-hidden") return attrs?.ariaHidden ?? null;
        return null;
      },
      hidden: Boolean(attrs?.hiddenAttr),
      style: { display: attrs?.display ?? "" },
    });

    let twitchMarkers: ReturnType<typeof makeMarker>[] = [];
    let observedTarget: unknown = null;
    let observerCallback: (() => void) | null = null;
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(cb: () => void) {
          observerCallback = cb;
        }
        observe(target: unknown) {
          observedTarget = target;
        }
        disconnect() {}
      },
    );
    vi.stubGlobal("document", {
      querySelector: (selector: string) => {
        if (selector.includes("ad-showing")) return adShowing ? {} : null;
        if (selector.includes("video-player__container")) return player;
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector === "video") return videos;
        if (selector.includes("video-ad-label")) return twitchMarkers;
        return [];
      },
    });

    const playingVideo = new FakeVideoElement();
    videos = [playingVideo];

    // Hidden marker or display-banner-only (non-matching selector) stays null.
    twitchMarkers = [
      makeMarker({ hiddenAttr: true }),
      makeMarker({ ariaHidden: "true" }),
      makeMarker({ display: "none" }),
    ];
    expect(getLivePlaybackInterruption()).toBeNull();

    const onInterrupt = vi.fn();
    const stop = watchLivePlaybackInterruptions(onInterrupt);
    expect(observedTarget).toBe(player);
    expect(onInterrupt).not.toHaveBeenCalled();

    // Visible [data-a-target="video-ad-label"] / countdown / ad-banner-default-text triggers "ad".
    twitchMarkers = [makeMarker()];
    const notifyObserver = observerCallback as (() => void) | null;
    notifyObserver?.();
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(onInterrupt).toHaveBeenLastCalledWith("ad");
    expect(getLivePlaybackInterruption()).toBe("ad");

    // Re-arms after ad ends and fires on next ad interval check.
    twitchMarkers = [];
    vi.advanceTimersByTime(500);
    expect(getLivePlaybackInterruption()).toBeNull();

    twitchMarkers = [makeMarker()];
    vi.advanceTimersByTime(500);
    expect(onInterrupt).toHaveBeenCalledTimes(2);
    expect(onInterrupt).toHaveBeenLastCalledWith("ad");

    stop();
  });

  it("ignores Twitch video ad markers inside hidden ancestors or shadow hosts and reacts when the ancestor is unhidden", () => {
    vi.useFakeTimers();

    class FakeDomElement {
      hidden = false;
      isConnected = true;
      style: {
        display?: string;
        visibility?: string;
        opacity?: string;
        contentVisibility?: string;
      } = {};
      parentElement: FakeDomElement | null = null;
      parentNode: { host?: FakeDomElement | null } | null = null;
      private readonly attrs = new Map<string, string>();
      computedStyle: {
        display: string;
        visibility: string;
        opacity: string;
        contentVisibility?: string;
      } = { display: "block", visibility: "visible", opacity: "1" };
      checkVisibilityResult = true;

      setAttr(name: string, value: string | null) {
        if (value === null) {
          this.attrs.delete(name);
        } else {
          this.attrs.set(name, value);
        }
      }

      getAttribute(name: string): string | null {
        return this.attrs.get(name) ?? null;
      }

      checkVisibility(): boolean {
        return this.checkVisibilityResult;
      }
    }

    vi.stubGlobal("Element", FakeDomElement);
    vi.stubGlobal("window", {
      getComputedStyle: (el: FakeDomElement) => el.computedStyle,
    });

    const player = new FakeDomElement();
    let twitchMarkers: FakeDomElement[] = [];
    let observerCallback: (() => void) | null = null;
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(cb: () => void) {
          observerCallback = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("document", {
      querySelector: (selector: string) => {
        if (selector.includes("video-player__container")) return player;
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector === "video") return videos;
        if (selector.includes("video-ad-label")) return twitchMarkers;
        return [];
      },
    });

    videos = [new FakeVideoElement()];

    const createChildUnder = (parent: FakeDomElement): FakeDomElement => {
      const child = new FakeDomElement();
      child.parentElement = parent;
      return child;
    };

    const hiddenAttrParent = new FakeDomElement();
    hiddenAttrParent.setAttr("hidden", "");
    const ariaHiddenParent = new FakeDomElement();
    ariaHiddenParent.setAttr("aria-hidden", "true");
    const displayNoneParent = new FakeDomElement();
    displayNoneParent.style.display = "none";
    const visibilityHiddenParent = new FakeDomElement();
    visibilityHiddenParent.style.visibility = "hidden";
    const opacityZeroParent = new FakeDomElement();
    opacityZeroParent.style.opacity = "0";
    const computedHiddenParent = new FakeDomElement();
    computedHiddenParent.computedStyle.display = "none";
    const hiddenShadowHost = new FakeDomElement();
    hiddenShadowHost.style.display = "none";
    const shadowChild = new FakeDomElement();
    shadowChild.parentNode = { host: hiddenShadowHost };
    const checkVisibilityFalseMarker = new FakeDomElement();
    checkVisibilityFalseMarker.checkVisibilityResult = false;

    twitchMarkers = [
      createChildUnder(hiddenAttrParent),
      createChildUnder(ariaHiddenParent),
      createChildUnder(displayNoneParent),
      createChildUnder(visibilityHiddenParent),
      createChildUnder(opacityZeroParent),
      createChildUnder(computedHiddenParent),
      shadowChild,
      checkVisibilityFalseMarker,
    ];

    expect(getLivePlaybackInterruption()).toBeNull();
    const onInterrupt = vi.fn();
    const stop = watchLivePlaybackInterruptions(onInterrupt);
    expect(onInterrupt).not.toHaveBeenCalled();

    // Unhiding the computed-display-none parent triggers "ad" via MutationObserver.
    twitchMarkers = [createChildUnder(computedHiddenParent)];
    computedHiddenParent.computedStyle.display = "block";
    const notifyObserver = observerCallback as (() => void) | null;
    notifyObserver?.();
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(onInterrupt).toHaveBeenLastCalledWith("ad");
    expect(getLivePlaybackInterruption()).toBe("ad");

    // Re-hiding the parent clears the interruption and re-arms future detection.
    computedHiddenParent.computedStyle.display = "none";
    vi.advanceTimersByTime(500);
    expect(getLivePlaybackInterruption()).toBeNull();

    // display: contents markers rely on ancestor/computed styles rather than checkVisibility false.
    const contentsMarker = new FakeDomElement();
    contentsMarker.computedStyle.display = "contents";
    contentsMarker.checkVisibilityResult = false;
    twitchMarkers = [contentsMarker];
    vi.advanceTimersByTime(500);
    expect(onInterrupt).toHaveBeenCalledTimes(2);
    expect(onInterrupt).toHaveBeenLastCalledWith("ad");

    stop();
  });
});
