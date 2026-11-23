# 実装プラン — WXT 骨格 → 縦通し

状態: Phase 0–14 完了（NDGR フィールドデコード・YT コメント返信まで）。実ストア提出は人手（2026-11-14）  


入力: [prd.md](./prd.md)、[build-or-fork.md](./build-or-fork.md)、[settings-inventory.md](./settings-inventory.md)、[competitive-evaluation-hands-on.md](./competitive-evaluation-hands-on.md)

---

## 方針（確定）

- **自前コア（greenfield）**、MIT 想定
- ビルド: **WXT** + TypeScript（Chrome / Firefox）
- **公式 UI/UX を優先流用**: 別窓は公式 chat popout URL。パネルも公式チャット面の埋め込み／転送を目指し、自前 UI は枠・弾幕・NG など公式にない部分に限る
- アーキ:

```text
SiteAdapters (youtube-live | youtube-comments | twitch)
  → NormalizeMessage → NGFilter → DisplayRouter
      → OverlayPanel | Danmaku | PopoutWindow（公式 URL）
```

- 実機で強まった実装注意:
  - YT の隠し受信 iframe（`left: -9999px`、`display:none` 禁止）は SDO 参考
  - **Twitch はチャット閉時に受信が落ちうる** → Adapter ごとに検証し、閉じても継続する経路を自前で担保
  - 投稿はネイティブ UI 再利用を優先（YLCFS 参考、GPL コードは取り込まない）

---

## フェーズ

### Phase 0 — リポジトリ骨格（最初の PR）

1. `wxt init`（MV3、React または素の TS — 既存方針に合わせ **TS + 最小 UI** を既定）
2. パッケージマネージャ: **pnpm**
3. ディレクトリ:

```text
entrypoints/
  background.ts
  popup/
  options/
  content/
adapters/
  youtube-live/
  youtube-comments/
  twitch/
core/
  message.ts          # NormalizeMessage 型
  filter.ts           # NGFilter
  router.ts           # DisplayRouter
views/
  overlay-panel/
  danmaku/
  popout/
shared/
  settings.ts         # settings-inventory のスキーマ
  i18n/
```

4. `storage.local` スキーマを [settings-inventory.md](./settings-inventory.md) から型へ落とす（Zod または手書き型）
5. 権限は inventory の最小セットから開始
6. `.gitignore` に `.tmp-extensions/` 等
7. README を「要件定義＋実装開始」に更新

完了条件: `wxt build` と `wxt` 開発起動が Chrome / Firefox ターゲットで通る。空の 3 View がマウントできる。

### Phase 1 — 縦通し #1: YouTube Live × OverlayPanel

受け入れ（PRD §9-1 の核）:

1. YT ライブでパネル表示
2. NG ワードがパネルに効く
3. 投稿（ネイティブ入力流用または転送）の最初の成功パス
4. 全画面時にパネルが映像配下へ再配置される

順序: Adapter スタブ → Normalize → Filter → OverlayPanel → 投稿 → Fullscreen 再配置 → 隠し受信の検証。

### Phase 2 — Twitch Live × 同じ Panel／Filter

- 同一設定モデルで Twitch Adapter
- **チャット閉時も受信が続くこと**を受け入れに含める（実機ギャップ #6）

### Phase 3 — Danmaku（ライブ系のみ）

- Router が `youtube-comments` では弾幕を無効化
- 密度／レーン／縁取りは inventory 準拠

### Phase 4 — Popout（完了）

- `windows` 権限、公式 YT `live_chat?is_popout=1` / Twitch `popout/.../chat`
- bounds 記憶（`rememberPerSite` → `boundsBySite`）
- `Alt+Shift+P` / displayMode=`popout` で開く・フォーカス

### Phase 4.5 — Overlay の公式 UI 寄せ（完了・初版）

- `panel.useNativeChat`（既定 true）: YT `live_chat` / Twitch `embed/.../chat` をパネル iframe 表示
- 失敗時・オフ時は自前リスト＋ネイティブ転送送信にフォールバック
- 絵文字・バッジ・Cheer・送信 UI は公式実装に委ねる
- NG は自前リスト／弾幕に適用（公式 iframe 内表示はサイト側のまま）

### Phase 5 — YouTube 通常コメント Adapter（完了・初版）

- watch ページ（ライブ枠なし）でスレッドコメントをスクレイプ
- パネル表示＋ネイティブ送信。弾幕／公式別窓はパネルへフォールバック
- 続きを読み込む・返信スレッドの高度 UI は Post-MVP

### Phase 6 — アーカイブ／VOD 同期（完了・強化）

- YT チャットリプレイをライブチャット経路へ再分類（通常コメントと分離）
- `video-offset-time-msec` / Twitch VOD（`t=`・時計表示・再生時計フォールバック）から `videoOffsetSec` を付与
- VOD ページのチャンネル login 解決（エモート）。公式チャット別窓／埋め込みは無し
- 再生時計（`timeupdate` / `seeked`）で弾幕・自前リストを `syncOffsetSec` / `maxSkewSec` に合わせて解放
- 設定画面でオフセットと許容するずれを変更できる

