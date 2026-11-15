/**
 * Runtime capability flags — especially Chromium vs Firefox deltas.
 * 実行時の機能フラグ。Chromium / Firefox 差分を明示する。
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
  /** session storage for managed popout recovery / 別窓管理の session 復元 */
  sessionStorage: boolean;
  /** Document Picture-in-Picture for always-on-top chat / 常時前面向け Document PiP */
  documentPip: boolean;
}

export function getFeatureFlags(): FeatureFlags {
  const hasDocumentPip =
    typeof (globalThis as { documentPictureInPicture?: unknown })
      .documentPictureInPicture !== "undefined";
  return {
    // Content opens popouts through background messaging; assume available.
    // Ceiling: if background lacks windows, open fails at the message handler.
    // 別窓は background メッセージ経由。上限: background に windows が無ければ送信先で失敗。
    popoutWindowApi: true,
    sessionStorage: Boolean(browser.storage?.session),
    documentPip: hasDocumentPip,
  };
}
