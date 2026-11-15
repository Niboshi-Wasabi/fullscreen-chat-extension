import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isYouTubeChatReplay,
  isYouTubeLiveNow,
  isYouTubeWatchWithComments,
  isYouTubeWatchWithLiveChat,
} from "../../src/shared/youtube-page";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWatchPage(options: {
  pathname?: string;
  query?: (selector: string) => Element | null;
  getComputedStyle?: (el: Element) => {
    display: string;
    visibility: string;
  };
}): void {
  vi.stubGlobal("location", {
    href: `https://www.youtube.com${options.pathname ?? "/watch?v=abc"}`,
    pathname: options.pathname ?? "/watch",
    hostname: "www.youtube.com",
  });
  vi.stubGlobal("document", {
    querySelector: options.query ?? (() => null),
  });
  vi.stubGlobal("window", {
    getComputedStyle:
      options.getComputedStyle ??
      (() => ({ display: "block", visibility: "visible" })),
  });
}

describe("YouTube page mode detection (ISS-021)", () => {
  it("treats a normal watch page as comments even with broadcast meta and chatframe", () => {
    stubWatchPage({
      query: (selector) => {
        if (selector.includes("isLiveBroadcast")) {
          return { getAttribute: () => "True" } as unknown as Element;
        }
        if (
          selector.includes("ytd-live-chat-frame iframe") ||
          selector.includes("iframe#chatframe")
        ) {
          return { tagName: "IFRAME" } as unknown as Element;
        }
        return null;
      },
    });
    expect(isYouTubeLiveNow()).toBe(false);
    expect(isYouTubeChatReplay()).toBe(false);
    expect(isYouTubeWatchWithLiveChat()).toBe(false);
    expect(isYouTubeWatchWithComments()).toBe(true);
  });

  it("detects an active live via visible live badge UI", () => {
    stubWatchPage({
      query: (selector) => {
        if (selector.includes("badge-style-type-live-now")) {
          return {
            className: "badge-style-type-live-now",
          } as unknown as Element;
        }
        return null;
      },
    });
    expect(isYouTubeLiveNow()).toBe(true);
    expect(isYouTubeWatchWithLiveChat()).toBe(true);
    expect(isYouTubeWatchWithComments()).toBe(false);
  });

  it("detects chat replay via frame text and uses the live-chat path", () => {
    stubWatchPage({
      query: (selector) => {
        if (selector === "ytd-live-chat-frame") {
          return {
            textContent: "Chat replay is available",
          } as unknown as Element;
        }
        return null;
      },
    });
    expect(isYouTubeLiveNow()).toBe(false);
    expect(isYouTubeChatReplay()).toBe(true);
    expect(isYouTubeWatchWithLiveChat()).toBe(true);
    expect(isYouTubeWatchWithComments()).toBe(false);
  });

  it("treats /live/ as live unless chat replay is showing", () => {
    stubWatchPage({
      pathname: "/live/channel-slug",
      query: () => null,
    });
    expect(isYouTubeLiveNow()).toBe(true);
    expect(isYouTubeWatchWithLiveChat()).toBe(true);

    stubWatchPage({
      pathname: "/live/channel-slug",
      query: (selector) => {
        if (selector === "ytd-live-chat-frame") {
          return {
            textContent: "チャットの再生",
          } as unknown as Element;
        }
        return null;
      },
    });
    expect(isYouTubeLiveNow()).toBe(false);
    expect(isYouTubeChatReplay()).toBe(true);
    expect(isYouTubeWatchWithLiveChat()).toBe(true);
  });

  it("ignores a disabled or hidden ytp-live-badge", () => {
    const badge = {
      hasAttribute: (name: string) => name === "disabled",
    } as unknown as Element;
    stubWatchPage({
      query: (selector) => (selector.includes("ytp-live-badge") ? badge : null),
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    });
    expect(isYouTubeLiveNow()).toBe(false);
    expect(isYouTubeWatchWithComments()).toBe(true);
  });
});
