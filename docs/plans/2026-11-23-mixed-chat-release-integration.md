# 混合チャットのリリース統合計画

状態: **通常別窓ヘッダーレイアウト修正・自動検証通過（2026-11-23）。差分凍結・再レビューおよび両ブラウザ実機確認待ち。**

## 目的・背景

YouTubeライブとTwitchライブを同じブラウザで開き、どちらの視聴タブにも両方のチャットを表示し、投稿元が分かるようにする。この試作を公開準備側の変更と合わせて評価する。

## 対象範囲・対象外

- 各視聴タブで相手サイトのライブを1つ選択する。取り込む側のチャットに0〜120秒の追加遅延を設定し、接続時は0秒から始める。両サイトの投稿は混合画面で読み取り専用とする。
- 表示先はパネル、弾幕、通常別窓、Document PiP。Document PiPはブラウザの能力判定と通常別窓へのフォールバックも確認する。場面記録とチャット行の選択から補正候補を作り、利用者が確認して適用する。
- 複数の取り込み元の同時選択、自動で場面を特定する同期、録画・通常動画へのブリッジは対象外。オーナー承認により [PRD](../prd.md)（ISS-034）・権限・プライバシー・掲載文へ反映済み。

## 変更対象・依存関係

- `site-runtime`、YouTube/Twitchライブの起動処理、`bridge-client`、`bridge-hub`、`bridge-messages`、`live-delay-buffer`、動画時計が、配信元の登録、転送、補正、切断を担う。
- パネル、弾幕、通常別窓の拡張ページ（`bridge-popout.html`）、Document PiPが出所ロゴ表示（YouTube / Twitch SVG）を共有する。メッセージの送受信、投稿可否、ウィンドウを閉じたときの復帰を検証対象とする。
- `storage.session` に別窓管理および混合チャット接続のメタデータ（タブ ID・サイト種別・配信キー・ラベル・購読関係）が入る。チャット本文・投稿者名・視聴者識別子はストレージへ保存しない。公開準備用ビルドでは試作の診断コード（`bridge-diag.ts`・Options 一時 UI・`storage.local` 診断記録・`[fce-diag]`・`ping`）は除外した。[セキュリティ方針](../operations/security.md)

## 設計・判断・承認

