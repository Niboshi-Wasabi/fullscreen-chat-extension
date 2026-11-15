# 仕様不整合の決定案（ISS-001 / ISS-002 / ISS-003）

状態: **2026-11-15 オーナー指示「進めて」により案 A を採用し、PRD・設定一覧・台帳へ反映済み。**  
作成: 2026-11-15。根拠は現行実装・文書の突合。

---

## ISS-001 — 必要な通信先・権限

### 現状の食い違い

| 正本候補 | 記述 |
|---|---|
| [PRD §7](../prd.md) | ストア審査向けホストは `youtube.com` / `twitch.tv` に限定 |
| [wxt.config.ts](../../wxt.config.ts) / [manifest-baseline](manifest-baseline.json) | 上記に加え `live.nicovideo.jp` / `live2` / `mpn.live.nicovideo.jp`（NDGR）と BTTV/FFZ/7TV の API・CDN |
| [settings-inventory §3](../settings-inventory.md) | 最小権限方針。増やす場合は PRD／本ファイルへ理由を残す |

実装上の実通信:

- ニコ生ページ注入・視聴タブ: `live.nicovideo.jp` / `live2.nicovideo.jp`
- NDGR コメントサーバ: `mpn.live.nicovideo.jp`（`ndgr.ts`）
- Twitch 第三者エモート: `api/cdn.betterttv.net`、`api/cdn.frankerfacez.com`、`7tv.io` / `cdn.7tv.app`（設定 `twitch.thirdPartyEmotes`、既定 ON）
- 権限 API: `storage`（設定）、`windows`（別窓）

### 選択肢

| 案 | 内容 | 影響 |
|---|---|---|
| **A（推奨）** | PRD §7 を「視聴ホスト + 機能に必要な明示ホスト」へ改訂。ニコ生・NDGR・エモート CDN を「必須／条件付き」表で正本化。プライバシー・掲載文も同表に揃える | 現行機能を維持。ストア説明でホスト理由を書ける |
| B | 権限を PRD 文言どおり YT/Twitch のみに縮小 | ニコ生・NDGR・第三者エモートを削除または別拡張化。Post-MVP ではない現行機能の後退 |
| C | 第三者エモートだけ任意権限（optional_host_permissions）化し、ニコ生は必須のまま | 実装・Firefox optional 差分・UI が増える。公開前工数大 |

### 推奨 A の正本案（承認後に文書へ反映）

**必須ホスト**

- `youtube.com` / `www.youtube.com` — 視聴・ライブチャット・通常コメント
- `twitch.tv` / `www.twitch.tv` — 視聴・チャット
- `live.nicovideo.jp` / `live2.nicovideo.jp` — ニコ生視聴・DOM／別窓中継
- `mpn.live.nicovideo.jp` — NDGR コメント受信（ライブ／タイムシフト）

**条件付きホスト（機能トグル連動・既定 ON でも「第三者」と明記）**

- BTTV / FFZ / 7TV の API・CDN — `twitch.thirdPartyEmotes === true` のときのみ fetch。OFF 時は要求しない（実装が既にトグル依存なら文書で保証、未保証なら実装追従）

**使わないもの（維持）**: `<all_urls>`、リモートコード実行、開発者サーバへの送信前提の権限。

承認チェック: [ ] オーナー選択（A/B/C）　[ ] PRD・inventory・privacy・store-listing を同日更新　[ ] manifest-baseline を「承認後の正本」として再記録

---

## ISS-002 — 公式チャットへの NG 範囲

### 現状の食い違い

| 箇所 | 記述 / 挙動 |
|---|---|
| settings-inventory **§1.2** | 公式パネル表示中、NG は弾幕／自前リスト経路。**公式 iframe 内はサイト側のまま**（フィルタは Post-MVP で別検討） |
| settings-inventory **§1.5** | `filter.applyToNativeChat` 既定 `true` — **公式 iframe／Twitch embed 内でも NG を隠す** |
| 実装 `native-chat-ng.ts` | YouTube ライブ iframe・Twitch 公式チャットで行を `display:none`。サイトは `youtube-live` / `twitch` のみ（ニコ生公式 DOM は対象外） |

### 選択肢

