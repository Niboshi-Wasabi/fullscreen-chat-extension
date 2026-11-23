import { getFeatureFlags } from "../shared/feature-flags";
import type { DisplayMode, ExtensionSettings } from "../shared/settings";

export interface RouteDecision {
  showPanel: boolean;
  showDanmaku: boolean;
  showPopout: boolean;
}

/**
 * Decide which views should mount for the current settings. Every supported
 * site allows every mode, so the site does not change the decision.
 * 設定から表示 View を決める。対応サイトではすべての表示モードを選べる。
 */
export function routeDisplay(settings: ExtensionSettings): RouteDecision {
  const mode: DisplayMode = settings.displayMode;

  if (!settings.enabled) {
    return {
      showPanel: false,
      showDanmaku: false,
      showPopout: false,
    };
  }

  const canPopout = getFeatureFlags().popoutWindowApi;
  // canPopout is true in content (background owns windows). Panel fills in when
  // flags report windows unavailable.
  // content では canPopout は true（windows は background）。利用不可時のみパネル。
  const showPopout = mode === "popout" && canPopout;
  const showPanel = mode === "panel" || (mode === "popout" && !canPopout);
  const showDanmakuPrimary = mode === "danmaku";
  const showDanmakuOverlay =
    settings.danmakuOverlayOnPanel &&
    settings.danmaku.enabled &&
    mode === "panel";

  return {
    showPanel,
    showPopout,
    showDanmaku: showDanmakuPrimary || showDanmakuOverlay,
  };
}
