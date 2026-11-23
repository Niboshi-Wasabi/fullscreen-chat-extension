# 競合実機評価 — 記録

状態: **実施済み（2026-11-14）**  
親文書: [competitive-evaluation.md](./competitive-evaluation.md)  
評価方式: 実機インストールでの体感。調査スコアとズレた軸は親文書を「実機反映」注記付きで更新する。

---

## 環境

| 項目 | 値 |
|------|-----|
| 実施日 | 2026-11-14 |
| 主ブラウザ | Google Chrome **157.0.8103.52**（評価用分離プロファイル） |
| 副ブラウザ | Firefox 差分は未実施（時間優先。YLCFS / Flusher / Yochatto はストア併載を調査段階で確認済み） |
| デュアルモニタ | **あり（3 画面）** Primary 1920×1080 / 縦 1080×1920 / 下 1536×960 |
| プロファイル | `.tmp-extensions/chrome-profile-cdp`（CDP `Extensions.loadUnpacked` で必試6を読み込み） |
| 制約 | 公式 Chrome は `--load-extension` 不可のため CDP 読込。`document.fullscreenElement` は必要なユーザー操作を自動化できなかった → 真のプレーヤー全画面パスは制限付き |

### テスト用コンテンツ（URL）

| 種別 | URL / メモ |
|------|------------|
| YT ライブ | `https://www.youtube.com/watch?v=DxgDeW-gIcU`（チャットあり） |
| YT アーカイブ（チャットリプレイ） | 検索から安定 URL を得られず **本セッション未実施** |
| 通常 YT（コメント多め） | `https://www.youtube.com/watch?v=dQw4w9WgXcQ`（コメント約 246 万） |
| Twitch ライブ | `https://www.twitch.tv/rainbow6jp`（R6 Osaka Major、高密度チャット） |
| Twitch VOD | 本セッション未実施（ライブ優先） |

---

## 統一シナリオ合否マトリクス

凡例: `pass` / `fail` / `partial` / `n/a` / `skip`（理由付き）

| シナリオ | YLCFS | Flusher | Stream Danmaku | Yochatto | Live Chat Popout | Comment Viewer |
|----------|-------|---------|----------------|----------|------------------|----------------|
| YT ライブ: 全画面で読む | partial | partial | pass | n/a | skip | n/a |
| YT ライブ: 投稿 | skip | n/a | n/a | n/a | skip | n/a |
| YT アーカイブ: シーク追従 | skip | skip | skip | n/a | skip | n/a |
| 通常 YT: 全画面スレッド | n/a | n/a | n/a | n/a | n/a | partial |
| Twitch ライブ: 全画面で読む | n/a | n/a | pass | pass | skip | n/a |
| Twitch ライブ: 投稿 | n/a | n/a | n/a | partial | skip | n/a |
| Twitch VOD: シーク追従 | n/a | n/a | skip | skip | skip | n/a |
| 別窓: 位置記憶 / デュアル | n/a | n/a | n/a | pass | pass | n/a |
| 高密度時の視認・負荷 | n/a | skip | pass | pass | n/a | n/a |

補足:

- **partial（YLCFS）**: ポップアップ／設定は確認。プレーヤー全画面＋ shadow ホスト（`shadow-root-live-chat`）は自動化で FS 不可のため未観測。ネイティブチャット借用設計はバンドル上確認。
- **partial（Flusher）**: オプションで Banned Words・タイムシフト・非依存モードを確認。当該ライブ DOM 上に弾幕レイヤは未観測（SDO 同居の可能性）。
- **partial（Comment Viewer）**: content script／ポップアップ確認。オーバーレイ容器は未出現（トグル／初回表示条件の追い込み不足）。
- **partial（Yochatto 投稿）**: チャット入力欄は存在。未ログインのため実送信は未実施。
- **pass（LCP 別窓）**: `Alt+Shift+C`・`storage` による bounds 記憶をコード確認。YT/Twitch の公式 popout URL がチャットを表示することを確認。3 モニタ環境あり。ウィンドウを跨モニタでドラッグする操作は未実施（制限付き pass）。
- **skip（投稿系）**: 評価プロファイル未ログイン。

