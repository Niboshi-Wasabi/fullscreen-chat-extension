import { describe, expect, it } from "vitest";
import { isYouTubeChatMessage } from "../../src/shared/youtube-chat-bridge";
import { message } from "../helpers";

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
    ]) {
      expect(isYouTubeChatMessage({ ...valid, ...patch })).toBe(false);
    }
    expect(
      isYouTubeChatMessage({
        ...valid,
        segments: [
          { type: "emoji", alt: "ok", src: "https://example.test/emoji.png" },
        ],
      }),
    ).toBe(true);
  });
});
