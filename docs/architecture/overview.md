# アーキテクチャ

状態: 既存コードを参照した構造の記録。依存制約はdependency-cruiser、windows APIの直接参照はESLintで検査する。

## 実行コンテキストと責務

| 領域 | 責務・主な依存 |
|---|---|
| `src/entrypoints` | WXTの起動点。content、background、popup、options、bridge-popout を起動し、各処理を接続 |
| `src/app` | サイトごとの実行と共通ライフサイクル。adapters、core、views、sharedを連携 |
| `src/adapters` | サイトDOM・受信経路・公式投稿操作を隔離し、正規化メッセージへ変換 |
| `src/core` | メッセージ、NG、表示判断、アーカイブ同期、混合チャット遅延バッファ。adapters / views / appを参照しない |
| `src/views` | パネル・弾幕・別窓・PiP・プレーヤーボタン。coreの結果とsharedを利用 |
| `src/ui` | 設定画面などの共通表示部品・スタイル |
| `src/shared` | 設定、通信型、i18n、能力判定、サイト情報。純粋処理とブラウザ依存処理が混在 |

主な処理の流れは `entrypoints/content.ts → app/*-runtime.ts → app/site-runtime.ts`。受信した正規化メッセージを同期・フィルタし、表示判断に従いViewへ渡す。サイト固有処理とViewを直接結合しない。

contentとページ・iframeは異なる信頼境界。別窓のwindows API操作は `entrypoints/background.ts` が担当し、contentはメッセージ経由とする。popup / options / 拡張別窓も独立した実行コンテキストとして扱う。

## 保護する制約

- 循環依存、coreからapp / adapters / views / entrypointsへの参照を新設しない。
- Viewからサイト固有アダプタを直接呼ばず、app で連携させる。
- contentから `browser.windows` を直接参照しない。sharedに隠れた参照も確認する。
- YouTube 通常動画コメント（`youtube-comments`）は 2026-11-16 に廃止（[PRD](../prd.md)／[ISS-027](../quality/issues.md#iss-027)）。現在対応するのは YouTube ライブ／アーカイブ（`youtube-live`）と Twitch（`twitch`）のみであり、通常視聴・Shorts ではアダプタ・UI・プレーヤーボタンを起動しない。
- `shared` は一律の最下層ではない。core/routerはshared/feature-flagsを、sharedの通信型はcore/messageを参照する。実際のグラフを確認せず、理想の階層を適用しない。
- 型だけの参照と実行時の参照を区別し、公開インターフェースは[契約](contracts.md)からたどる。

`pnpm.cmd check:architecture` は [.dependency-cruiser.cjs](../../.dependency-cruiser.cjs)で解決済みパス・動的import・型参照を含む依存を検査する。`pnpm.cmd lint` は [ESLint設定](../../eslint.config.mjs)でbackground以外のbrowser/chrome.windows直接参照・文字列添字・分割代入を禁止する。別名や動的なキーを追跡するデータフロー解析ではないため、間接参照はレビューも必要。

違反には位置または依存経路・理由・修正先を出す。例外には理由と解消条件を付け、既存違反を包括的に無視しない。
