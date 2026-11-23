import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isYouTubeChatReplay,
  isYouTubeLiveChatContext,
  isYouTubeLiveNow,
  isYouTubeWatchWithLiveChat,
} from "../../src/shared/youtube-page";
import {
  ensureYouTubeChatFrameSrc,
  isStaleYouTubeChatFrameUrl,
  markYouTubeWatchTransition,
  resolveNativePanelChatUrl,
  resolvePopoutTarget,
  resolvePopoutTargetForPolicy,
  resolveYouTubePageChatFrameSrc,
  resolveYouTubePageVideoId,
} from "../../src/shared/site-ids";

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

/** Emulate querySelector for a page where exactly these selectors match. */
function queryMatching(
  presentOnPage: readonly string[],
): (selector: string) => Element | null {
  return (selector) =>
    selector
      .split(",")
      .map((part) => part.trim())
      .some((part) => presentOnPage.includes(part))
      ? ({ className: "match" } as unknown as Element)
      : null;
}

describe("YouTube page mode detection (ISS-021 / ISS-027)", () => {
  it("never activates on a normal watch or Shorts page even with broadcast meta and chatframe", () => {
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

    stubWatchPage({
      pathname: "/shorts/abc123",
      query: () => null,
    });
    expect(isYouTubeLiveNow()).toBe(false);
    expect(isYouTubeChatReplay()).toBe(false);
    expect(isYouTubeWatchWithLiveChat()).toBe(false);
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
  });

  it("detects chat replay via frame text (EN/JA) or hydrated replay iframe src", () => {
    for (const replayText of [
      "Chat replay is available",
      "チャットのリプレイを表示",
    ]) {
      stubWatchPage({
        query: (selector) => {
          if (selector === "ytd-live-chat-frame") {
            return {
              textContent: replayText,
              querySelector: () => null,
            } as unknown as Element;
          }
          return null;
        },
      });
      expect(isYouTubeLiveNow()).toBe(false);
      expect(isYouTubeChatReplay()).toBe(true);
      expect(isYouTubeWatchWithLiveChat()).toBe(true);
    }

    for (const replayFrame of [
      {
        getAttribute: () =>
          "https://www.youtube.com/live_chat_replay?continuation=abc",
      },
      {
        src: "",
        getAttribute: () => null,
        contentWindow: {
          location: {
            href: "https://www.youtube.com/live_chat_replay?continuation=abc",
          },
        },
      },
    ]) {
      stubWatchPage({
        query: (selector) => {
          if (selector === "ytd-live-chat-frame") {
            return {
              textContent: "Hide chat",
              querySelector: () => replayFrame,
            } as unknown as Element;
          }
          return null;
        },
      });
      expect(isYouTubeLiveNow()).toBe(false);
      expect(isYouTubeChatReplay()).toBe(true);
      expect(isYouTubeWatchWithLiveChat()).toBe(true);
    }
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

  it("treats visible ytp-live-badge (even disabled at live edge) as live, and ignores hidden badges", () => {
    const badge = {
      hasAttribute: (name: string) => name === "disabled",
    } as unknown as Element;
    stubWatchPage({
      query: (selector) => (selector.includes("ytp-live-badge") ? badge : null),
      getComputedStyle: () => ({
        display: "inline-block",
        visibility: "visible",
      }),
    });
    expect(isYouTubeLiveNow()).toBe(true);
    expect(isYouTubeWatchWithLiveChat()).toBe(true);

    stubWatchPage({
      query: (selector) => (selector.includes("ytp-live-badge") ? badge : null),
      getComputedStyle: () => ({ display: "none", visibility: "visible" }),
    });
    expect(isYouTubeLiveNow()).toBe(false);
    expect(isYouTubeWatchWithLiveChat()).toBe(false);
  });

  it("matches live_chat context only on YouTube live_chat paths, not query strings", () => {
    expect(
      isYouTubeLiveChatContext("https://www.youtube.com/live_chat?v=abc"),
    ).toBe(true);
    expect(
      isYouTubeLiveChatContext(
        "https://www.youtube.com/live_chat_replay?continuation=xyz",
      ),
    ).toBe(true);
    expect(
      isYouTubeLiveChatContext(
        "https://www.youtube.com/watch?v=abc&q=live_chat",
      ),
    ).toBe(false);
    expect(
      isYouTubeLiveChatContext("https://www.youtube.com/watch?v=abc#live_chat"),
    ).toBe(false);
    expect(
      isYouTubeLiveChatContext("https://example.test/live_chat?v=abc"),
    ).toBe(false);
  });

  it("ignores live badges outside the main player and the watched video's metadata", () => {
    // Selectors the fake page would match: related thumbnails (also under
    // #primary in the narrow layout) and a hover-preview player.
    const presentOnPage = [
      "#primary .badge-style-type-live-now",
      "#related .badge-style-type-live-now",
      ".badge-style-type-live-now",
      ".html5-video-player.ytp-live",
      ".html5-video-player .ytp-live-badge",
      ".ytp-live-badge",
    ];
    stubWatchPage({ query: queryMatching(presentOnPage) });
    expect(isYouTubeLiveNow()).toBe(false);
    expect(isYouTubeWatchWithLiveChat()).toBe(false);

    stubWatchPage({
      query: queryMatching(["ytd-watch-metadata .badge-style-type-live-now"]),
    });
    expect(isYouTubeLiveNow()).toBe(true);
  });

  it("never treats home, search, Shorts or feed pages as live even with player live UI", () => {
    const liveUi = ["#movie_player.ytp-live", "#movie_player .ytp-live-badge"];
    for (const pathname of [
      "/",
      "/results",
      "/shorts/abc123",
      "/feed/subscriptions",
    ]) {
      stubWatchPage({ pathname, query: queryMatching(liveUi) });
      expect(isYouTubeLiveNow(), pathname).toBe(false);
      expect(isYouTubeWatchWithLiveChat(), pathname).toBe(false);
    }
    for (const pathname of ["/@LofiGirl/live", "/channel/UC123/live"]) {
      stubWatchPage({ pathname, query: queryMatching(liveUi) });
      expect(isYouTubeLiveNow(), pathname).toBe(true);
    }
  });
});

describe("YouTube page chatframe preference (ISS-022)", () => {
  it("returns the hydrated chatframe src and ignores about:blank", () => {
    const doc = {
      querySelector: (selector: string) => {
        if (selector.includes("iframe#chatframe")) {
          return {
            src: "https://www.youtube.com/live_chat?v=abc&dark_theme=1",
          };
        }
        return null;
      },
    } as unknown as Document;
    expect(resolveYouTubePageChatFrameSrc(doc)).toBe(
      "https://www.youtube.com/live_chat?v=abc&dark_theme=1",
    );

    const blank = {
      querySelector: () => ({ src: "about:blank" }),
    } as unknown as Document;
    expect(resolveYouTubePageChatFrameSrc(blank)).toBeNull();
  });

  it("retains hydrated replay URL after chatframe collapses and recovers from ytInitialData", () => {
    const watchUrl = "https://www.youtube.com/watch?v=vidClose123";
    const replayUrl =
      "https://www.youtube.com/live_chat_replay?continuation=tok123";
    const hydratedDoc = {
      querySelector: (selector: string) =>
        selector.includes("iframe#chatframe") ? { src: replayUrl } : null,
      querySelectorAll: () => [],
    } as unknown as Document;
    expect(resolveYouTubePageChatFrameSrc(hydratedDoc, watchUrl)).toBe(
      replayUrl,
    );

    const collapsedDoc = {
      querySelector: () => ({ src: "about:blank#blocked" }),
      querySelectorAll: () => [],
    } as unknown as Document;
    expect(resolveYouTubePageChatFrameSrc(collapsedDoc, watchUrl)).toBe(
      replayUrl,
    );

    const preCollapsedDoc = {
      querySelector: () => ({ src: "about:blank" }),
      querySelectorAll: () => [
        {
          textContent: `var ytInitialData = ${JSON.stringify({
            currentVideoEndpoint: {
              watchEndpoint: { videoId: "vidPreCollapsed" },
            },
            contents: {
              twoColumnWatchNextResults: {
                conversationBar: {
                  liveChatRenderer: {
                    isReplay: true,
                    continuations: [
                      { reloadContinuationData: { continuation: "preTok456" } },
                    ],
                  },
                },
              },
            },
          })};`,
        },
      ],
    } as unknown as Document;
    expect(
      resolveYouTubePageChatFrameSrc(
        preCollapsedDoc,
        "https://www.youtube.com/watch?v=vidPreCollapsed",
      ),
    ).toBe(
      "https://www.youtube.com/live_chat_replay?continuation=preTok456&dark_theme=1",
    );
  });

  it("recovers continuation via same-origin watch HTML fetch after SPA navigation when chatframe stays collapsed", async () => {
    const spaWatchUrl = "https://www.youtube.com/watch?v=vidSpa999";
    vi.stubGlobal("document", {
      querySelector: (selector: string) =>
        selector === "ytd-live-chat-frame" ? ({} as Element) : null,
      querySelectorAll: () => [
        {
          textContent: `var ytInitialData = ${JSON.stringify({
            currentVideoEndpoint: { watchEndpoint: { videoId: "vidHomePrev" } },
          })};`,
        },
      ],
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        `<html><script>var ytInitialData = ${JSON.stringify({
          currentVideoEndpoint: { watchEndpoint: { videoId: "vidSpa999" } },
          contents: {
            twoColumnWatchNextResults: {
              conversationBar: {
                liveChatRenderer: {
                  isReplay: false,
                  continuations: [
                    { reloadContinuationData: { continuation: "spaTok777" } },
                  ],
                },
              },
            },
          },
        })};if(window.yts){}</script></html>`,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await ensureYouTubeChatFrameSrc(spaWatchUrl);
    expect(resolved).toBe(
      "https://www.youtube.com/live_chat?continuation=spaTok777&dark_theme=1",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resolveYouTubePageChatFrameSrc(document, spaWatchUrl)).toBe(
      "https://www.youtube.com/live_chat?continuation=spaTok777&dark_theme=1",
    );
  });

  it("resolves videoId from ytd-watch-flexy on channel /@handle/live pages", () => {
    const handleLiveUrl = "https://www.youtube.com/@LofiGirl/live";
    vi.stubGlobal("location", {
      href: handleLiveUrl,
      pathname: "/@LofiGirl/live",
      hostname: "www.youtube.com",
    });
    vi.stubGlobal("document", {
      location: { href: handleLiveUrl },
      querySelector: (selector: string) => {
        if (selector === "ytd-watch-flexy") {
          return {
            getAttribute: (name: string) =>
              name === "video-id" ? "chanLive42" : null,
          };
        }
        return null;
      },
    });
    expect(resolveYouTubePageVideoId(handleLiveUrl)).toBe("chanLive42");
    expect(resolveNativePanelChatUrl(handleLiveUrl)).toBe(
      "https://www.youtube.com/live_chat?v=chanLive42&dark_theme=1",
    );
    expect(resolvePopoutTarget(handleLiveUrl)).toEqual({
      siteKey: "youtube",
      url: "https://www.youtube.com/live_chat?v=chanLive42&is_popout=1&dark_theme=1",
    });
  });

  it("waits for continuation instead of falling back to /live_chat?v= on replay pages", () => {
    const replayPageUrl = "https://www.youtube.com/watch?v=replayWait1";
    let hydratedUrl = "";
    vi.stubGlobal("location", {
      href: replayPageUrl,
      pathname: "/watch",
      hostname: "www.youtube.com",
    });
    vi.stubGlobal("document", {
      location: { href: replayPageUrl },
      querySelectorAll: () => [],
      querySelector: (selector: string) => {
        if (selector === "ytd-live-chat-frame") {
          return {
            textContent: "チャットのリプレイを表示",
            querySelector: () =>
              hydratedUrl
                ? {
                    contentWindow: { location: { href: hydratedUrl } },
                    getAttribute: () => null,
                  }
                : null,
          };
        }
        if (selector === "iframe#chatframe") {
          return hydratedUrl
            ? {
                contentWindow: { location: { href: hydratedUrl } },
                getAttribute: () => null,
              }
            : null;
        }
        return null;
      },
    });
    expect(resolveNativePanelChatUrl(replayPageUrl)).toBeNull();
    expect(
      resolvePopoutTargetForPolicy("currentLive", replayPageUrl),
    ).toBeNull();
    hydratedUrl =
      "https://www.youtube.com/live_chat_replay?continuation=replayTok99";
    expect(resolveNativePanelChatUrl(replayPageUrl)).toBe(hydratedUrl);
    expect(resolvePopoutTargetForPolicy("currentLive", replayPageUrl)).toEqual({
      siteKey: "youtube",
      url: "https://www.youtube.com/live_chat_replay?continuation=replayTok99&is_popout=1",
    });
  });

  it("never opens a popout on a regular YouTube video, even with anyWatchPage", () => {
    const regularUrl = "https://www.youtube.com/watch?v=regular1";
    stubWatchPage({ query: () => null });
    vi.stubGlobal("location", {
      href: regularUrl,
      pathname: "/watch",
      hostname: "www.youtube.com",
    });
    expect(resolvePopoutTargetForPolicy("anyWatchPage", regularUrl)).toBeNull();
    expect(resolvePopoutTargetForPolicy("currentLive", regularUrl)).toBeNull();
  });

  it("treats alternate live/premiere watch badges as active live popout targets", () => {
    const premiereUrl = "https://www.youtube.com/watch?v=prem123";
    stubWatchPage({
      pathname: "/watch",
      query: (selector) => {
        if (selector.includes("badge-style-type-live-now-alternate")) {
          return {
            className: "badge-style-type-live-now-alternate",
          } as unknown as Element;
        }
        return null;
      },
    });
    vi.stubGlobal("location", {
      href: premiereUrl,
      pathname: "/watch",
      hostname: "www.youtube.com",
    });
    expect(isYouTubeLiveNow()).toBe(true);
    expect(isYouTubeWatchWithLiveChat()).toBe(true);
    expect(resolvePopoutTargetForPolicy("currentLive", premiereUrl)).toEqual({
      siteKey: "youtube",
      url: "https://www.youtube.com/live_chat?v=prem123&is_popout=1&dark_theme=1",
    });
  });

  it("ignores stale chatframe URLs from the previous video across SPA transitions", () => {
    const staleUrl =
      "https://www.youtube.com/live_chat?continuation=oldStreamCont&dark_theme=1";
    const freshUrl =
      "https://www.youtube.com/live_chat_replay?continuation=newArchiveCont&dark_theme=1";
    let currentFrameSrc = staleUrl;
    const watchDoc = {
      location: { href: "https://www.youtube.com/watch?v=streamOld" },
      querySelector: (selector: string) =>
        selector.includes("chatframe")
          ? {
              getAttribute: () => currentFrameSrc,
              src: currentFrameSrc,
            }
          : null,
      querySelectorAll: (selector: string) =>
        selector.includes("chatframe")
          ? [
              {
                getAttribute: () => currentFrameSrc,
                src: currentFrameSrc,
              },
            ]
          : [],
    } as unknown as Document;

    expect(
      resolveYouTubePageChatFrameSrc(
        watchDoc,
        "https://www.youtube.com/watch?v=streamOld",
      ),
    ).toBe(staleUrl);

    markYouTubeWatchTransition("streamOld", watchDoc);
    expect(isStaleYouTubeChatFrameUrl(staleUrl, "streamNew")).toBe(true);
    expect(
      resolveYouTubePageChatFrameSrc(
        watchDoc,
        "https://www.youtube.com/watch?v=streamNew",
      ),
    ).toBeNull();

    currentFrameSrc = freshUrl;
    expect(
      resolveYouTubePageChatFrameSrc(
        watchDoc,
        "https://www.youtube.com/watch?v=streamNew",
      ),
    ).toBe(freshUrl);
  });

  it("ignores hidden ytd-live-chat-frame and mismatched video replay iframes", () => {
    stubWatchPage({
      pathname: "/watch?v=regularVid",
      query: (selector) => {
        if (selector === "ytd-live-chat-frame") {
          return {
            getAttribute: (name: string) => (name === "hidden" ? "" : null),
            textContent: "Chat replay is available",
            querySelector: () => null,
          } as unknown as Element;
        }
        return null;
      },
    });
    expect(isYouTubeChatReplay()).toBe(false);
    expect(isYouTubeWatchWithLiveChat()).toBe(false);

    vi.stubGlobal("location", {
      href: "https://www.youtube.com/watch?v=regularVid",
      pathname: "/watch",
      hostname: "www.youtube.com",
    });
    vi.stubGlobal("document", {
      querySelector: (selector: string) => {
        if (selector === "ytd-live-chat-frame") {
          return {
            getAttribute: () => null,
            textContent: "Chat replay is available",
            querySelector: () => ({
              getAttribute: () =>
                "https://www.youtube.com/live_chat_replay?v=oldVid",
            }),
          } as unknown as Element;
        }
        return null;
      },
    });
    expect(isYouTubeChatReplay()).toBe(false);
    expect(isYouTubeWatchWithLiveChat()).toBe(false);
  });
});