| 案 | 内容 | 影響 |
|---|---|---|
| **A（推奨）** | **§1.5 を正本**にする。§1.2 の「公式 iframe は対象外」を削除し、「`applyToNativeChat` が true のとき公式埋め込み行も隠す。false でサイト表示のまま」と書く。対象サイトは YT ライブ iframe・Twitch（公式別窓ページ含む）。ニコ生は自前 View／拡張別窓のみ（現行どおり） | 実装・既定・回帰と一致。利用者期待も「NG はどこでも」に近い |
| B | §1.2 を正本にし、`applyToNativeChat` を既定 false または削除 | 公式側に NG 語が残り続ける。実装縮小と受け入れ変更 |
| C | 公式埋め込みは常時適用、トグル廃止 | 設定 UI 単純化。OFF したい利用者を失う |

### 推奨 A の受け入れ文案

1. `applyToNativeChat === true` のとき、公式 YT ライブチャット iframe と Twitch チャット（埋め込み／公式 popout 相当ページ）で NG／ブロックユーザー／コマンド行が非表示になる。
2. `false` のとき公式 DOM は触らず、自前パネル／弾幕／拡張別窓のみフィルタする。
3. モデ／オーナー保護（`protectRoles`）は公式経路でも共有する。
4. ニコ生の公式コメント欄への DOM NG は対象外（自前経路のみ）。将来拡張する場合は別 ISS。

承認チェック: [ ] オーナー選択　[ ] inventory §1.2/1.5 整合　[ ] 回帰・実サイト確認の正解をこの文に合わせる

---

## ISS-003 — 通常 YouTube コメントの別窓

### 現状の食い違い

| 箇所 | 記述 / 挙動 |
|---|---|
| PRD §6 / 受け入れ 4・6 | 全画面でスレッドを**オーバーレイまたは別窓**。別窓でチャット**またはコメント**を表示 |
| `router.ts` | `youtube-comments` は `popoutAllowed === false`（パネルのみ。弾幕も不可） |
| 実装 | 通常コメント用の拡張別窓・公式コメント別窓パスは未配線 |

弾幕禁止は両正本で一致（変更しない）。

### 選択肢

| 案 | 内容 | 影響 |
|---|---|---|
| **A（推奨・公開スコープ）** | **MVP 公開はパネル必須・別窓は Post-MVP**。PRD §6/§9 を「オーバーレイ（パネル）必須。別窓は将来」に改訂。受け入れ 4 はライブ／Twitch／ニコ生の別窓で満たす | 実装追加なしで公開判定可能。デュアルモニタの通常コメント利用者は後回し |
| B | 公開前に通常コメント別窓を実装（拡張 `windows` 別窓＋スレッド UI 複製または公式ページ転送） | 工数大。返信・並び・続き読みの別窓契約が必要。回帰・実機必須 |
| C | 公式のコメント別窓 URL があればそれを開き、無ければパネルのみ（ハイブリッド） | YouTube 側 URL／ログイン制約の調査が前提。無い場合は A に戻る |

### 推奨 A の受け入れ差し替え案

- §6: 「全画面時にスレッド一覧をオーバーレイ表示（別窓は Post-MVP）」
- §9-4: 「ライブ系（YT/Twitch/ニコ生）で別窓表示と位置記憶」
- §9-6: 「通常 YT 動画全画面でスレッド閲覧・投稿（パネル）。別窓は対象外」

承認チェック: [ ] オーナー選択（A/B/C）　[ ] 選んだ案で PRD・release マトリクス・ISS-003 を更新　[ ] B なら実装計画を別途起票

---

## まとめ（オーナー向け）

| ID | 推奨 | 公開前に必要なこと |
|---|---|---|
| ISS-001 | A: PRD を現行ホスト表に合わせて改訂 | 文書＋プライバシー／掲載の照合。コード変更は原則不要 |
| ISS-002 | A: applyToNativeChat を正本化 | inventory 文言修正。実装は現行維持 |
| ISS-003 | A: 通常コメント別窓を Post-MVP に明示 | PRD／受け入れ改訂。router の禁止は仕様として残す |

このファイルへのチェック記入や「Aで進め」等の明示指示があるまで、製品コード・PRD の確定変更は行わない。
