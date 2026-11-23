import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  buildBridgePopoutUrl,
  isAllowedPopoutUrl,
  isPopoutRuntimeRequest,
  POPOUT_OPEN_TYPE,
} from "../../src/shared/runtime-messages";
import {
  isChatFrameSource,
  isYouTubeChatMessage,
} from "../../src/shared/youtube-chat-bridge";
import { message } from "../helpers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("YouTube iframe payload contract", () => {
  it("accepts a normalized line, rejects invalid fields and executable image URLs", () => {
    const valid = message({ site: "youtube-live" });
    expect(isYouTubeChatMessage(valid)).toBe(true);
    for (const patch of [
      { text: null },
      { timestampMs: NaN },
      { videoOffsetSec: Infinity },
      { badges: "bad" },
      { isSelf: "true" },
      { segments: [{ type: "emoji", alt: "bad", src: "javascript:alert(1)" }] },
      { text: "x".repeat(20001) },
      { badgeIcons: "not-an-array" },
      { badgeIcons: [{ alt: "x", src: "http://insecure.example/b.png" }] },
      { authorColor: "expression(alert(1))" },
    ]) {
      expect(isYouTubeChatMessage({ ...valid, ...patch })).toBe(false);
    }
    expect(
      isYouTubeChatMessage({
        ...valid,
        videoOffsetSec: -47,
      }),
    ).toBe(true);
    expect(
      isYouTubeChatMessage({
        ...valid,
        segments: [
          { type: "emoji", alt: "ok", src: "https://example.test/emoji.png" },
        ],
      }),
    ).toBe(true);
  });

  it("accepts trusted messages from same-origin chatframe navigated without src attribute", () => {
    const contentWindow = {
      location: {
        href: "https://www.youtube.com/live_chat_replay?continuation=abc",
      },
    };
    const chatFrame = {
      src: "",
      getAttribute: () => null,
      contentWindow,
    };
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      querySelectorAll: () => [chatFrame],
    });
    try {
      expect(
        isChatFrameSource({
          isTrusted: true,
          source: contentWindow,
          origin: "https://www.youtube.com",
        } as unknown as MessageEvent),
      ).toBe(true);
      expect(
        isChatFrameSource({
          isTrusted: true,
          source: contentWindow,
          origin: "https://evil.example",
        } as unknown as MessageEvent),
      ).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("runtime popout boundaries", () => {
  it("accepts only official YouTube live_chat and Twitch popout URLs matching siteKey", () => {
    expect(
      isAllowedPopoutUrl(
        "https://www.youtube.com/live_chat?v=abc&is_popout=1",
        "youtube",
      ),
    ).toBe(true);
    expect(
      isAllowedPopoutUrl(
        "https://www.twitch.tv/popout/fixture/chat?popout=",
        "twitch",
      ),
    ).toBe(true);

    for (const [url, siteKey] of [
      ["javascript:alert(1)", "youtube"],
      ["http://www.youtube.com/live_chat?v=abc", "youtube"],
      ["https://user:pass@www.youtube.com/live_chat?v=abc", "youtube"],
      ["https://evil.example/live_chat?v=abc", "youtube"],
      ["https://www.youtube.com/watch?v=abc", "youtube"],
      ["https://www.twitch.tv/popout/fixture/chat", "youtube"],
      ["https://www.youtube.com/live_chat?v=abc", "twitch"],
      ["chrome-extension://abcdefghijklmnop/popout-chat.html", "youtube"],
    ] as const) {
      expect(
        isPopoutRuntimeRequest({
          type: POPOUT_OPEN_TYPE,
          url,
          siteKey,
        }),
      ).toBe(false);
    }

    vi.spyOn(fakeBrowser.runtime, "getURL").mockImplementation(
      (path: string) => `chrome-extension://${fakeBrowser.runtime.id}${path}`,
    );
    const ytBridgeUrl = buildBridgePopoutUrl("youtube");
    const twBridgeUrl = buildBridgePopoutUrl("twitch");
    expect(ytBridgeUrl).toBe(
      `chrome-extension://${fakeBrowser.runtime.id}/bridge-popout.html?site=youtube`,
    );
    expect(isAllowedPopoutUrl(ytBridgeUrl!, "youtube")).toBe(true);
    expect(isAllowedPopoutUrl(twBridgeUrl!, "twitch")).toBe(true);
    expect(isAllowedPopoutUrl(ytBridgeUrl!, "twitch")).toBe(false);
    expect(
      isAllowedPopoutUrl(
        "chrome-extension://otherextensionid/bridge-popout.html?site=youtube",
        "youtube",
      ),
    ).toBe(false);
    expect(
      isAllowedPopoutUrl(
        `chrome-extension://${fakeBrowser.runtime.id}/popout-chat.html`,
        "youtube",
      ),
    ).toBe(false);
  });
});
