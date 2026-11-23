# 2026-11-16 全体コードレビュー指摘のリファクタリング計画

状態: 実装・自己確認実施（独立再レビュー・実サイト確認待ち）。

## 目的・背景

2026-11-16 の全体コードレビューで指摘された Critical 1 件・Major 8 件・Minor 9 件を解消し、ISS-003（通常 YouTube コメント別窓）および ISS-026（公式コメントポータル）を含む主経路の正しさ・セキュリティ境界・仕様整合性を回復する。

## 対象範囲・対象外

- 対象:
  - `popout-chat` ⇔ `background.ts` ⇔ `site-runtime.ts` の双方向のメッセージ中継と元のタブへのひも付け（`ready` / `push` / `send` / `closed`）、送信成否応答（`Promise<boolean>`）
  - `POPOUT_OPEN_TYPE` / `EXTENSION_CHAT_*` の `sender`・許可 URL・payload 検証（ISS-009）
  - アーカイブ／VOD 巻戻しシーク時の弾幕再送フィルタ修正
  - `youtube-comments-portal` の親離脱時復元、`youtube-page.ts` の `live_chat` コンテキスト判定・ライブ UI スコープ限定
  - `router.ts`・`content.ts`（禁止モードスキップ）・`overlay-panel`・`youtube-comments`・`youtube-live`・`twitch-emotes`・`danmaku`・`settings.ts`・`options/main.ts` の安定性・検証・整理、未使用 `protobuf-lite.ts` 削除
  - 正本文書（`overview.md` / `release.md` / `content-patterns-2026-11-15.md` / `issues.md`）の ISS-003 同期と単体／結合／E2E 回帰追加
- 対象外: 権限追加、新規依存追加、実サイト自動操作・ストア提出・未許可の公開操作

## 変更対象・依存関係

- `src/shared/runtime-messages.ts`、`src/entrypoints/background.ts`、`src/entrypoints/popout-chat/main.ts`、`src/app/site-runtime.ts`、`src/entrypoints/content.ts`
- `src/app/youtube-comments-portal.ts`、`src/shared/youtube-page.ts`、`src/core/router.ts`、`src/views/overlay-panel/index.ts`、`src/adapters/youtube-comments/index.ts`、`src/adapters/youtube-live/index.ts`、`src/shared/twitch-emotes.ts`、`src/views/danmaku/index.ts`、`src/shared/settings.ts`、`src/entrypoints/options/main.ts`（および未使用 `src/shared/protobuf-lite.ts` 削除）
- `tests/unit/`、`tests/integration/`、`tests/e2e/review-regressions.spec.ts`

## 設計・判断・承認

- 拡張ページ（`popout-chat.html`）から `browser.runtime.sendMessage` を送ってもタブ内 content script には届かないため、`background.ts` が管理中別窓の元タブ ID（`ownerTabId`）を保持し、`tabs.sendMessage` で双方向中継する設計を採用。
- 複数 YouTube タブ混線を防ぐため、`popout-chat` は `background.ts` 経由（`!sender.tab`）の `PUSH` のみを受理し、`background.ts` は `ownerTabId` からの `PUSH` だけを転送する。
- 新規権限・保存キー・公開面変更はなし。

## リスク

- `background.ts` のサービスワーカー再起動時は `storage.session` 復元値（`ownerTabId` 含む）に依存するため、復元時に URL・`siteKey`・`ownerTabId` 型を検証して不正値を破棄する。
- 実サイト固有の DOM（YouTube ライトテーマ変数・サイドバー構成）は合成テストだけで完全保証されないため、実サイト確認を残課題として維持する。

## 検証方法・完了条件

- `pnpm.cmd verify`（全 13 段階・単体／結合・両ビルド・manifest）通過
- `pnpm.cmd check:secrets` 通過
- `pnpm.cmd test:e2e:chrome`（追加したポータル・`popout-chat` 往復・アダプタ分離含む）通過
- 残課題: `pnpm.cmd check:audit`、独立再レビュー、実サイト／Firefox 手動確認（ISS-003 / ISS-015 / ISS-021〜026）

## 進捗・検証証跡

- 2026-11-16: 実装および回帰テスト追加を実施（本セッションは実装担当の自己確認であり独立レビューではない）。

## 未解決・次の作業

- 別セッションでの独立再レビュー実施
- 実サイト・Firefox での ISS-003 / ISS-021〜026 手動確認および ISS-015 / ISS-025 確認
