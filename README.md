# Fullscreen Chat Extension

YouTube と Twitch の動画を全画面で見ながら、チャットを読んだり、投稿可能な配信でコメントを書いたりできるブラウザ拡張機能です。

WXT と TypeScript で独自に実装しており、Chromium と Firefox に対応します。ライセンスは MIT です。

## 主な機能

- YouTube のライブ、プレミア公開、チャットリプレイ付きアーカイブと、Twitch のライブ、VOD に対応します。
- チャットはパネル、別窓、弾幕で表示できます。通常のパネルでは公式チャットと拡張機能のリストを選べます。
- YouTube と Twitch のライブを同じブラウザで開くと、どちらの視聴タブでも両方のチャットを読み取り専用で表示できます。取り込むチャットの追加遅延は 0〜120 秒の範囲で調整できます。
- 対応環境ではチャットを Document PiP で前面に固定できます。
- NG フィルタは `applyToNativeChat` の設定で公式チャットにも適用できます。アーカイブの同期オフセットと別窓の対象を設定できます。
- 設定のバックアップ、Twitch の外部サービス製エモート（BTTV、FFZ、7TV）、約 44 言語の UI に対応します。
- プレーヤー右側のボタンで表示を切り替え、パネルの歯車から表示を調整できます。全体の設定は拡張機能のポップアップや設定画面で変更できます。

YouTube の通常動画と Shorts は対象外です。ニコニコ生放送への対応は 2026-11-15 に削除しました。

## 開発

```bash
pnpm.cmd install
pnpm.cmd dev          # Chromium
pnpm.cmd dev:firefox
pnpm.cmd build
pnpm.cmd build:firefox
pnpm.cmd compile
```

Chrome では `chrome://extensions` のデベロッパーモードで `.output/chrome-mv3` を読み込みます。開発サーバーの出力は `.output/chrome-mv3-dev` です。Firefox への一時インストールやビルドの切り替えは [開発手順](docs/operations/development.md)を参照してください。

## ストア用パッケージ

```bash
pnpm.cmd zip          # .output/fullscreen-chat-extension-<version>-chrome.zip
pnpm.cmd zip:firefox  # .output/fullscreen-chat-extension-<version>-firefox.zip
```

提出前に [ストア掲載文と提出チェックリスト](docs/store-listing.md)を確認してください。アイコンの再生成には `powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1` を使います。

Firefox の拡張機能 ID は `fullscreen-chat-extension@niboshi.dev` です。データ収集の宣言は `none` です。

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

弾幕は、個人やコミュニティでの非営利利用を想定した非公式機能です。YouTube、Twitch、株式会社ドワンゴとの提携関係はなく、特許権を侵害する意図はありません。配信サイトのページ構造が変わると、機能が動作しなくなる場合があります。

## 権限

- `storage` は設定の端末内保存と、別窓管理や混合チャット接続に必要な情報のセッション内保持に使います。
- `windows` は公式チャットや混合チャットの別窓を開くときに使います。
- ホスト権限の対象は `youtube.com` と `twitch.tv`、および有効時のみ利用する外部エモート API と CDN（`betterttv.net`、`frankerfacez.com`、`7tv.io`、`7tv.app`）です。

## 開発ルールと検証

エージェント向けの作業ルールは [AGENTS.md](AGENTS.md)、仕様と手順の参照先は [文書索引](docs/index.md)にあります。
共通スキルは `.agents/skills/`、Cursor 固有の適用条件は `.cursor/rules/` に置きます。導入の経緯は [ハーネス導入計画](docs/plans/2026-11-14-harness-foundation.md)を参照してください。

- `pnpm.cmd verify` で型、静的解析、回帰テスト、構造、文書、翻訳、両ブラウザ向けビルド、マニフェストを検証します。
- 日本語の文章を変更したときは `pnpm.cmd check:japanese` を実行し、指摘箇所を原文と照らし合わせます。[日本語の校閲と差分検査](docs/operations/japanese-proofreading.md)
- `pnpm.cmd verify:security` で依存関係の脆弱性と秘密情報の混入を検証します。初回のツール取得と脆弱性の照会にはネット接続が必要です。ネイティブ検査ツールは Windows x64 向けです。
- E2E は `pnpm.cmd verify:browser`（同梱 Chromium）または `pnpm.cmd verify:chrome`（インストール済みの Chrome と専用プロファイル）で実行します。CI は同梱 Chromium を使います。[ブラウザ検証](docs/operations/browser-verification.md)

検証範囲と手動確認については [品質基準](docs/quality/standards.md)を参照してください。初回の `verify-windows` 実行とブランチ保護の設定は 2026-11-15 に実施しました。変更後の CI と提出前の確認については [CI 手順](docs/operations/ci.md)を参照してください。
