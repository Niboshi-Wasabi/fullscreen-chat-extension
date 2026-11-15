# 実サイト煙テスト記録（2026-11-15）

状態: **読取のみの自動化。公開・ストア承認の代替ではない。**  
関連: [content-patterns / ISS-020](content-patterns-2026-11-15.md)、[チェックリスト](site-verification-checklist-2026-11-15.md)。

## 環境

| 項目 | 値 |
|---|---|
| OS | Windows |
| ブラウザ | 署名済み Chrome 157.0.8103.52（Playwright persistent + `Extensions.loadUnpacked`） |
| 拡張 | `.output/chrome-mv3`（同日 `pnpm.cmd build`） |
| スクリプト | `.harness-artifacts/real-site/smoke.mjs` + `smoke-vod.mjs` |
| 設定 | `enabled`、panel、`useNativeChat:false`、compose OFF、第三者エモート OFF |
| 証跡 | `.harness-artifacts/real-site/results.json` と各 PNG |

## 実行 2 — ISS-020 向け（2026-11-15 18:13–18:15 JST）

| ケース | 最終 URL | パネル | トグル | 行数 | 判定 | メモ |
|---|---|---|---|---:|---|---|
| YouTube ライブ | `watch?v=DxgDeW-gIcU` | あり | あり | 0 | ⚠️ | 公式側「チャットをご利用いただけません／ブラウザが古い」。自動化 Chrome では受信不可。オーバーレイ起動のみ |
| YouTube 通常コメント | `watch?v=jNQXAC9IVRw` | あり | あり | 21 | ✅ | YC-1 相当 |
| YouTube シーク | `watch?v=aqz-KE-bpKQ` | あり | あり | 21 | ⚠️ | seek 約 3→35s 成功。チャットリプレイ無し（通常コメント）。YA 同期は未検証 |
| Twitch ライブ | `twitch.tv/fps_shaka` | あり | あり | 7 | ✅ | TL-1/TL-2 相当（読取）。公式チャット面あり |
| Twitch VOD | `twitch.tv/videos/2929424809` | あり | あり | 100 | ✅ | TV-1 相当。seek 約 11→59s。公式 VOD 行 56。同期ズレ秒は未計測 |

ディレクトリ `/directory/all/videos/all` はリダイレクトで VOD カード無し → チャンネル `.../videos?filter=archives` から取得（フォローアップ）。

## 未実施（チェックリスト残・ISS-020 必須含む）

- YT: 待機室、Super Chat 表示、メンバー限定、チャットリプレイ付きアーカイブ＋シーク同期、別窓、全画面／シアター、NG、入力
- Twitch: チャット閉、別窓、エモート ON、Cheer／レイド表示、Highlights 明示、オフセット設定、全画面／シアター
- 横断: 実 IME、Firefox 実サイト、Document PiP、実投稿

## 実行 1 — 参考（同日昼・ニコ生含む旧版）

| ケース | 行数 | 判定 |
|---|---:|---|
| YouTube ライブ | 0 | ⚠️ 起動のみ |
| YouTube 通常コメント | 21 | ✅ |
| YouTube シーク | 22 | ⚠️ seek のみ |
| ニコ生 | 0 | N/A（ISS-018 後は対象外） |

## 解釈

- Twitch ライブ／VOD の **パネル起動＋行受信** は本自動化で初めて確認。
- YouTube ライブ受信は、このヘッドレス／CDP Chrome 経路では公式チャット拒否がブロッカー。手動の通常 Chrome／Firefox での再確認が必要。
- 合成 E2E 成功や本煙テスト合格を、ストア公開や「完全対応済み」に読み替えない。
