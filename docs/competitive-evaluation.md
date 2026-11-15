# 競合評価メモ

最終更新: 2026-11-14（実機反映あり）  
評価方式: **調査評価＋実機**（詳細は [competitive-evaluation-hands-on.md](./competitive-evaluation-hands-on.md)）

目的: 全画面視聴中にコメントを読む・書く・ノイズを減らす体験で、既存拡張の強みと不足を洗い出す。

---

## 1. 評価の軸

各項目 1–5（5が最良）。未対応は 1、部分対応は 2–3、実用十分は 4–5。

| ID | 軸 |
|----|-----|
| V | 全画面での視認性（占有面積 vs 読みやすさ） |
| P | 投稿のしやすさ |
| F | NG / フィルタの実用度 |
| D | 弾幕の品質 |
| W | 別窓の安定性 |
| A | アーカイブ同期 |
| C | 通常動画コメント対応 |
| X | YT + Twitch 横断の一貫性 |
| B | Firefox 対応の実態 |
| S | 壊れにくさ（公開情報上の設計成熟度） |
| R | プライバシー / 権限の安心感 |
| M | メンテ活性（更新・OSS・Issue） |

---

## 2. 必試セット — 調査スコアカード

### 2.1 YouTube Live Chat Fullscreen

- Store / Repo: [Chrome](https://chromewebstore.google.com/detail/youtube-live-chat-fullscr/dlnjcbkmomenmieechnmgglgcljhoepd) / [GitHub](https://github.com/daichan132/Youtube-Live-Chat-Fullscreen)
- ライセンス: **GPL-3.0**
- 対応: YouTube ライブ・アーカイブ（チャットリプレイ）。Chrome / Firefox。ネイティブチャット流用で投稿可。
- 非対応: Twitch、弾幕、通常動画コメント、別窓特化

| V | P | F | D | W | A | C | X | B | S | R | M | 合計 |
|---|---|---|---|---|---|---|---|---|---|---|---|------|
| 5 | 5 | 2 | 1 | 2 | 5 | 1 | 1 | 5 | 5 | 5 | 5 | 42 |

強み: 全画面パネル＋投稿の完成度、WXT＋Firefox、プライバシー最小権限。  
弱み: YT専用。弾幕なし。GPL のため本製品全体への取り込みは方針に直結。

手元確認欄:

- [x] ライブ全画面で読む — partial（設定 UI 確認。自動化では FS オーバーレイ未観測）
- [ ] 投稿・絵文字 — skip（未ログイン）
- [ ] アーカイブシーク — skip
- [ ] SPA遷移後の安定性 — skip
- 体感メモ: 実機詳細は hands-on。調査スコア据え置き。

---

### 2.2 YouTube LiveChat Flusher (Danmaku)

- Store / Repo: [Chrome](https://chromewebstore.google.com/detail/youtube-livechat-flusher/kkjglcpgfpjlaloboikfcoofameeljbe) / [Firefox](https://addons.mozilla.org/firefox/addon/youtube-livechat-flusher/) / [GitHub](https://github.com/ys-j/YoutubeLiveChatFlusher)
- 対応: YouTube 弾幕、Banned Words、タイムシフト、翻訳、PiP（β）。Chrome / Firefox。
- 非対応: Twitch、投稿UI主眼ではない、通常コメント、統合パネル投稿

| V | P | F | D | W | A | C | X | B | S | R | M | 合計 |
|---|---|---|---|---|---|---|---|---|---|---|---|------|
| 4 | 2 | 4 | 5 | 2 | 4 | 1 | 1 | 5 | 4 | 4 | 5 | 41 |

強み: 弾幕品質とフィルタ、Firefox 実ストア、独立モード。  
弱み: YT専用。投稿・別窓・通常コメントは本構想の中心ではない。

手元確認欄:

- [x] 弾幕密度・衝突 — partial（オプション確認、ライブ描画未観測）
- [x] Banned Words — pass（翻訳 NG＋正規表現）
- [x] アーカイブ time-shift — partial（オプション確認、実シーク未実施）
- 体感メモ: 調査スコア据え置き。

---

### 2.3 Stream Danmaku Overlay

- Store / Repo: [Chrome](https://chromewebstore.google.com/detail/stream-danmaku-overlay/feliadlnmmipcapeilfdckllibhjppna) / [GitHub](https://github.com/egachan3/Stream-danmaku-overlay)
- ライセンス: **MIT**
- 対応: YouTube Live + Twitch、積み上げ／弾幕、アーカイブ・VOD、全画面・シアター。DOM監視のみ。
- 明示非対応（REQUIREMENTS.md）: 通常動画コメント、投稿、ポップアウト前提外、Firefox ストア未確認

| V | P | F | D | W | A | C | X | B | S | R | M | 合計 |
|---|---|---|---|---|---|---|---|---|---|---|---|------|
| 4 | 1 | 1 | 4 | 1 | 4 | 1 | 5 | 2 | 3 | 5 | 4 | 35 |

強み: 構想の表示コアに最も近い（YT+Twitch・2スタイル・アーカイブ）。MIT・要件書が詳細（隠し iframe、再生同期 postMessage 等）。  
弱み: 投稿・NG・別窓・通常コメント・Firefox 公開が不足。クリック透過固定で入力不可。

手元確認欄:

- [x] YT / Twitch 両方 — pass（積み上げで実メッセージ確認）
- [x] チャット閉時も流れるか — **partial**（YT 隠し iframe あり／Twitch コラプス後 0 件）
- [ ] アーカイブ同期ズレ — skip（本セッション未実施）
- 体感メモ: 実機反映で **S 4→3**（サイト差で受信継続が崩れる）。詳細は hands-on 記録。

---

### 2.4 Danmaku Flow for YouTube

- Store: [Chrome](https://chromewebstore.google.com/detail/danmaku-flow-for-youtube/enfiknigldbijeoafkmnncphbgmhnnje)
- 対応: YT 弾幕カスタム、プレイヤー内トグル。比較的新しい小規模拡張。

| V | P | F | D | W | A | C | X | B | S | R | M | 合計 |
|---|---|---|---|---|---|---|---|---|---|---|---|------|
| 3 | 1 | 2 | 3 | 1 | 2 | 1 | 1 | 1 | 2 | 3 | 3 | 23 |

手元確認欄: （任意）弾幕の完成度比較用

---

### 2.5 DanMage

- Store / Repo: [Chrome](https://chromewebstore.google.com/detail/danmage-flow-chat-on-yout/elhaopojedichjdgkglifmijgkeclalm) / GitHub (teststaybaka/danmage)
- 対応: YouTube / Twitch / Crunchyroll 弾幕。ユーザー数は多めだが更新が古い傾向。

| V | P | F | D | W | A | C | X | B | S | R | M | 合計 |
|---|---|---|---|---|---|---|---|---|---|---|---|------|
| 3 | 1 | 2 | 3 | 1 | 2 | 1 | 4 | 2 | 2 | 3 | 2 | 26 |

手元確認欄: （任意）旧世代横断弾幕の参考

---

### 2.6 Yochatto

- Site: [yochatto.com](https://www.yochatto.com/)
- 対応: Twitch 特化。全画面チャット、フローティング常時前面窓、リサイズ、テーマ、BTTV/FFZ/7TV、キーワード系、Chrome / Edge / Firefox。
- 非対応: YouTube。OSS ではない（仕様参考のみ）。

| V | P | F | D | W | A | C | X | B | S | R | M | 合計 |
|---|---|---|---|---|---|---|---|---|---|---|---|------|
| 5 | 5 | 4 | 1 | 5 | 3 | 1 | 1 | 5 | 4 | 5 | 4 | 43 |

強み: Twitch の「全画面＋別窓＋書く＋フィルタ」体験のベンチマーク。  
弱み: YT 横断不可。コード流用不可。

手元確認欄:

- [x] Fullscreen chat — pass
- [x] Floating always-on-top — pass（float ボタン動作）
- [x] フィルタ／ハイライト — pass（Hide / Highlights / Lurk）
- 体感メモ: 調査スコアを支持。マルチモニタ幅記憶あり。

---

### 2.7 Anu Twitch Chat Overlay / Twitch comment chat overlay

- 代表: [Anu](https://chromewebstore.google.com/detail/anu-twitch-chat-overlay/lfifccadmdnjffbbocnfmibmgddndbag)
- 対応: Twitch 全画面オーバーレイ、送信、ポイント自動回収、VOD、位置カスタム。

| V | P | F | D | W | A | C | X | B | S | R | M | 合計 |
|---|---|---|---|---|---|---|---|---|---|---|---|------|
| 4 | 5 | 2 | 1 | 2 | 4 | 1 | 1 | 2 | 3 | 3 | 3 | 31 |

手元確認欄:

- [ ] 全画面から送信
- [ ] VOD
- 体感メモ:

---

### 2.8 Twitch Chat Danmaku

- Store / Repo: [Chrome](https://chromewebstore.google.com/detail/twitch-chat-danmaku/koiphfkghjgmncbkcpfnegnbcbomlchg) / [GitHub](https://github.com/wheatup/TwitchChatDanmaku)
- 対応: Twitch 弾幕／スクロール、regex フィルタ、絵文字。Firefox は過去対応で現状要確認。

| V | P | F | D | W | A | C | X | B | S | R | M | 合計 |
|---|---|---|---|---|---|---|---|---|---|---|---|------|
| 3 | 1 | 3 | 4 | 1 | 2 | 1 | 1 | 2 | 2 | 3 | 2 | 25 |

手元確認欄: （任意）Twitch 弾幕の密度感

---

### 2.9 Live Chat Popout

- Store: [Chrome](https://chromewebstore.google.com/detail/live-chat-popout/ffigipdicjcdaplbmfncfkgkgkmkafed)
- 対応: YT / Twitch / Kick のチャット別窓、位置記憶、ショートカット。

| V | P | F | D | W | A | C | X | B | S | R | M | 合計 |
|---|---|---|---|---|---|---|---|---|---|---|---|------|
| 2 | 4 | 1 | 1 | 4 | 2 | 1 | 4 | 1 | 3 | 4 | 3 | 30 |

強み: 別窓 MVP の参考。マルチストリーム。  
弱み: オーバーレイ／弾幕／通常コメントなし。

手元確認欄:

- [x] デュアルモニタ配置 — pass（制限付き・3 画面環境／実ドラッグ未実施）
- [x] 位置記憶 — pass（storage bounds）
- 体感メモ: Alt+Shift+C。調査スコア据え置き。

---

### 2.10 通常動画コメント系（追加調査）

構想の差別化領域。ライブチャット拡張とは別市場。

| 拡張 | 概要 | C | P | 全画面 | メモ |
|------|------|---|---|--------|------|
| [Youtube Comment Viewer](https://chromewebstore.google.com/detail/youtube-comment-viewer/dbkfbnelkejobnjchbcebhhjeaengldp) | 全画面等でコメント欄オーバーレイ、投稿時ショートカット干渉対策あり | 5 | 4 | あり | **必試**。ライブ横断はなし |
| Youtube Show Comments Overlay | プレイヤーボタンでコメントオーバーレイ | 4 | 2 | あり | 小規模 |
| CommentStream for Youtube | タイムスタンプ同期のライブ風表示 | 3 | 1 | オーバーレイ | 「スレッド全量」とは別体験 |
| Right Side Comments | サイドバー配置、フルスクリーンコメント連携 | 4 | 3 | 部分 | レイアウト変更系 |

手元確認欄（Comment Viewer 必須）:

- [ ] フルスクリーンでスクロール・返信 — partial（オーバーレイ未再現）
- [ ] 人気／新しい順 — skip
- [ ] 続きを読み込む — skip
- 体感メモ: 通常コメント全画面ギャップは継続。

---

## 3. 横断サマリー

| 拡張 | 合計 | YT Live | Twitch | 通常コメント | 投稿 | 弾幕 | 別窓 | FF |
|------|------|---------|--------|--------------|------|------|------|-----|
| Yochatto | 43 | - | ○ | - | ○ | - | ○ | ○ |
| YT Live Chat Fullscreen | 42 | ○ | - | - | ○ | - | △ | ○ |
| LiveChat Flusher | 41 | ○ | - | - | △ | ○ | △ | ○ |
| Stream Danmaku Overlay | 35 | ○ | ○ | - | - | ○ | - | △ |
| Anu / Twitch overlay | 31 | - | ○ | - | ○ | - | △ | △ |
| Live Chat Popout | 30 | ○ | ○ | - | ○* | - | ○ | △ |
| Comment Viewer | (C特化) | - | - | ○ | ○ | - | △ | △ |

\* 別窓内のネイティブ UI 経由

**結論（調査時点）:** 「横断 × 3表示 × 投稿/NG × 通常コメント × 両ストア」を一人で満たす製品は不在。機能は分断されている。

---

## 4. 自分にとって足りない体験 — トップ10

調査と構想ギャップから、要件の一次ソースとする（実機後に順位入替可）。

1. **一つの拡張で YT と Twitch の全画面コメント体験が揃わない**（サイトをまたぐたびに拡張を切り替える）
2. **読むモード（弾幕／薄パネル）と書くモード（入力付きパネル／別窓）が同一製品に共存しない**
3. **通常 YT スレッドコメントを全画面で扱い、かつライブ／Twitch と同じ操作感にできない**
4. **NGワード／ユーザー除外が、表示モード（パネル・弾幕・別窓）を横断して効かない**
5. **別ウィンドウ運用（デュアルモニタ）と単一モニタ・オーバーレイを設定一発で切り替えられない**
6. **ネイティブチャットを閉じても弾幕／受信が止まらない設計が、投稿可能パネルと両立していない**（実機: SDO は YT で隠し iframe を確認したが、Twitch でチャットコラプス後オーバーレイが 0 件になった）
7. **アーカイブ／VOD のシーク同期品質が拡張ごとにバラつき、期待値を一文で説明できない**
8. **Firefox と Chromium で同じ機能セットがストア配布されていない**（片方のみ・一時アドオンのみが多い）
9. **スパム密度時に「間引きつつ重要コメント（メンバー／モデ／自分宛）は残す」制御が弱い**
10. **プライバシー最小・OSS・ストア公開の三点を満たしつつ、上記を統合したメンテ可能な設計がない**

実機後の更新ルール: シナリオ不合格を優先してトップ10を差し替える。機能の「ある／なし」より「自分が困るか」を上位にする。

実機後（2026-11-14）: **番号入替なし**。#6 を上記具体例で強化。詳細は [competitive-evaluation-hands-on.md](./competitive-evaluation-hands-on.md)。

---

## 5. 統一シナリオ（実機チェックリスト）

各サイト（YT ライブ、YT アーカイブ、通常 YT、Twitch ライブ、Twitch VOD）で:

1. ブラウザ全画面／プレイヤー全画面でコメントを読む
2. オーバーレイまたは同等 UI から投稿する
3. アーカイブ／VOD でシークし追従を確認する
4. 通常 YT で全画面＋スレッド閲覧（無ければ「未充足」）
5. デュアルモニタで別窓運用する
6. 高密度チャット時の視認性・負荷を体感する

結果は本ファイルの「手元確認欄」と、必要なら `docs/competitive-evaluation-hands-on.md` に追記する。

---

## 6. 参考リンク（OSS・要件）

- [Stream Danmaku Overlay REQUIREMENTS.md](https://github.com/egachan3/Stream-danmaku-overlay/blob/main/REQUIREMENTS.md) — 隠し iframe、再生同期、通常コメント対象外の明記
- [Youtube-Live-Chat-Fullscreen](https://github.com/daichan132/Youtube-Live-Chat-Fullscreen) — ネイティブチャット流用、WXT、Firefox
- [YoutubeLiveChatFlusher](https://github.com/ys-j/YoutubeLiveChatFlusher) — 弾幕・Banned Words
- [Yochatto](https://www.yochatto.com/) — Twitch UX ベンチマーク（非 OSS）
