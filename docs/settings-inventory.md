# 設定・ショートカット・権限・プライバシー — 初版一覧

状態: 初版（2026-11-14）  
対応 PRD: [prd.md](./prd.md)

---

## 1. 設定項目

保存: `browser.storage.local`（Chromium / Firefox 共通 API）。  
キーは論理名。実装時に正式スキーマへ落とす。

### 1.1 グローバル

| キー | 型 | デフォルト | 説明 |
|------|-----|------------|------|
| `enabled` | boolean | `true` | 拡張機能全体の有効／無効 |
| `uiLocale` | `"auto" \| AppLocale`（約 44 言語、`locale-meta.ts`） | `"auto"` | UI 言語。変更 UI は**ポップアップ**（オプションには置かない）。未対応タグは `en` へフォールバック |
| `displayMode` | `"panel" \| "popout" \| "danmaku"` | `"panel"` | 主表示モード |
| `danmakuOverlayOnPanel` | boolean | `false` | パネル使用中に弾幕を重ねるか（ライブ／Twitch のみ） |

### 1.2 オーバーレイパネル

| キー | 型 | デフォルト | 説明 |
|------|-----|------------|------|
| `panel.anchor` | `"left" \| "right"` | `"right"` | 寄せる辺 |
| `panel.widthRatio` | number | `0.22` | 動画幅に対する幅（約 15–40% を UI で制限） |
| `panel.opacity` | number | `0.85` | 背景不透明度 |
| `panel.fontSizePx` | number | `14` | 本文フォントサイズ |
| `panel.showAuthor` | boolean | `true` | 投稿者名表示 |
| `panel.showBadges` | boolean | `true` | バッジ表示 |
| `panel.idleFade` | boolean | `true` | 非ホバー時に薄くする |
| `panel.allowPointer` | boolean | `true` | 入力・スクロールのためポインターを受ける（弾幕専用時は false 可） |
| `panel.useNativeChat` | boolean | `true` | パネル内に公式チャット（YT live_chat / Twitch embed）を表示。オフ時は自前リスト＋転送送信 |
| `panel.position` | `{ x, y, w, h }?` | なし | パネル上端ハンドルでドラッグした自由配置（親要素相対 px）。未設定時は `anchor` 配置 |

公式パネル表示中は絵文字・バッジ・送信 UI はサイト実装に委ねる。自前リスト／弾幕は常に NG フィルタを適用する。公式チャット iframe／Twitch embed（および公式別窓相当ページ）への NG 行隠しは `filter.applyToNativeChat`（既定 `true`）で制御する。false のとき公式 DOM は触らない。

### 1.3 弾幕（ライブチャット系のみ）

| キー | 型 | デフォルト | 説明 |
|------|-----|------------|------|
| `danmaku.enabled` | boolean | `false` | 弾幕表示 |
| `danmaku.speed` | number | 中 | 横断秒数または px/s（実装で一方に固定） |
| `danmaku.opacity` | number | `0.9` | 文字不透明度 |
| `danmaku.fontSizePx` | number | `32` | |
| `danmaku.maxLines` | number | `40` | ソフト上限（実レーン数はプレイヤー高さから動的算出） |
| `danmaku.density` | `"low" \| "mid" \| "high"` | `"high"` | 間引き。`high` は原則全通し（自分の投稿は常に通す） |
| `danmaku.outline` | boolean | `true` | 縁取り |
| `danmaku.showAuthor` | boolean | `false` | 弾幕に名前を付けるか |
| `danmaku.safeZoneBottomRatio` | number | `0.06` | 下部操作 UI を避ける割合（配信画面ほぼ全面） |

通常 YT コメントアダプタでは `danmaku.*` を無視し、UI 上も無効表示する。

### 1.4 別ウィンドウ

| キー | 型 | デフォルト | 説明 |
|------|-----|------------|------|
| `popout.bounds` | `{ left, top, width, height }` | 前回値 | 位置・サイズ記憶（全体フォールバック） |
| `popout.boundsBySite` | `{ youtube?, twitch? }` | なし | サイト別 bounds（`rememberPerSite` 時） |
| `popout.alwaysOnTop` | boolean | `false` | 可なら Document PiP。不可／ジェスチャ不足時は通常別窓。Chrome の OS popup 自体は前面固定不可 |
| `popout.rememberPerSite` | boolean | `true` | サイト別に bounds を分ける |
| `popout.openPolicy` | `"currentLive" \| "anyWatchPage"` | `"currentLive"` | 別窓を開く対象。既定はいま視聴中のライブのみ。`anyWatchPage` は従来どおり watch／チャンネルページでも可 |

### 1.5 フィルタ（全モード横断）

