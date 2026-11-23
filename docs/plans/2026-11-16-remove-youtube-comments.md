# 2026-11-16 YouTube 通常動画コメント機能の廃止計画

状態: 承認済みスコープ変更に基づき実装・文書同期中。

## 目的・背景

2026-11-16 のオーナー指示に基づき、YouTube 通常動画（スレッド型コメント・Shorts を含む通常視聴ページ）への対応を廃止し、対応対象を **YouTube（ライブ／プレミア／チャットリプレイ付きアーカイブ）** および **Twitch（ライブ／VOD）** に統一する。

## 対象範囲・対象外

- 対象:
  - 凍結 PRD（[prd.md](../prd.md)）・[設定一覧](../settings-inventory.md)・[アーキテクチャ](../architecture/overview.md)・[問題台帳](../quality/issues.md)（ISS-027 新設、ISS-003 / ISS-021 / ISS-026 クローズ）・パターン／実サイトチェックリスト／リリース／ブラウザ検証／掲載文の更新
  - 通常 YT コメント専用実装の削除: `src/adapters/youtube-comments/`、`src/app/youtube-comments-runtime.ts`、`src/app/youtube-comments-portal.ts`、`src/entrypoints/popout-chat/`
  - 関連配線の整理: `src/core/message.ts`（`SiteKind`）、`src/adapters/types.ts`、`src/core/router.ts`、`src/shared/youtube-page.ts`、`src/shared/dom-ids.ts`、`src/shared/settings.ts` / `settings-validation.ts` / `settings-backup.ts`、`src/shared/runtime-messages.ts`、`src/entrypoints/background.ts`、`src/entrypoints/content.ts`、`src/app/site-runtime.ts`、`src/views/pip-chat/index.ts`（`portal` モード除去）、`src/views/overlay-panel/index.ts`（コメントポータル・返信 UI 除去）、popup / options / サイトアイコン / 44 言語ロケールカタログ
  - 既存の回帰テスト・E2E フィクスチャを YouTube ライブベースへ移行し、通常動画／Shorts で起動・トグル表示しない回帰テストを追加
- 対象外:
  - `youtube-live` の厳格ライブ判定の緩和（通常動画誤起動を防ぐため、`isYouTubeWatchWithLiveChat` の厳格判定は維持）
  - 既存の `storage.local` 読み込み互換（`cleanSettingsPatch` により未知化した旧 `youtubeComments` キーは読み込み時に安全に無視される）
  - コミット・push・ストア提出・実サイト手動検証

## 変更対象・依存関係

- `src/entrypoints/content.ts`: `startYouTubeRuntimeForPage` を `live | null` に単純化し、ライブ／リプレイ時のみ `startYouTubeLiveRuntime` と `startPlayerChrome("youtube")` を起動する（通常動画ではトグル・パネルとも非表示）。
- `src/app/site-runtime.ts` / `src/entrypoints/background.ts` / `src/shared/runtime-messages.ts`: 拡張自前別窓 `popout-chat` 向けの中継（`EXTENSION_CHAT_*`）とコメントポータル制御を削除。`windows` 権限による公式別窓管理およびフォーカス時コマンド転送はライブ／Twitch 向けに維持する。
- `src/views/pip-chat/index.ts`: `portal` モードを除去し、Document PiP は `popout.alwaysOnTop` 用の `list` モードのみとする。
- `src/shared/settings.ts` / `settings-validation.ts` / `settings-backup.ts`: `youtubeComments` スキーマを削除。既定保存値の読み込み時は `cleanSettingsPatch` で無視される。

## 設計・判断・承認

- 2026-11-16 質問確認にて、オーナーより次を承認済み:
  1. 対応範囲は YouTube（ライブ・プレミア・チャットリプレイ付きアーカイブ）と Twitch（ライブ・VOD）のみとし、YouTube 通常動画・Shorts では非動作とする。
  2. 凍結 PRD の改訂・問題台帳（ISS-003 / ISS-021 / ISS-026）・設定一覧等の同期と、実装削除・回帰検証まで進める（コミットはしない）。
- 削除方式は [ISS-018](../quality/issues.md#iss-018)（ニコ生削除）と同型とし、不要モジュール・UI・翻訳キー・ポータル／拡張別窓コードを削除して保守負債を残さない。

## リスク

- `tests/e2e/extension.spec.ts` と `tests/e2e/review-regressions.spec.ts` が従来 `tests/fixtures/youtube-comments.html` を共通 E2E フィクスチャとして利用していたため、`tests/fixtures/youtube-live.html` へ差し替えてライブ系の実拡張経路（パネル・NG・全画面・SPA・BFCache・サイト別トグル）を途切れさせない必要がある。
- ライブ判定緩和による誤起動を防ぐため、`isYouTubeWatchWithLiveChat()` の単体テストおよび通常動画／Shorts でパネル・トグルが出ない E2E 検証が必須。

## 検証方法・完了条件

- `pnpm.cmd verify`（全 13 段階: docs / locales / format / lint / types / vitest / architecture / chrome-build / firefox-build / manifests）通過
- `pnpm.cmd check:secrets` 通過
- `pnpm.cmd test:e2e:chrome`（YouTube ライブ E2E + 通常動画非起動テスト + Twitch 回帰）通過
- 残課題: 別セッションでの独立レビュー、`pnpm.cmd check:audit`、`pnpm.cmd test:e2e`（ISS-012）、実サイト・Firefox 手動確認

## 進捗・検証証跡

- 2026-11-16: オーナー承認取得後、計画作成および廃止実装・文書更新に着手。

## 未解決・次の作業

- 本変更に対する独立レビュー
- 実サイト（YT ライブ／アーカイブ、Twitch ライブ／VOD、通常動画での非起動）および Firefox での確認
