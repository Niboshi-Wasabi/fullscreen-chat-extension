/**
 * Runtime capability flags — especially Chromium vs Firefox deltas.
 * 実行時の機能フラグ。Chromium と Firefox の機能差を扱う。
 *
 * Never touch `browser.windows` here — this module is imported by content scripts,
 * where the windows API is undefined and property access throws.
 * ここから browser.windows に触れない。content では windows が undefined で、
 * プロパティアクセスが例外になる。
 */

export interface FeatureFlags {
  /** Popout via background `windows.create` (content never calls it directly)
   * background 経由の別窓（content からは直接呼ばない） */
  popoutWindowApi: boolean;
  /** session storage for managed popout recovery / セッションストレージから管理対象の別窓を復元 */
  sessionStorage: boolean;
  /** Document Picture-in-Picture for always-on-top chat / 常時前面向け Document PiP */
  documentPip: boolean;
}

export function getFeatureFlags(): FeatureFlags {
  const hasDocumentPip =
    typeof (globalThis as { documentPictureInPicture?: unknown })
      .documentPictureInPicture !== "undefined";
  let hasSessionStorage = false;
  try {
    hasSessionStorage = Boolean(
      typeof browser !== "undefined" && browser.storage?.session,
    );
  } catch {
    hasSessionStorage = false;
  }
  return {
    // Content opens popouts through background messaging; assume available.
    // Ceiling: if background lacks windows, open fails at the message handler.
    // 別窓の操作は background へメッセージで要求する。background で windows API を利用できない場合は、受信側で失敗する。
    popoutWindowApi: true,
    sessionStorage: hasSessionStorage,
    documentPip: hasDocumentPip,
  };
}