- 2026-11-23 オーナー決定（[ISS-034](../quality/issues.md#iss-034)）:
  - パネル・弾幕・通常別窓を初回保証範囲とし、混合 Document PiP は対応ブラウザでのベストエフォート（失敗時は通常別窓へフォールバック）とする。
  - 試作の診断 UI・ログ・`storage.local` 診断記録・`ping` はすべて撤去し、`bridge-client.ts` へ初回登録失敗時の `registeredKey` リセット＋バックオフ再試行（上限 3 回＋`enqueue`/`syncChannel` 回復）を導入して再検証する。
  - 権限は既存の `storage`・`windows` と既存 host 権限のまま変更しない（新規の外部通信先なし）。
  - ストア掲載文（詳細 EN / JA）へ混合チャットを簡潔に追記し、新規 16 キーは `en.json` / `ja.json` 追加＋残り 42 言語は `locale-fallbacks.json` 管理とする。

## 実装手順

1. 公開準備側の作業ファイルを基準に、試作から非診断 29 ファイルを取り込み、`background.ts` へ `bridge-hub` を結線（エージェント運用文書や `obs-native-toggle-counts-only.txt` は持ち込まない）。
2. `bridge-diag.ts`・`ping`・Options 一時診断 UI・診断テストを除去し、`bridge-client.ts` の登録失敗再試行と統合テストを追加する。
3. [PRD](../prd.md)・[設定一覧](../settings-inventory.md)・[契約](../architecture/contracts.md)・[セキュリティ](../operations/security.md)・[Firefox差分](../firefox-deltas.md)・[リリース手順](../operations/release.md)・[掲載資料](../store-listing.md)・[プライバシー説明](../../public/privacy.html)・[問題台帳](../quality/issues.md) を同期する。
4. `verify`・Chrome／Firefox E2E を通過させたリリース候補ビルドを対象に、独立レビューと実機残確認を実施してパッケージ化する。[リリース手順](../operations/release.md)

## リスク

- ワーカーの停止・再起動や配信元のタブ遷移で購読が残らないか、送信元を検証し、停止と切断の回帰を確認する。
- 表示の再描画を新着として数えず、両サイトの新着と、接続・遅延の引き継ぎを観測する。調査ログに本文、表示名、視聴者識別子を残さない。

## 検証方法・完了条件

- 統合コピーで型、単体・統合、Chrome/Firefoxのビルドとmanifestを確認し、Chrome合成E2Eで両方向の混合表示と切断を再確認する。
- 同じリリース候補で、両ブラウザのYouTube視聴側4モードと実シーク後の候補破棄、FirefoxのDocument PiPを確認する。Document PiPの対象範囲は上記の判断を反映する。

## 進捗・検証証跡

- 2026-11-23（プレフライト）。公開準備側の作業ファイルは試作ベース `9e6939f` と対象22ファイルで一致し、試作の新規15ファイルはパス衝突なし。隔離コピーで `node scripts/verify.mjs --browser=chrome` 14項目（Chrome E2E 42件含む）が通過。
- 2026-11-23（本体統合）。オーナー判断（ISS-034）に基づき本体（`fullscreen-chat-extension`）へ混合チャットを取り込み、診断 UI／ログ／`storage.local` 診断／`ping` を撤去したうえで `bridge-client.ts` に登録失敗時バックオフ再試行と回帰テストを追加、PRD・権限・プライバシー・掲載文・設計契約を同期。
- 試作の実機では、Twitch視聴側の両サイト新着をChromeの4モードとFirefoxの通常3モードで確認済み。YouTube視聴側は両ブラウザで接続まで確認済み（再生エラーにより混合表示・実シーク確認を継続中）。
- 2026-11-23（本体の手動確認）。Ludwigの同時配信で、両方向のパネル、YouTube視聴側の通常別窓と前面固定の小窓で両サイトのコメントを確認した。YouTubeでシークすると推定 `+6秒` と適用ボタンが消え、設定は `+8秒` のままだった。ライブ位置に戻って再開した画面で混合表示が復帰し、古い候補は表示されなかった。
- 独立レビューの対象候補は同日15:14のChrome／Firefoxビルド（両方の `content.js` のSHA-256先頭 `E66048D0`）。実装担当のCLI記録では統合検証13項目とChrome合成E2E 41件が通過。実機画面から読み込まれていたビルドのハッシュは特定できていない。
- 2026-11-23（Major 3件修正後の最新候補）。Codex独立レビューのMajor 3件（[1] 切替中A→B購読競合での `B` 誤解除防止、[2] 配信中断・解除・切替時の相手側弾幕DOM/待機タイマー消去と自サイト/遅延保持、[3] Twitch動画広告オーバーレイ検知の中断パイプライン接続）を修正し、`pnpm.cmd verify` 13項目（単体・結合30ファイル/209件、両ビルド）通過。Chrome合成E2E（`pnpm.cmd test:e2e:chrome`）は1回目にフレーム読込競合で `extension.spec.ts` が失敗した後の即時再実行で43件通過、Firefox合成確認（`pnpm.cmd test:e2e:firefox`）は3件通過（`productErrors: 0`）。Chrome／Firefox両ビルド（16:21）の `content-scripts/content.js` SHA-256先頭は `8F6ACFFE`（Chrome `manifest.json` 先頭 `BA8F5164`、Firefox `manifest.json` 先頭 `04066F23`）。
- 2026-11-23（8F6ACFFE再レビュー指摘修正後の最新候補）。再レビューで購読切れと一時停止時の弾幕残留は解消確認済み。追加指摘の Twitch 広告2点（[1] `isAdMarkerVisible` が全祖先要素および Shadow Host の非表示状態と `checkVisibility` を確認するよう拡張、[2] `onResume` で `suspendBridgeIfInterrupted()` を確認し広告等の中断継続中は復帰不可＋遅延保持）を修正。`pnpm.cmd verify` 13項目（単体・結合30ファイル/211件、両ビルド）、`pnpm.cmd test:e2e:chrome`（43件）、`pnpm.cmd test:e2e:firefox`（3件、`productErrors: 0`）をすべて通過。Chrome／Firefox両ビルド（16:43）の `content-scripts/content.js` SHA-256先頭は `C8F944A0`（Chrome `manifest.json` 先頭 `BA8F5164`、Firefox `manifest.json` 先頭 `04066F23`）。
- 2026-11-23（通常別窓ヘッダーレイアウト修正後の最新候補）。`C8F944A0` 実機確認で見つかった長タイトル時横スクロール／遅延見切れを `src/entrypoints/bridge-popout/style.css`（`.fce-bridge-popout` の `grid-template-columns: minmax(0, 1fr)`、`.fce-popout-title-wrap` 縮小・省略、`.fce-popout-badge` / `.fce-popout-delay` 折り返し禁止）と `main.ts`（`title` 属性付与）で修正。最小幅（`280px` / `264px`）かつ `+0s` / `+5s` / `+120s` の合成E2Eを追加し、`pnpm.cmd verify` 13項目（単体・結合30ファイル/211件、両ビルド）通過、`pnpm.cmd test:e2e:chrome` は1回目 `extension.spec.ts:66` の既存フレーム読込タイミング競合（43/44）後の再実行で44件全通過、`pnpm.cmd test:e2e:firefox` は3件通過（`productErrors: 0`）。Chrome／Firefox（18:05）とも `bridge-popout.html` SHA-256先頭 `0A038FB3`・`assets/bridge-popout-BApG2c0s.css` 先頭 `804F30B6`・`chunks/bridge-popout-C2Xv1a_z.js` 先頭 `8A996A17`（`content-scripts/content.js` は未変更のため `C8F944A0` 継続）。

## 未解決・次の作業

- 修正後ビルド（`0A038FB3` / `C8F944A0`、18:05）のCodex独立再レビュー（差分凍結中、ZIP未生成・未コミット）。
- Twitch視聴側の通常別窓実機確認（Chrome／Firefox 両方で、長いYouTube配信タイトル接続時のヘッダー表示、`+0s`/`+5s`/`+120s`、両サイトの新着、閉じた後のパネル復帰）は本セッションにDevTools MCP未接続のため未実施。18:05ビルドを読み込んで確認する。
- **Twitch視聴側の実サイト広告遭遇確認は未確認**（実サイトでの広告待ちは不要とし、隠れた親要素・広告中再開ブロック・終了後遅延維持を合成単体/結合/E2Eで検証済み）。
- 再レビューおよび上記実機確認の通過後に、Chrome／Firefoxの公開用ZIP生成とチェックリスト完了を進める。
