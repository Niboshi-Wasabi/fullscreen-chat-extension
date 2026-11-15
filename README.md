# Fullscreen Chat Extension

YouTube（ライブ／アーカイブ／通常コメント）と Twitch を、全画面のまま快適に読む・書くためのブラウザ拡張です。

実装は **WXT + TypeScript**（Chromium / Firefox）。自前コア（greenfield / **MIT**）。

## 開発

```bash
pnpm install
pnpm.cmd dev          # Chromium（PowerShell で pnpm.ps1 が弾かれる場合）
pnpm.cmd dev:firefox
pnpm.cmd build
pnpm.cmd build:firefox
pnpm.cmd compile
```

ロード: Chrome の `chrome://extensions` → デベロッパーモード → `.output/chrome-mv3`（開発中は `chrome-mv3-dev`）を読み込み。

## ストア用パッケージ

```bash
pnpm.cmd zip          # Chrome → .output/chrome-mv3-*.zip
pnpm.cmd zip:firefox  # Firefox → .output/firefox-mv3-*.zip
```

掲載文・提出チェックリスト: [docs/store-listing.md](docs/store-listing.md)  
アイコン再生成: `powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1`  
Firefox ID: `fullscreen-chat-extension@niboshi.dev`（データ収集 `none`）

## 機能（Phase 0–14）

- パネル（公式チャット埋め込み／自前リスト）、別窓（公式 popout）、弾幕
- YouTube Live / チャットリプレイ同期 / 通常コメント
- Twitch Live / VOD
- 設定バックアップ、Document PiP 常時前面（対応時）、Twitch BTTV/FFZ/7TV、通常コメントの並び／続き読み込み
- 公式チャット埋め込み内 NG（`applyToNativeChat`）
- NG フィルタ、アーカイブ同期オフセット、別窓ポリシー
- ポップアップ（有効・モード・サイト・言語）／オプション（深い設定）
- ニコニコ生放送は非対応（2026-11-15 に削除）
- プレイヤー右コントロール（シーク帯脇）の ON/OFF トグル・パネルギア
- UI 約 44 言語、[プライバシーポリシー](public/privacy.html) 同梱

## ドキュメント

| 文書 | 内容 |
|------|------|
| [docs/prd.md](docs/prd.md) | プロダクト要件 |
| [docs/implementation-plan.md](docs/implementation-plan.md) | 実装フェーズ |
| [docs/settings-inventory.md](docs/settings-inventory.md) | 設定・権限 |
| [docs/firefox-deltas.md](docs/firefox-deltas.md) | Firefox 差分 |
| [docs/store-listing.md](docs/store-listing.md) | ストア掲載文・提出チェックリスト |
| [public/privacy.html](public/privacy.html) | プライバシー／弾幕免責 |

## 弾幕に関する免責

本拡張の弾幕は個人／コミュニティ向けの非営利利用を想定した非公式機能です。YouTube・Twitch・株式会社ドワンゴとは提携しておらず、特許権を侵害する意図はありません。サイトの DOM 変更により機能が壊れる可能性があります。

## 権限

- `storage` — 設定の端末内保存
- `windows` — 公式チャット別窓
- host: `youtube.com` / `twitch.tv` / `live.nicovideo.jp` / `live2.nicovideo.jp`

## ルール

AI作業の入口は [AGENTS.md](AGENTS.md)、仕様・手順の正本は [文書索引](docs/index.md)です。
共通Skillsは `.agents/skills/`、Cursor固有の適用条件は `.cursor/rules/` に置きます。

[ハーネス導入計画](docs/plans/2026-11-14-harness-foundation.md)に段階と進捗を記録しています。
文書・Skillsとローカル検証基盤を整備しています。`pnpm.cmd verify` で型・静的解析・回帰テスト・構造・文書・多言語・両ビルド・manifestを検査します。
`pnpm.cmd verify:security` で脆弱性・秘密情報を検査します。初回の検証ツール取得と脆弱性照会にはネット接続が必要です。現在のネイティブ検査ツールはWindows x64向けです。
[ブラウザ検証](docs/operations/browser-verification.md)は `pnpm.cmd verify:browser`（同梱Chromium）または `pnpm.cmd verify:chrome`（インストール済みChromeの専用プロファイル）で行います。通常のverifyにはE2Eを含みません。CIは同梱Chromiumを必須とします。
[CI手順](docs/operations/ci.md)とワークフローは追加済みですが、GitHub実行・ブランチ保護・Firefox/実サイト検証は未実施です。検証範囲と手動確認は [品質基準](docs/quality/standards.md)を参照してください。
