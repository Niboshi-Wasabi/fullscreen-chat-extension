import { describe, expect, it } from "vitest";
import { routeDisplay } from "../../src/core/router";
import type { DisplayMode } from "../../src/shared/settings";
import { settings } from "../helpers";

const modes: DisplayMode[] = ["panel", "popout", "danmaku"];

describe("display routing", () => {
  it("unmounts every display when disabled", () => {
    for (const mode of modes) {
      const current = settings();
      current.enabled = false;
      current.displayMode = mode;
      current.danmaku.enabled = true;
      current.danmakuOverlayOnPanel = true;
      expect(routeDisplay(current)).toEqual({
        showPanel: false,
        showDanmaku: false,
        showPopout: false,
      });
    }
  });

  it("requires both overlay toggles for danmaku alongside the panel", () => {
    const current = settings();
    current.danmakuOverlayOnPanel = true;
    expect(routeDisplay(current).showDanmaku).toBe(false);
    current.danmaku.enabled = true;
    expect(routeDisplay(current)).toEqual({
      showPanel: true,
      showDanmaku: true,
      showPopout: false,
    });
  });

  it("routes popout and danmaku modes", () => {
    const current = settings();
    current.displayMode = "popout";
    expect(routeDisplay(current)).toEqual({
      showPanel: false,
      showPopout: true,
      showDanmaku: false,
    });

    current.displayMode = "danmaku";
    expect(routeDisplay(current)).toEqual({
      showPanel: false,
      showPopout: false,
      showDanmaku: true,
    });
  });
});