---

## 必試ごとの記録

### 1. YouTube Live Chat Fullscreen

- 拡張版: **2.3.18**
- 手元確認:
  - [x] ライブ全画面で読む — **partial**（設定 UI 確認。真の FS オーバーレイは自動化制限で未観測）
  - [ ] 投稿・絵文字 — **skip**（未ログイン＋ FS 未達）
  - [ ] アーカイブシーク — **skip**
  - [ ] SPA遷移後の安定性 — **skip**
- 合否メモ: ポップアップでテーマ／バックアップ／55 言語を確認。コード上は WXT＋ shadow（`shadow-root-live-chat`）＋ネイティブ chat iframe 借用。
- 自分が困るか: FS 前提の完成度はストア説明どおり高そうだが、本セッションでは体感スコアを動かせるほど観測できず。
- 調査スコアからの修正案: **なし**（実機 FS 未達のため据え置き）

### 2. YouTube LiveChat Flusher

- 拡張版: **0.16.7**
- 手元確認:
  - [ ] 弾幕密度・衝突 — **partial**（オプション上の密度・行数は確認、ライブ描画は未観測）
  - [x] Banned Words — **pass**（オプション「翻訳 NG リスト」＋正規表現トグル）
  - [ ] アーカイブ time-shift — **partial**（オプションにタイムシフト項目あり、実シーク未実施）
- 合否メモ: 独立モード／依存モード切替が明示。弾幕レイヤが当該タブで見えず、SDO との同居影響を疑う。
- 自分が困るか: 設定の豊かさは十分。実ライブでの「すぐ弾幕が出る」体験は今回取れず。
- 調査スコアからの修正案: **なし**（機能存在は確認、体感 D 軸を下げる根拠は不十分）

### 3. Stream Danmaku Overlay

- 拡張版: **1.0.3**
- 手元確認:
  - [x] YT / Twitch 両方 — **pass**（YT に隠し iframe、Twitch に積み上げオーバーレイで実メッセージ表示）
  - [x] チャット閉時も流れるか — **partial / Twitch fail 寄り**（YT は `left: -9999px` 隠し iframe を確認。Twitch でチャット欄コラプス後、オーバーレイ件数 0）
  - [ ] アーカイブ同期ズレ — **skip**
- 合否メモ: ポップアップで ON、積み上げ／横スクロール、位置左右を確認。Twitch 高密度時もスタック表示が追従。クリック透過前提で投稿不可は仕様どおり。
- 自分が困るか: **Twitch でチャットを閉じると表示が止まった**体験は、要件書の「閉じても継続」期待とズレる（少なくとも Twitch 経路）。
- 調査スコアからの修正案: **S 4→3**（サイト差で受信継続が崩れる）、メモを親文書に反映

### 4. Yochatto

- 拡張版: **0.7.1**
- 手元確認:
  - [x] Fullscreen chat — **pass**（設定に Fullscreen chat。ページ上に resize／float／settings ボタン）
  - [x] Floating always-on-top — **pass**（`.yochatto-float-btn` クリック成功。設定に Floating）
  - [x] フィルタ／ハイライト — **pass**（設定: Hide messages / Highlights / Lurk mode 等）
- 合否メモ: 「Own width on each screen」あり → マルチモニタ幅記憶が製品機能として存在。Twitch UX ベンチマークとして調査評価を支持。
- 自分が困るか: YT が無いこと以外、Twitch 単体では「欲しい操作が揃っている」。
- 調査スコアからの修正案: **なし**（調査スコアを支持）

### 5. Live Chat Popout

- 拡張版: **1.2.1**
- 手元確認:
  - [x] デュアルモニタ配置 — **pass（制限付き）**（3 画面環境。実ドラッグ未実施。画面別運用は Yochatto 側機能と合わせて妥当）
  - [x] 位置記憶 — **pass**（`storage`＋`chatWindowSettings`。再オープン時に bounds 再利用する実装）
