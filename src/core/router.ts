import { getFeatureFlags } from "../shared/feature-flags";
import type { DisplayMode, ExtensionSettings } from "../shared/settings";
import type { SiteKind } from "./message";

export interface RouteDecision {
  showPanel: boolean;
  showDanmaku: boolean;
  showPopout: boolean;
  /** Danmaku is never used for threaded video comments / 通常コメントでは弾幕不可 */
  danmakuAllowed: boolean;
  /** Official or extension-owned popout is available / 公式または拡張別窓が使える */
  popoutAllowed: boolean;
}

/**
 * Decide which views should mount for the current site + settings.
 * サイトと設定から表示 View を決める。
 */
export function routeDisplay(
  site: SiteKind,
  settings: ExtensionSettings,
): RouteDecision {
  // Threaded YouTube comments: danmaku forbidden; popout uses extension-owned list (ISS-003).
  // 通常コメントは弾幕不可。別窓は拡張自前リスト（ISS-003）。
  const danmakuAllowed = site !== "youtube-comments";
  const popoutAllowed = true;
  const mode: DisplayMode = settings.displayMode;

  if (!settings.enabled) {
    return {
      showPanel: false,
      showDanmaku: false,
      showPopout: false,
      danmakuAllowed,
      popoutAllowed,
    };
  }

  if (mode === "danmaku" && !danmakuAllowed) {
    return {
      showPanel: true,
      showDanmaku: false,
      showPopout: false,
      danmakuAllowed,
      popoutAllowed,
    };
  }

  if (mode === "popout" && !popoutAllowed) {
    return {
      showPanel: true,
      showDanmaku: false,
      showPopout: false,
      danmakuAllowed,
      popoutAllowed,
    };
  }

  const canPopout = getFeatureFlags().popoutWindowApi;
  // canPopout is true in content (background owns windows). Panel fills in when
  // the site forbids popout (e.g. youtube-comments) or flags say otherwise.
  // content では canPopout は true（windows は background）。サイトが別窓不可のとき等はパネル。
  const showPopout = mode === "popout" && canPopout && popoutAllowed;
  const showPanel =
    mode === "panel" || (mode === "popout" && (!canPopout || !popoutAllowed));
  const showDanmakuPrimary = mode === "danmaku" && danmakuAllowed;
  const showDanmakuOverlay =
    danmakuAllowed &&
    settings.danmakuOverlayOnPanel &&
    settings.danmaku.enabled &&
    mode === "panel";

  return {
    showPanel,
    showPopout,
    showDanmaku: showDanmakuPrimary || showDanmakuOverlay,
    danmakuAllowed,
    popoutAllowed,
  };
}
