import { describe, expect, it } from "vitest";
import { routeDisplay } from "../../src/core/router";
import type { SiteKind } from "../../src/core/message";
import type { DisplayMode } from "../../src/shared/settings";
import { settings } from "../helpers";

const modes: DisplayMode[] = ["panel", "popout", "danmaku"];
const sites: SiteKind[] = ["youtube-live", "youtube-comments", "twitch"];

describe("display routing", () => {
  it.each(modes)(
    "never enables danmaku for threaded comments in %s mode",
    (mode) => {
      const current = settings();
      current.displayMode = mode;
      current.danmaku.enabled = true;
      current.danmakuOverlayOnPanel = true;
      const result = routeDisplay("youtube-comments", current);
      expect(result.danmakuAllowed).toBe(false);
      expect(result.showDanmaku).toBe(false);
    },
  );

  it.each(sites)("unmounts every display when disabled on %s", (site) => {
    for (const mode of modes) {
      const current = settings();
      current.enabled = false;
      current.displayMode = mode;
      current.danmaku.enabled = true;
      current.danmakuOverlayOnPanel = true;
      expect(routeDisplay(site, current)).toMatchObject({
        showPanel: false,
        showDanmaku: false,
        showPopout: false,
      });
    }
  });

  it("requires both overlay toggles for danmaku alongside the panel", () => {
    const current = settings();
    current.danmakuOverlayOnPanel = true;
    expect(routeDisplay("twitch", current).showDanmaku).toBe(false);
    current.danmaku.enabled = true;
    expect(routeDisplay("twitch", current)).toMatchObject({
      showPanel: true,
      showDanmaku: true,
      showPopout: false,
    });
  });

  it("allows popout for threaded comments without enabling danmaku (ISS-003)", () => {
    const current = settings();
    current.displayMode = "popout";
    current.danmaku.enabled = true;
    current.danmakuOverlayOnPanel = true;
    expect(routeDisplay("youtube-comments", current)).toMatchObject({
      showPanel: false,
      showPopout: true,
      showDanmaku: false,
      popoutAllowed: true,
      danmakuAllowed: false,
    });
  });
});
