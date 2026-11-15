# ストア掲載文（Chrome / Firefox）

状態: ニコ生削除後・提出準備（2026-11-15）  
プライバシー本文: [`public/privacy.html`](../public/privacy.html)（拡張同梱。ストアの Privacy policy URL にも使う）  
アイコン: [`public/icon/`](../public/icon/)（16 / 32 / 48 / 128 + `icon.svg`）  
Firefox ID: `fullscreen-chat-extension@niboshi.dev`

Chrome 短い説明上限 ≈ 132 文字、詳細 ≈ 16 000。Firefox も同程度で問題ない長さに揃えてある。

---

## 短い説明（EN）— manifest / store short

Read and write YouTube / Twitch chat in fullscreen without losing the video.

（132 文字以内。`wxt.config.ts` の `manifest.description` と同一。）

## 短い説明（JA）

YouTube / Twitch のチャットを、全画面のまま読んで書けます。

---

## 詳細（EN）

Fullscreen Chat keeps YouTube and Twitch chat usable while the video is fullscreen.

**Modes**

- Overlay panel (official chat embed when possible, or a compact list)
- Official chat popout window
- Danmaku for live chat (not for regular YouTube comments)

**Sites**

- YouTube Live, chat replay sync, and regular watch-page comments
- Twitch Live and VOD

**Controls**

- Toolbar popup: enable, display mode, site toggles, UI language (40+ locales)
- Options page: panel / danmaku / popout / NG filters / archive sync
- In-player toggle and panel gear for quick opacity / font size
- Shortcuts: Alt+Shift+C (toggle), M (mode), D (danmaku), P (popout)

**Privacy**

- Settings and filters stay in local browser storage
- No developer analytics SDK
- No account required

**Disclaimer:** Unofficial. Not affiliated with YouTube or Twitch. Danmaku is for personal / community non-commercial use and is not intended to infringe patents. Site DOM changes may break features.

## 詳細（JA）

Fullscreen Chat は、動画を全画面にしたまま YouTube / Twitch のチャットを読み書きしやすくします。

**表示**

- オーバーレイパネル（可能な場合は公式チャット埋め込み、またはコンパクトなリスト）
- 公式チャットの別窓
- ライブ向け弾幕（YouTube 通常コメントでは無効）

**対応**

- YouTube ライブ、チャットリプレイ同期、通常コメント
- Twitch ライブ / VOD

**操作**

- ツールバーポップアップ: 有効、表示モード、サイト、UI 言語（40 言語以上）
- オプション: パネル／弾幕／別窓／NG／アーカイブ同期
- プレイヤー内トグルとパネルギア（不透明度・フォント）
- ショートカット: Alt+Shift+C（表示）、M（モード）、D（弾幕）、P（別窓）

**プライバシー**

- 設定とフィルタは端末の `storage.local` のみ
- 開発者向け解析 SDK なし
- アカウント不要

**免責:** 非公式です。YouTube・Twitch とは提携していません。弾幕は個人／コミュニティの非営利利用を想定し、特許侵害の意図はありません。サイトの DOM 変更で機能が壊れることがあります。

---

## 権限の説明（審査用）

| 権限 | 理由 |
|------|------|
| `storage` | 設定・NG・別窓位置の端末内保存 |
| `windows` | 公式チャット別窓の作成・フォーカス |
| host YouTube / Twitch | 対象ページへの content script 注入のみ |
| host BTTV / FFZ / 7TV | Twitch 第三者エモートカタログ取得（任意・オフ可） |

Firefox `browser_specific_settings.gecko.data_collection_permissions.required`: `["none"]`（開発者サーバへの送信なし）。

---

## 提出チェックリスト

アップロード自体は人手。成果物は `pnpm zip` / `pnpm zip:firefox`。

### 共通

- [ ] バージョン番号を確認（`package.json`）
- [ ] `pnpm compile` / `pnpm build` / `pnpm build:firefox` が通る
- [ ] zip を生成し、展開してアイコン・privacy.html・権限を目視
- [ ] 短い説明・詳細が本ファイルと一致
- [ ] 権限表と manifest が一致（ニコ生ホストが残っていないこと）

### Chrome Web Store

- [ ] 単一目的・権限理由を審査メモに貼れるよう上表を用意

### Firefox AMO

- [ ] gecko id / `data_collection_permissions` / strict_min_version を確認