| キー | 型 | デフォルト | 説明 |
|------|-----|------------|------|
| `filter.ngWords` | string[] | `[]` | NG ワード |
| `filter.ngRegex` | boolean | `false` | 行を正規表現として扱う |
| `filter.blockedUsers` | string[] | `[]` | 除外ユーザー |
| `filter.hideCommands` | boolean | `true` | `!` 始まり等を隠す |
| `filter.hideBots` | boolean | `false` | 既知 Bot 名リスト（拡張可能） |
| `filter.protectRoles` | boolean | `true` | モデ／オーナー等を間引きから除外 |
| `filter.maxVisible` | number | `100` | パネル同時表示上限の目安 |
| `filter.applyToNativeChat` | boolean | `true` | 公式チャット iframe／Twitch embed 内でも NG を隠す |

### 1.6 サイト別・同期

| キー | 型 | デフォルト | 説明 |
|------|-----|------------|------|
| `youtubeLive.enabled` | boolean | `true` | |
| `youtubeComments.enabled` | boolean | `true` | 通常コメントアダプタ |
| `youtubeComments.sort` | `"top" \| "newest"` | `"top"` | 公式並び替えメニューを操作 |
| `youtubeComments.autoLoadMore` | boolean | `true` | 「もっと見る／続き」を自動クリック |
| `twitch.enabled` | boolean | `true` | |
| `twitch.thirdPartyEmotes` | boolean | `true` | BTTV / FFZ / 7TV コードを画像断片へ |
| `archive.syncOffsetSec` | number | `0` | チャットリプレイの補正秒 |
| `archive.maxSkewSec` | number | `2` | 受け入れ目安（ドキュメントと共有） |

### 1.7 投稿 UI

| キー | 型 | デフォルト | 説明 |
|------|-----|------------|------|
| `compose.enabled` | boolean | `true` | パネル／別窓で入力欄を出す |
| `compose.stealShortcuts` | boolean | `true` | 入力中はサイトのキーバインドを抑止（スペース等） |

---

## 2. ショートカット（初版）

ブラウザの `commands` と、ページ内ホットキーの併用。衝突時は設定で変更可能にする。

| コマンド ID | デフォルト案 | 動作 |
|-------------|-------------|------|
| `toggle-enabled` | `Alt+Shift+C` | 拡張の表示トグル |
| `cycle-display-mode` | `Alt+Shift+M` | panel → popout → danmaku（不可モードはスキップ） |
| `toggle-danmaku` | `Alt+Shift+D` | 弾幕のみトグル（ライブ系） |
| `open-popout` | `Alt+Shift+P` | 別窓を開く／フォーカス |
| `toggle-compose-focus` | （未割当・ユーザー設定） | 入力欄フォーカス（パネル表示時）。Chrome は suggested_key 最大 4 のためデフォルト無し |

ページ内（フルスクリーン中）:

| キー | 動作 |
|------|------|
| 拡張トグルボタン | プレイヤーコントロール付近に設置（YLCFS / Comment Viewer 踏襲） |

Firefox / Chrome で予約キーが異なる場合は、ストア説明に差分を書く。

---

## 3. 権限（Manifest 初版）

最小権限の方針。実装で増やす場合は理由を PRD／本ファイルに追記する。

### 3.1 必須

| 権限 / フィールド | 用途 |
|-------------------|------|
| `storage` | 設定保存 |
| `windows` | 別窓の作成・フォーカス・bounds 記憶 |
| `content_scripts` matches: YouTube / Twitch | ページ注入 |
| `all_frames`: YouTube ライブチャット iframe 用に true（必要範囲に限定） | チャット iframe 監視 |
| host `*://www.youtube.com/*`, `*://youtube.com/*` | 視聴・ライブ／通常コメント |
| host `*://www.twitch.tv/*`, `*://twitch.tv/*` | 視聴・チャット |

### 3.2 条件付き

| 権限 | 用途 | 取得タイミング |
|------|------|----------------|
| host BTTV / FFZ / 7TV（API・CDN） | Twitch 第三者エモート | `twitch.thirdPartyEmotes === true` のとき fetch（既定 ON。OFF 時は要求しない） |
| `scripting` | SPA 再注入の補助 | 必要になったら追加 |

### 3.3 使わない（MVP）

- 広範な `<all_urls>`
- リモートコード実行
- 開発者サーバへの送信を前提とする権限
- クリップボード常時監視

---

## 4. プライバシー方針（初版ドラフト）

公開用ポリシー文書の骨子。ストア提出前に独立 HTML／Markdown ページ化する。

1. **収集しない**: 視聴履歴、チャット本文、Cookie、アカウント情報を開発者が収集する仕組みは持たない  
2. **端末内のみ**: 設定・NG リストはブラウザの拡張ストレージに保存  
3. **通信**: YouTube / Twitch への既存通信、および（任意）BTTV／FFZ／7TV の公開エモート API／CDN。拡張独自の解析・広告エンドポイントは持たない。


4. **第三者**: フォント等をユーザーが選んだ場合のみ、その配信元へのリクエストが発生しうる（選ばなければ発生しない）  
5. **削除**: 拡張を削除するとブラウザ方針に従いストレージは消える。設定 JSON の export／import は Options → Tools でユーザー操作でのみ  
6. **連絡先**: ストア掲載欄／GitHub Issues（公開時に URL を確定）。草案は [privacy.html](../public/privacy.html)

