import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/shared/video-clock", () => ({
  getPageMediaTimeSec: vi.fn(() => 42),
}));

import {
  parseClockToSeconds,
  parseTwitchTimeParam,
  readTwitchVodOffsetSec,
} from "../../src/adapters/twitch";
import {
  extractTwitchChannelFromPage,
  isTwitchVodPage,
  resolveNativePanelChatUrl,
  resolvePopoutTarget,
} from "../../src/shared/site-ids";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Twitch VOD URL and popout policy", () => {
  it("detects VOD watch URLs and refuses live popout/embed targets", () => {
    expect(isTwitchVodPage("https://www.twitch.tv/videos/12345")).toBe(true);
    expect(isTwitchVodPage("https://www.twitch.tv/shroud")).toBe(false);
    expect(
      resolvePopoutTarget("https://www.twitch.tv/videos/12345"),
    ).toBeNull();
    expect(
      resolveNativePanelChatUrl("https://www.twitch.tv/videos/12345"),
    ).toBeNull();
  });

  it("parses clock stamps and Twitch t= query offsets", () => {
    expect(parseClockToSeconds("1:02:03")).toBe(3723);
    expect(parseClockToSeconds("12:34")).toBe(754);
    expect(
      parseTwitchTimeParam("https://www.twitch.tv/videos/1?t=1h2m3s"),
    ).toBe(3723);
    expect(parseTwitchTimeParam("/videos/1?t=90s")).toBe(90);
  });
});

describe("Twitch VOD message offsets", () => {
  it("reads t= links and falls back to the media clock", () => {
    vi.stubGlobal("location", {
      href: "https://www.twitch.tv/videos/2926946185",
      pathname: "/videos/2926946185",
      hostname: "www.twitch.tv",
    });

    const stamp = {
      textContent: "0:01:30",
      getAttribute: (name: string) =>
        name === "href" ? "/videos/1?t=0h1m30s" : null,
    };
    const stamped = {
      querySelector: (selector: string) =>
        selector.includes("timestamp") || selector.includes("t=")
          ? stamp
          : null,
    } as unknown as Element;
    expect(readTwitchVodOffsetSec(stamped)).toBe(90);

    const undated = {
      querySelector: () => null,
      getAttribute: () => null,
    } as unknown as Element;
    expect(readTwitchVodOffsetSec(undated)).toBe(42);
  });

  it("extracts the broadcaster login from VOD page anchors", () => {
    vi.stubGlobal("document", {
      querySelector: () => null,
      querySelectorAll: (selector: string) => {
        if (selector.includes("watch-mode-to-channel")) {
          return [{ getAttribute: () => "/shroud" }];
        }
        return [];
      },
    });
    expect(extractTwitchChannelFromPage("https://www.twitch.tv/videos/1")).toBe(
      "shroud",
    );
  });
});
