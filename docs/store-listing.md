# ストア掲載文（Chrome / Firefox）

状態: 混合チャット統合後・公開候補（2026-11-23）  
プライバシー本文: [`public/privacy.html`](../public/privacy.html)（拡張同梱。ストアの Privacy policy URL にも使う）  
アイコン: [`public/icon/`](../public/icon/)（16 / 32 / 48 / 128 + `icon.svg`）  
Firefox ID: `fullscreen-chat-extension@niboshi.dev`

原稿は Chrome の短い説明で約 132 文字、詳細で約 16,000 文字を上限の目安としています。Firefox 向けも同程度の長さに収めています。

---

## 短い説明（EN）— manifest / store short

Read and write YouTube / Twitch chat in fullscreen without losing the video.

（132 文字以内。`wxt.config.ts` の `manifest.description` と同一。）

## 短い説明（JA）

YouTube と Twitch の動画を全画面で見ながら、チャットを読んだりコメントを投稿したりできます。

---

## 詳細（EN）

Fullscreen Chat keeps YouTube and Twitch chat usable while the video is fullscreen.

**Modes**

- Overlay panel (official chat embed when possible, or a compact list)
- Official chat popout window (or a read-only mixed-chat popout window when combining two live tabs)
- Danmaku (scrolling comments)

**Mixed live chat (optional)**

- Combine chat from one open YouTube Live tab and one open Twitch Live tab in the same browser, with YouTube / Twitch logos on each message
- Supported in overlay panel, danmaku, and popout window (Document PiP is best-effort where supported, falling back to a regular popout)
- Adjust imported chat delay (0–120s) manually or via scene-mark and reaction selection; mixed views are read-only

**Sites**

- YouTube Live and chat replay sync
- Twitch Live and VOD

**Controls**

- Toolbar popup: enable, display mode, site toggles, UI language (40+ locales)
- Options page: panel / danmaku / popout / NG filters / archive sync
- In-player toggle and panel gear for quick opacity / font size / mixed-chat connection
- Shortcuts: Alt+Shift+C (toggle), M (mode), D (danmaku). The popout command has no default key; assign one in the browser's shortcut settings

**Privacy**

- Settings and filters stay in local browser storage
- Mixed-chat relay runs strictly inside your browser; chat messages are never saved to storage or sent to external servers
- No developer analytics SDK
- No account required

**Disclaimer:** Unofficial. Not affiliated with YouTube or Twitch. Danmaku is for personal / community non-commercial use and is not intended to infringe patents (including Dwango). Site DOM changes may break features.

## 詳細（JA）

Fullscreen Chat では、動画を全画面で見ながら YouTube と Twitch のチャットを表示できます。投稿可能なチャットでは、コメントの送信にも対応します。

**表示**

- 動画に重ねるパネル（対応する配信では公式チャットを表示でき、拡張機能のリストも選べます）
- チャットの別窓（混合表示では読み取り専用）
- 弾幕表示

**混合チャット（任意）**

- 同じブラウザで開いている YouTube ライブと Twitch ライブのチャットを 1 つの画面にまとめます。コメントごとに投稿元のロゴが付きます。
- パネル、弾幕、通常の別窓に対応します。対応環境では Document PiP で開ける場合もあり、開けなければ通常の別窓に切り替わります。
- 取り込んだチャットの追加遅延を 0〜120 秒の範囲で調整できます。場面を記録して対応するコメントを選ぶと、補正値の候補が表示されます。混合チャットでは投稿できません。

**対応**

- YouTube ライブ、チャットリプレイ同期
- Twitch ライブ / VOD

**操作**

- ツールバーのポップアップで、有効状態、表示モード、対象サイト、UI 言語（40 言語以上）を切り替えられます。
- 設定画面で、パネル、弾幕、別窓、NG フィルタ、アーカイブ同期を調整できます。
- プレーヤーのボタンで表示を切り替え、パネルの歯車から不透明度、フォント、混合チャット接続を設定できます。
- `Alt+Shift+C` で表示、`Alt+Shift+M` でモード、`Alt+Shift+D` で弾幕を切り替えます。別窓を開く操作には、ブラウザの設定でショートカットを割り当てられます。初期状態では割り当てられていません。

**プライバシー**

- 設定とフィルタは、端末内の `storage.local` にのみ保存します。
- 混合チャットはブラウザ内でのみ中継します。チャット本文を保存したり、外部サーバーへ送信したりすることはありません。
- 開発者向けの解析 SDK は使いません。
- 拡張機能を使うためのアカウント登録は不要です。

本拡張機能は非公式で、YouTube や Twitch との提携関係はありません。弾幕は個人やコミュニティでの非営利利用を想定しており、株式会社ドワンゴなどの特許権を侵害する意図はありません。サイトのページ構造が変わると、機能が動作しなくなる場合があります。

---

## 権限の説明（審査用）

| 権限 | 理由 |
|------|------|
| `storage` | 設定・NG・別窓位置の端末内保存（`storage.local`）、および別窓管理・混合チャットのタブ接続メタデータのセッション内一時保持（`storage.session`、本文は非保存） |
| `windows` | 公式チャット別窓および混合チャット用拡張別窓（`bridge-popout.html`）の作成・フォーカス |
| host YouTube / Twitch | 対象ページへの content script 注入のみ |
| host BTTV / FFZ / 7TV | Twitch 第三者エモートカタログ取得（任意・無効化可） |

Firefox `browser_specific_settings.gecko.data_collection_permissions.required`: `["none"]`（開発者サーバーへの送信なし）。

---

## 提出チェックリスト

`pnpm zip` と `pnpm zip:firefox` で提出物を作成し、ストアには手動でアップロードします。

### 共通

- [ ] バージョン番号を確認（`package.json`）
- [ ] `pnpm compile` / `pnpm build` / `pnpm build:firefox` が通る
- [ ] zip を生成し、展開してアイコン・privacy.html・権限を目視
- [ ] 短い説明・詳細が本ファイルと一致
- [ ] 権限表と manifest が一致（ニコ生ホストが残っていないこと）

### Chrome Web Store

- [ ] 拡張機能の単一目的と、各権限を使う理由を審査メモに記載できるように準備する

### Firefox AMO

- [ ] gecko id / `data_collection_permissions` / strict_min_version を確認