---

## 5. ストア説明に含める免責（弾幕）

競合慣行に合わせ、日本語・英語で短く明記する。

- 本拡張は非営利の個人／コミュニティ向けソフトウェアである  
- 株式会社ドワンゴの特許権を侵害する意図はない  
- YouTube / Twitch 非公式であり、提携・保証はない  
- サイト DOM 変更により機能が壊れる可能性がある  

---

## 6. 設定 UI 構成（画面一覧）

デザイン方針: [.cursor/rules/settings-ui-design.mdc](../.cursor/rules/settings-ui-design.mdc)（Google Sans Flex / Material Symbols、バンドルフォント）。

| 画面 | 内容 |
|------|------|
| ポップアップ（ツールバー） | 幅 ≈480px・**スクロールなし**。専有: 有効・表示モード・サイト（YT Live／Comments／Twitch）・UI 言語＋オプションへのリンク。即時保存 |
| オプションページ | `open_in_tab: true`。左サイドバー（一般／表示／フィルタ／アーカイブ／法務）。ポップアップ専有項目は置かない。変更は自動保存。一般 → Tools: 設定 JSON の export／import／reset |
| パネル内ギア | ハンドル上のギアから不透明度・フォントサイズを即時変更し、Options へ導線（Phase 8） |
| プレイヤーボタン | YT／Twitch の**右コントロール群**（シーク／プログレス帯の脇）へ製品マーク＋ON/OFF バッジのマスター有効トグル。`enabled: false` でも再有効化可。通常コメントのみのページではプレイヤーが無いため対象外 |
| サイト行アイコン | ポップアップのサイト切替はブランド色シルエット（`src/ui/site-icons.ts`）。公式商標パックは同梱しない |
| i18n 同梱範囲 | **content（パネル／プレイヤーボタン／PiP）**: `en` + `ja` のみ。他言語は英語フォールバック。**popup／options**: 遅延読込で全 `AppLocale` |

---

## 7. 改訂履歴

2026-11-15のレビュー修正では、既存の保存キーとバックアップversion 1を維持した。importは型・列挙・値域・配列・UTF-8 JSONサイズ（1 MiB以下）を保存前に検証し、不正時は既存設定を変更しない。素の設定オブジェクトも受理する。配列は各1000項目、各文字列2000文字以下。詳細は [入力検証の実体](../src/shared/settings-validation.ts) と [契約](architecture/contracts.md) を参照。

入力欄はIME変換中のEnterで送信しない。送信失敗時は下書きを保持してメッセージを表示する。バッジ設定は自前パネルの表示用バッジに適用し、`replyable` / `ndgr` 等の内部マーカーは表示しない。弾幕最大行数、入力欄フォーカスの登録可能コマンド、同じチャンネル内の第三者エモート設定切替を描画・実行経路へ接続した。

| 日付 | 内容 |
|------|------|
| 2026-11-14 | 初版。実装前の論理キー一覧 |
| 2026-11-14 | 設定 UI 実装に合わせて §6 を更新（サイドバー options、バンドルフォント） |
| 2026-11-14 | `uiLocale` 変更 UI をポップアップへ移設（オプションから除外） |
| 2026-11-14 | ポップアップ拡幅（≈400px）と essentials（compose／native／danmaku／density）追加 |
| 2026-11-14 | ポップアップ／options の重複解消。popup は無スクロール essentials のみ |
| 2026-11-14 | `niconicoLive.enabled` 追加（ニコ生パネル初版） |
| 2026-11-14 | Tools（export／import／reset）。`boundsBySite.niconico`。ニコ生弾幕／拡張別窓 |
| 2026-11-14 | Phase 12: alwaysOnTop→PiP、弾幕衝突強化、`twitch.thirdPartyEmotes`、`youtubeComments.sort` / `autoLoadMore` |
| 2026-11-14 | Phase 13: ニコ生タイムシフト／NDGR、`filter.applyToNativeChat`、host `mpn.live.nicovideo.jp` |
| 2026-11-14 | Phase 14: NDGR フィールド番号デコード、YT コメントパネル返信 |
| 2026-11-14 | サイト識別アイコン（ブランド色シルエット）＋プレイヤー右コントロール ON/OFF デザイン刷新 |
| 2026-11-14 | i18n: content は en/ja のみ同梱、他言語は options/popup で遅延読込。NDGR 失敗ログを間引き |
| 2026-11-14 | feature-flags から windows 参照を排除。`popoutBoundsChangedEvent` 削除。firefox-deltas を実装に合わせる |
| 2026-11-15 | ISS-001/002 決定: §1.2 を `applyToNativeChat` 正本に整合。§3 ホストを必須／条件付き表へ更新（PRD 改訂と同期） |
| 2026-11-15 | ニコ生削除: `niconicoLive`・`boundsBySite.niconico`・ニコ生ホスト／別窓／NDGR を除去 |
