import type { NormalizedMessage, SiteKind } from "../core/message";

export interface SiteAdapter {
  readonly site: SiteKind;
  /** Start observing the page / ページ監視を開始 */
  start(onMessage: (message: NormalizedMessage) => void): void;
  /** Stop observers and release resources / 監視停止と資源解放 */
  stop(): void;
  /** Try to send text via native UI / ネイティブ UI 経由で送信を試す */
  sendMessage?(text: string): Promise<boolean>;
}

export const TOP_FRAME_MESSAGE_TYPE = "fce:normalized-message" as const;

export interface TopFrameMessageEnvelope {
  type: typeof TOP_FRAME_MESSAGE_TYPE;
  message: NormalizedMessage;
}
