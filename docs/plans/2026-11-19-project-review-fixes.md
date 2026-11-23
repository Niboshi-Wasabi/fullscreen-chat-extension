# プロジェクト全体レビュー指摘の段階的修正計画

状態: 進行中（2026-11-19 オーナー承認済み「段階的に修正して下さい」）。

## 目的・背景

2026-11-19 のプロジェクト全体ソースコードレビューで確認された Critical 0 / Major 14 / Minor 12 / Nit 6 について、破壊や退行を防ぐため 4 段階に分けて修正・回帰テスト追加・検証を行う。

## 対象範囲・対象外

- 対象: レビューで根拠を確認したコード、テスト、ハーネス、文書（[prd.md](../prd.md)・[settings-inventory.md](../settings-inventory.md)・[code-principles.md](../quality/code-principles.md) に準拠）。
- 対象外: 仕様の新設・権限拡張・ストア公開操作・コミット／push（明示許可なしでは行わない）。

## 段階と進捗

| Stage | 主対象 | 対象指摘 | 状態 |
|---|---|---|---|
| Stage 1 | 別窓・PiP ライフサイクル競合 & ページ欄監視（`background.ts`, `site-runtime.ts`, `popout/index.ts`, 結合テスト） | M1–M5, Minor 1–3・5 | 完了（`verify` 127件通過） |
| Stage 2 | 弾幕・パネル・PiP・Options 表示/性能/a11y（`danmaku`, `overlay-panel`, `pip-chat`, `player-chrome`, `options`） | M6, M7, M12, Minor 4・9 | 完了（`verify` 128件通過） |
| Stage 3 | 受信信頼境界・厳格判定・アダプタ・NG・エモート（`content.ts`, `youtube-chat-bridge.ts`, `youtube-page.ts`, `site-ids.ts`, `twitch`, `youtube-live`, `native-compose*`, `filter.ts`, `settings.ts`） | M8–M11, Minor 6–8・10–11 | 完了（`verify` 130件通過） |
| Stage 4 | ハーネス・文書・テスト網羅補完（`README.md`, `docs/`, `scripts/`, `tests/`） | M13, M14, Minor 11–12 | 完了（`verify`・`verify:security`・`test:e2e:chrome` で検証） |

## 追加再レビュー R1–R4（2026-11-19）

[ソース独立レビュー](../quality/source-independent-review-2026-11-19.md)の4件を修正前のコードで再確認し、オーナー依頼「再レビューを行った後、修正してください」に基づき対応する。

- R1/R2: 公式Twitch NGの本文は既存 `extractMessageContent` で全断片・絵文字名を取得し、作者loginもフィルタへ渡す。production拡張の合成公式チャットでNGと解除を検証する。
- R3: PiPの拒否通知をruntimeへ結線し、同じURLでは自前一覧を保持する。候補URLが変わったら再試行する。controller単体とruntime結合で検証する。
- R4: PiPが開いている間だけ設定を購読し、入力欄と表示上限・ロケールを更新する。遅い初期読み込みみによる上書きと、閉じた後の購読残留を防ぐ。
- 対象: `native-chat-ng.ts`、`site-runtime.ts`、`pip-chat/index.ts` と関連テスト。製品権限・依存・保存形式の変更はない。
- 本作業はレビュー担当が修正担当へ移行したもので、修正後の検証は自己確認。新たな独立レビューと実サイト確認は別途必要。
- 状態: 実装・自己確認済み。統合verifyは13段階・136テスト成功、Chrome合成E2Eは35/35件成功。失敗履歴を含む検証結果はレビュー記録へ追記済み。修正後の独立レビュー・実サイト確認は待ち。

## 独立レビュー指摘の追加修正（2026-11-19）

独立レビューで挙がった Major 3・Minor 3・Nit 2 を、オーナー依頼に基づき修正した（本作業はレビューから修正へ移行した自己確認であり、新たな独立再レビューは別途必要）。

- Major 1: `twitch/index.ts`・`twitch-runtime.ts`・`site-runtime.ts`・`page-chat-column.ts` で、公式パネルのみ表示中は折りたたみ自動復旧を抑止し、一時開閉中も `isTwitchChatColumnOpen()` が誤って公式パネルを破棄しないよう協調制御した。
- Major 2: `native-chat-ng.ts` の YouTube 経路に `extractMessageContent` と共通の `readYouTubeAuthorRole`（`youtube-page.ts`）を適用し、絵文字 `alt` の NG・絵文字のみ行の非誤爆・`#author-name[type]` ロール保護をアダプタと揃えた。
- Major 3: `site-runtime.ts` の `publish()` 毎メッセージ時の `panel.applySettings` / `reparentForFullscreen` 呼び出しを除き、`overlay-panel/index.ts` も表層・行書式や URL・ロケールが変わらない限り `renderSurface()` を再実行しないよう整理した。
- Minor 4: `twitch-emotes.ts` の `mergeFfz` / `mergeSevenTv` が `Promise<boolean>` を返すようにし、BTTV 失敗時も FFZ / 7TV 結果をキャッシュするようにした。
- Minor 5: `options/main.ts`・`chrome.css` で自動保存失敗時にインポート失敗文言を流用せず保存失敗メッセージと `data-state="error"` を出し、正常保存・消去時に `data-state` を解除するようにした（多言語キー新設・`locale-fallbacks.json` 追加は未実施）。
- Minor 6: `player-chrome/index.ts` と `native-chat-ng.ts` にリビジョン比較を入れ、遅着した初期 `loadSettings()` が最新の `watchSettings()` 通知を上書きしないようにした。
- Nit 1 / 2: `site-runtime.ts` で PiP 失敗かつ OS 別窓先なし時のパネル復帰、`real-site-run.mjs` の `finalizeRealSiteRun` に対する `runId` 単一パス検証を追加した（Nit 3 の `request.focus === false` は既存結合契約維持のため据え置き）。
- 残課題: 本修正に対する別セッションの独立再レビュー、実サイト・Firefox 実機確認、`verify:security` 再確認、および下記未決定事項のオーナー判断。

## 未決定・別判断待ち事項（継続）

- `scripts/locale-catalogs/`（`rows.json` 79列 vs 現行100キー）と `build-all-locales.mjs` / `generate-locales.mjs`: 更新するか廃止・削除するかはオーナー判断待ち（無断削除禁止のため本作業では未削除）。
- `wxt.config.ts` のサードパーティエモートホスト権限（常時 `host_permissions` か任意 `optional_host_permissions` か、および `*://` を `https://` 限定にするか）は権限変更に該当するため、変更する場合は別途承認・設定一覧同期が必要。

## 検証方法・完了条件

- 各 Stage ごとに `pnpm.cmd verify` を通し、関連するユニット／結合テストと `pnpm.cmd test:e2e:chrome` で退行がないことを確認する。
- 全 Stage 完了後に `pnpm.cmd verify`・`pnpm.cmd verify:security`・`pnpm.cmd test:e2e:chrome` の結果を記録し、別セッションでの独立レビューおよび実サイト・Firefox 手動確認を待つ。