- 合否メモ: `Alt+Shift+C`。YT / Twitch / Kick の chat URL 生成。公式 popout URL でチャット表示を確認。
- 自分が困るか: 別窓 MVP の参照として十分。オーバーレイ／弾幕はない。
- 調査スコアからの修正案: **なし**

### 6. Youtube Comment Viewer

- 拡張版: **1.0.7**
- 手元確認:
  - [ ] フルスクリーンでスクロール・返信 — **partial / fail 寄り**（オーバーレイ未出現）
  - [ ] 人気／新しい順 — **skip**（オーバーレイ未出現。ネイティブコメント欄は存在）
  - [ ] 続きを読み込む — **skip**
- 合否メモ: content script・「初回から表示」フラグ設計をコード確認。本セッションでは UI が出ず、再現手順の追加が必要。
- 自分が困るか: 通常コメント全画面は依然ギャップ。この拡張に依存しきれない。
- 調査スコアからの修正案: **なし**（未再現のため C 特化スコアは触らない）

---

## 任意（時間があれば）

| 拡張 | 実施 | メモ |
|------|------|------|
| Danmaku Flow | skip | 時間優先 |
| DanMage | skip | 時間優先 |
| Anu Twitch Chat Overlay | skip | Yochatto で Twitch UX を充足 |
| Twitch Chat Danmaku | skip | SDO で Twitch 弾幕／スタックを確認 |

---

## ギャップトップ10 — 実機後レビュー

| # | 実機後の体験（困ること） | 調査版から | 入替理由 |
|---|--------------------------|------------|----------|
| 1 | YT と Twitch で拡張が分断 | 維持 | 実機でも単一拡張で両サイト＋投稿は不在 |
| 2 | 読む／書くモードが同居しない | 維持 | SDO は読む専用、Yochatto／YLCFS は書く側に寄る |
| 3 | 通常 YT コメントが統合されない | 維持 | Comment Viewer も本セッションで overlay 未再現 |
| 4 | NG がモード横断でない | 維持 | Flusher NG と Yochatto Hide が製品横断しない |
| 5 | 別窓とオーバーレイの切替が面倒 | 維持 | LCP とオーバーレイ系が別拡張 |
| 6 | チャット閉時の受信と投稿パネルの両立 | **強化（維持＋具体化）** | SDO は YT 隠し iframe あり／**Twitch ではコラプス後 0 件**を観測 |
| 7 | アーカイブ同期の説明不能 | 維持 | 本セッションでアーカイブ未実施のため据え置き |
| 8 | Firefox / Chromium 機能差 | 維持 | 本セッションは Chrome のみ |
| 9 | 高密度時の間引きとロール優先 | 維持 | Twitch 高密度は Yochatto／SDO で耐えたがロール優先は別問題 |
| 10 | プライバシー＋OSS＋ストアの両立 | 維持 | 実機でも「全部入り OSS」は不在 |

**結論:** トップ10の番号入替はなし。#6 を実機具体例で強化し、親文書に追記。

---

## PRD / build-or-fork ゲート

| 確認 | 結果 |
|------|------|
| PRD 受け入れ・非スコープと矛盾するか | **なし**（実機は調査結論を支持。アーカイブ／FS 投稿は未観測だが要件を覆す反証なし） |
| 自前判定を覆す材料（全体 fork には戻さない） | **なし**。SDO（MIT）の隠し iframe／Adapter 分割は引き続き限定参考。Twitch チャット閉時の弱さは自前で直す動機 |
| 実装プランへ進んでよいか | **可** |

---

## 改訂履歴

| 日付 | 内容 |
|------|------|
| 2026-11-14 | テンプレ作成 |
| 2026-11-14 | 必試6を CDP 読込で実機記録。ギャップ #6 を具体化。実装ゲート通過 |
