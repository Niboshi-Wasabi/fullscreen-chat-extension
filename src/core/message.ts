/**
 * Normalized chat/comment message shared across adapters and views.
 * Adapter と View が共有する正規化メッセージ。
 */

export type SiteKind = "youtube-live" | "twitch";

export type MessageRole =
  "viewer" | "member" | "moderator" | "owner" | "bot" | "unknown";

/** Rich text run for danmaku / emoji rendering / 弾幕・絵文字用の断片 */
export type MessageSegment =
  { type: "text"; text: string } | { type: "emoji"; src: string; alt: string };

export interface NormalizedMessage {
  id: string;
  site: SiteKind;
  authorName: string;
  /** Optional canonical login suffix (e.g. "login" alongside localized display name).
   * 表示名と別表記のログイン名（括弧付き表示用）。 */
  authorLogin?: string;
  /** Safe CSS author color (#hex / rgb) when provided by host DOM.
   * サイト側の投稿者名カラー（安全な hex / rgb のみ）。 */
  authorColor?: string;
  /** Channel / user id when available / 取得できる場合のチャンネル・ユーザー ID */
  authorId?: string;
  text: string;
  /** Ordered text/emoji runs; falls back to `text` when absent.
   * テキスト／絵文字の並び。無いときは `text` にフォールバック。 */
  segments?: MessageSegment[];
  /** True when the signed-in user sent this line / 自分の投稿 */
  isSelf?: boolean;
  /** Seconds from VOD/archive start when this line belongs on the timeline.
   * アーカイブ／VOD 上でこの行が表示されるべき秒位置。 */
  videoOffsetSec?: number;
  timestampMs: number;
  role: MessageRole;
  badges: string[];
  /** Badge images when available (self-rendered panel; ISS-024).
   * 取得できたバッジ画像（自前パネル表示用）。 */
  badgeIcons?: { src: string; alt: string }[];
  /** True when message looks like !command / `!` コマンドらしいとき */
  isCommand: boolean;
  raw?: unknown;
}

export function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function looksLikeCommand(text: string): boolean {
  return /^\s*![^\s]/.test(text);
}

/** Flatten segments to plain text (emoji → alt) / 断片をプレーンテキストにまとめる。絵文字には alt を使う */
export function segmentsToPlainText(segments: MessageSegment[]): string {
  return segments
    .map((segment) => {
      if (segment.type === "text") {
        return segment.text;
      }
      return segment.alt ? `:${segment.alt}:` : "✦";
    })
    .join("")
    .trim();
}