### Phase 7 — ポリッシュとストア準備（完了）

- ポップアップ／オプションの i18n（`uiLocale` / `AppLocale` 約 44 言語、`en` フォールバック）。content は en/ja のみ同梱
- `public/privacy.html`（日英・弾幕免責）
- [firefox-deltas.md](./firefox-deltas.md) / `feature-flags.ts`（content は `windows` 非参照・別窓は background 経由）
- [store-listing.md](./store-listing.md)、README 更新
- 権限再確認: `storage` + `windows` + YT/Twitch host のみ
- 設定 UI: PreMiD 行視認性 × サイドバー options（`settings-ui-design.mdc`）

### Phase 8 — ページ内クロム（プレイヤーボタン＋パネルギア）（完了）

settings-inventory §6 のページ内サーフェス。

1. **プレーヤーボタン** — YT `.ytp-right-controls` / Twitch 右コントロール群に `enabled` トグル。`enabled: false` でもボタンは残る
2. **パネル内ギア** — ハンドルから不透明度・フォントサイズを即時保存し、Options を開ける
3. 文言は最小。`uiLocale` / i18n 共用

---

## 最初の縦通しでやらないこと

- Kick、OBS、翻訳／AI、チャンネルポイント自動回収
- GPL（YLCFS）コードのコピー
- 通常コメントへの弾幕

---

### Phase 8 補足 — UI 多言語（完了）

- `src/shared/i18n/locale-meta.ts` + `locales/*.json`（44）
- 言語セレクトは**ポップアップ**（`listLocaleOptions()`、自称ラベル固定）。オプションからは除外
- ar / he / fa は `dir=rtl`
- content script は en/ja のみ先行同梱（他言語は extension ページで遅延読み込み）。ホストページ UI の他言語は英語フォールバック（次: `runtime.getURL`）

### Phase 9 — ストア提出準備（完了）

1. `public/icon/` 16/32/48/128 + SVG（`scripts/generate-icons.ps1`）を manifest に配線
2. gecko id `fullscreen-chat-extension@niboshi.dev` + `data_collection_permissions.required: ["none"]`
3. [`store-listing.md`](./store-listing.md) 掲載文最終化と提出チェックリスト
4. `pnpm build` / `build:firefox` / `zip` / `zip:firefox` で成果物確認

### Phase 10 — ニコニコ生放送（パネル初版）（完了）

1. `adapters/niconico-live` — 公式コメント一覧 DOM 監視（NDGR は天井コメント）
2. `niconicoLive.enabled`・host `live`/`live2.nicovideo.jp`・ポップアップ行・プレーヤー付近トグル
3. 弾幕／拡張別窓は Phase 11。タイムシフト同期は後続

### Phase 11 — 設定バックアップ＋ニコ生弾幕／別窓（完了）

1. Options Tools: settings JSON の export／import／reset（`settings-backup.ts`）
2. Router: `danmakuAllowed` / `popoutAllowed` 分離。ニコ生で弾幕可
3. ニコ生別窓: 拡張ページ `nico-popout`＋background 中継（公式 chat URL なし）
4. `boundsBySite.niconico`

### Phase 12 — 常時前面／弾幕品質／Twitch エモート／YT コメント高度化（完了）

1. `popout.alwaysOnTop` → Document PiP チャット面（不可時は通常別窓へフォールバック）。Options に制限ヒント
2. 弾幕: 衝突待ち回数・間隔・ギャップを強化
3. Twitch: BTTV / FFZ / 7TV カタログ解決（`twitch.thirdPartyEmotes`）＋ host 権限
4. 通常 YT コメント: `sort` / `autoLoadMore` で公式並び・続き読み込みを操作

### Phase 13 — ニコ生タイムシフト／NDGR・公式チャット内 NG（完了）

1. ニコ生: ENDED／TIMESHIFT 視聴を有効化。行時刻／vpos → `videoOffsetSec`（archive-sync）
2. NDGR: embedded-data の view URI をポーリング（軽量 protobuf 走査。型付き .proto は天井）
3. 公式チャット iframe／Twitch embed: `filter.applyToNativeChat` で NG 行を非表示
4. host `mpn.live.nicovideo.jp`

### Phase 14 — NDGR デコード堅牢化・YT コメント返信（完了）

1. NDGR: `protobuf-lite` + Chat／ChunkedEntry フィールド番号デコード（.proto codegen なし）
2. 通常 YT コメント: パネルから Reply → 公式返信 UI を開いて送信（`adapter.replyTo`）
3. `NormalizedMessage.canReply`

## 次のアクション（実行時）

1. Chrome Web Store / AMO へのアップロードは人手（チェックリストは store-listing）
2. 対象外のまま: Kick、OBS、翻訳／AI
3. 任意の先: protoc 生成の完全型付き NDGR、マルチ返信スレッド UI
