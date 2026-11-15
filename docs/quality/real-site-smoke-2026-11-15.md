# 実サイト煙テスト記録（2026-11-15）

状態: **読取のみの自動化。公開・ストア承認の代替ではない。**

## 環境

| 項目 | 値 |
|---|---|
| OS | Windows |
| ブラウザ | 署名済み Chrome 157.0.8103.52（Playwright persistent + `Extensions.loadUnpacked`） |
| 拡張 | `.output/chrome-mv3`（同日 build） |
| スクリプト | `.harness-artifacts/real-site/smoke.mjs` |
| 設定 | `enabled`、panel、`useNativeChat:false`、compose OFF、第三者エモート OFF |

## 結果

| ケース | 最終 URL | パネル | トグル | 行数 | 判定 |
|---|---|---|---|---:|---|
| YouTube ライブ | `watch?v=DxgDeW-gIcU` | あり | あり | 0 | ⚠️ 起動のみ。ライブ受信未確認 |
| YouTube 通常コメント | `watch?v=jNQXAC9IVRw`（Me at the zoo） | あり | あり | 21 | ✅ パネル一覧 |
| YouTube シーク | `watch?v=aqz-KE-bpKQ`（Big Buck Bunny） | あり | あり | 22 | ⚠️ seek 到達のみ。リプレイ同期未検証 |
| ニコ生 | `lv351013640` | あり | あり | 0 | ⚠️ 起動のみ。コメント取込未確認 |

## 未実施（チェックリスト残）

NG、入力／IME、別窓、全画面、タイムシフト同期、Document PiP、Firefox 実サイト、実投稿。

仕様決定（ISS-001/002/003/005）は同日反映済み。本煙テストはその後の観測。
