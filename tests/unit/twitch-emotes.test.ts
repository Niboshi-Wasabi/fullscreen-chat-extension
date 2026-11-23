import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTwitchEmoteMap } from "../../src/shared/twitch-emotes";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Twitch third-party emote cache", () => {
  it("caches FFZ and 7TV emotes even when BTTV requests fail", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("betterttv.net")) {
        return { ok: false, json: async () => [] };
      }
      if (url.includes("frankerfacez.com/v1/set/global")) {
        return {
          ok: true,
          json: async () => ({
            sets: {
              "3": {
                emoticons: [
                  {
                    name: "FfzWave",
                    urls: { "1": "//cdn.frankerfacez.com/emoticon/1/1" },
                  },
                ],
              },
            },
          }),
        };
      }
      if (url.includes("7tv.io/v3/emote-sets/global")) {
        return {
          ok: true,
          json: async () => ({
            emotes: [
              {
                name: "SevenWave",
                data: {
                  host: {
                    url: "//cdn.7tv.app/emote/abc",
                    files: [{ name: "1x.webp" }],
                  },
                },
              },
            ],
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await loadTwitchEmoteMap({
      channelLogin: "ffz_cache_only",
      channelId: null,
    });
    expect(first.get("FfzWave")?.src).toBe(
      "https://cdn.frankerfacez.com/emoticon/1/1",
    );
    expect(first.get("SevenWave")?.src).toBe(
      "https://cdn.7tv.app/emote/abc/1x.webp",
    );
    const callsAfterFirst = fetchMock.mock.calls.length;

    const second = await loadTwitchEmoteMap({
      channelLogin: "ffz_cache_only",
      channelId: null,
    });
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterFirst);
  });
});
