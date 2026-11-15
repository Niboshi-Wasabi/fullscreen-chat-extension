# Design references / デザイン参照

| File | Purpose |
|------|---------|
| [popup-site-icons.jpg](./popup-site-icons.jpg) | Popup site rows — brand-tinted silhouettes |
| [player-chrome-toggle.jpg](./player-chrome-toggle.jpg) | In-player master ON/OFF beside seek/progress controls |

Implementation: `src/ui/site-icons.ts`, `src/views/player-chrome/index.ts`.

## Shared design guidance / 共通原則

設定UIの正本は [settings-ui.md](settings-ui.md)。既存Cursorルールの本文を移し、Cursor以外でも参照できるようにしたものです。画像は上記の参照を継続します。

## Bundled icon font / 同梱アイコンフォント

[material-symbols.json](material-symbols.json)に使用中の26グリフ、公式取得URL、SHA-256を記録。実行時は同梱woff2を使い、外部フォント要求を追加しない。ライセンスは [MaterialSymbols-LICENSE.txt](../../public/fonts/MaterialSymbols-LICENSE.txt)。新しいアイコンを追加する場合は同梱グリフを確認し、[ブラウザ検証](../operations/browser-verification.md)で単語表示やはみ出しを確認する。
