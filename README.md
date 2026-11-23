# Fullscreen Chat Extension

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/Niboshi-Wasabi/fullscreen-chat-extension?label=release)](https://github.com/Niboshi-Wasabi/fullscreen-chat-extension/releases/latest)

YouTube や Twitch の動画を全画面で見ながら、チャットを読めるブラウザー拡張機能です。投稿できる配信ではコメントも送れます。

Chrome などの Chromium 系ブラウザーと Firefox に対応しています。ライセンスは MIT です。

[![Chrome 用 ZIP をダウンロード](https://img.shields.io/badge/Download-Chrome%20ZIP-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://github.com/Niboshi-Wasabi/fullscreen-chat-extension/releases/download/v0.1.0/fullscreen-chat-extension-0.1.0-chrome.zip)
[![Firefox 用 ZIP をダウンロード](https://img.shields.io/badge/Download-Firefox%20ZIP-FF7139?style=for-the-badge&logo=firefoxbrowser&logoColor=white)](https://github.com/Niboshi-Wasabi/fullscreen-chat-extension/releases/download/v0.1.0/fullscreen-chat-extension-0.1.0-firefox.zip)

ダウンロードボタンは v0.1.0 の ZIP です。最新版は上の release バッジから確認できます。

[![使い方](https://img.shields.io/badge/Guide-%E4%BD%BF%E3%81%84%E6%96%B9-0078D4?style=for-the-badge&logo=readthedocs&logoColor=white)](#使い方)
[![不具合を報告](https://img.shields.io/badge/GitHub-%E4%B8%8D%E5%85%B7%E5%90%88%E3%82%92%E5%A0%B1%E5%91%8A-333333?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Niboshi-Wasabi/fullscreen-chat-extension/issues)
[![プライバシーポリシー](https://img.shields.io/badge/Privacy-%E3%83%9D%E3%83%AA%E3%82%B7%E3%83%BC-6C757D?style=for-the-badge&logo=shield&logoColor=white)](https://niboshi-wasabi.github.io/fullscreen-chat-extension/)

## インストール

[GitHub Releases](https://github.com/Niboshi-Wasabi/fullscreen-chat-extension/releases) から、使うブラウザー向けの ZIP をダウンロードしてください。

### Chrome

1. Chrome 用の ZIP を展開します。
2. Chrome で `chrome://extensions` を開き、「デベロッパー モード」をオンにします。
3. 「パッケージ化されていない拡張機能を読み込む」を選び、展開したフォルダーのうち `manifest.json` が入っているフォルダーを指定します。

### Firefox

1. Firefox で `about:debugging#/runtime/this-firefox` を開きます。
2. 「一時的なアドオンを読み込む」を選び、Firefox 用の ZIP を指定します。

この方法で読み込んだ拡張機能は、Firefox を終了すると解除されます。

## 使い方

YouTube または Twitch で対応する配信を開き、プレーヤー右側のボタンでチャットを表示します。パネルの歯車から、表示を調整できます。詳しい設定は拡張機能のポップアップや設定画面から変更できます。

チャットは画面上のパネル、別窓、弾幕から表示方法を選べます。通常のパネルでは公式チャットと拡張機能のリストを選択できます。対応する環境では、Document PiP を使って別窓を前面に固定できます。

### YouTube と Twitch のチャットを一緒に見る

同じブラウザーで YouTube と Twitch のライブ配信を開き、パネルの設定から相手のタブを選びます。どちらの視聴タブでも、両方のチャットを一緒に読めます。混合表示は読み取り専用です。

取り込むチャットは表示を 0〜120 秒遅らせることができます。映像と反応のタイミングが合わないときに調整してください。

## 対応する配信と設定

- YouTube のライブ、プレミア公開、チャットリプレイ付きアーカイブに対応しています。通常動画と Shorts は対象外です。
- Twitch のライブと VOD に対応しています。ニコニコ生放送への対応は 2026 年 11 月 15 日に削除しました。
- NG フィルターは `applyToNativeChat` を有効にすると公式チャットにも適用できます。アーカイブの同期オフセットと、別窓の対象も設定できます。
- 設定のバックアップと、Twitch の外部サービス製エモート（BTTV、FFZ、7TV）に対応しています。表示言語は約 44 言語から選べます。

## 権限とプライバシー

- `storage` は、設定を端末内に保存し、別窓の管理や混合チャットの接続に必要な情報をセッション中に保持するために使います。
- `windows` は、公式チャットや混合チャットを別窓で開くために使います。
- サイトへのアクセス権限は、`youtube.com`、`twitch.tv` と、外部エモートを有効にしたときに使う API・CDN（`betterttv.net`、`frankerfacez.com`、`7tv.io`、`7tv.app`）が対象です。

詳しくは [プライバシーポリシー](public/privacy.html) を参照してください。

## 開発

開発環境には Node.js と pnpm が必要です。対応バージョンや Firefox への読み込み方法は [開発手順](docs/operations/development.md)を参照してください。

```powershell
pnpm.cmd install
pnpm.cmd dev             # Chromium 向けの開発
pnpm.cmd dev:firefox     # Firefox 向けの開発
pnpm.cmd build           # Chromium 向けのビルド
pnpm.cmd build:firefox   # Firefox 向けのビルド
pnpm.cmd compile         # 型の確認
```

Chrome でビルドを試すときは、`chrome://extensions` のデベロッパーモードで `.output/chrome-mv3` を読み込みます。開発サーバーの出力先は `.output/chrome-mv3-dev` です。

ストア提出用 ZIP の作成方法は [リリース手順](docs/operations/release.md)、掲載文と確認項目は [ストア掲載文](docs/store-listing.md)にまとめています。アイコンは `powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1` で再生成できます。Firefox の拡張機能 ID は `fullscreen-chat-extension@niboshi.dev`、データ収集の宣言は `none` です。

## 検証と資料

- `pnpm.cmd verify` で、型、静的解析、テスト、文書、翻訳、両ブラウザー向けのビルドなどを確認します。
- 日本語を変更したときは `pnpm.cmd check:japanese` を実行し、指摘を原文と照らして確認します。[日本語の校閲手順](docs/operations/japanese-proofreading.md)
- `pnpm.cmd verify:security` で、依存関係の脆弱性と秘密情報の混入を検査します。初回のツール取得と脆弱性の照会にはネット接続が必要です。ネイティブ検査ツールは Windows x64 向けです。
- ブラウザーを使う E2E 検証には `pnpm.cmd verify:browser` または `pnpm.cmd verify:chrome` を使います。対象範囲は [ブラウザー検証](docs/operations/browser-verification.md)を参照してください。

[文書索引](docs/index.md)から、[プロダクト要件](docs/prd.md)、[実装計画](docs/implementation-plan.md)、[設定と権限](docs/settings-inventory.md)、[Firefox の差分](docs/firefox-deltas.md)を確認できます。検証の範囲は [品質基準](docs/quality/standards.md)、CI の手順は [CI 手順](docs/operations/ci.md)にまとめています。

エージェント向けの作業ルールは [AGENTS.md](AGENTS.md)にあります。共通スキルは `.agents/skills/`、Cursor 固有の適用条件は `.cursor/rules/` にあります。[ハーネス導入計画](docs/plans/2026-11-14-harness-foundation.md)

## 弾幕について

弾幕は、個人やコミュニティでの非営利利用を想定した非公式機能です。YouTube、Twitch、株式会社ドワンゴとの提携関係はなく、特許権を侵害する意図はありません。配信サイトのページ構造が変わると、機能が動作しなくなる場合があります。
