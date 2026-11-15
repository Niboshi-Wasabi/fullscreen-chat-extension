# 開発環境とエージェント利用

## 現在の前提

Windows + PowerShell、TypeScript + WXT + pnpm。Chromium / Firefox向け。macOSは将来検討で、対応済みとはしない。

2026-11-14のハーネス整備時に確認した環境はNode v22.23.2、pnpm 11.9.0、Python 3.12.10。Phase 3の開発ツールの要件はpackage.jsonのengines（Node 22.13以降の22系、24系、26系以降）、packageManagerはpnpm 11.9.0。実証した環境は22.23.2であり、他版の実機検証済みとはしない。ブラウザの最低対応版とは独立した開発要件。Pythonは初期整備の補助で、通常の統合検証には不要。

## 準備と実行

既存のpackage.jsonとpnpm-lock.yamlを利用する。依存を初めて準備する場合は `pnpm.cmd install --frozen-lockfile`。postinstallのWXT prepareが生成型を用意する。依存があり生成型だけ不足する場合は `pnpm.cmd exec wxt prepare`。いずれもファイル生成を伴う。

| 目的 | コマンド |
|---|---|
| Chromium開発 | `pnpm.cmd dev` |
| Firefox開発 | `pnpm.cmd dev:firefox` |
| 型・ビルド | [品質基準](../quality/standards.md)を参照 |
| 統合検証 | `pnpm.cmd verify` |
| オンラインセキュリティ検証 | `pnpm.cmd verify:security`。範囲は[CI手順](ci.md) |
| ブラウザ込みの検証 | `pnpm.cmd verify:browser` / `pnpm.cmd verify:chrome`。範囲は[ブラウザ手順](browser-verification.md) |
| 公開パッケージ | [公開手順](release.md)を参照 |

Chromiumはchrome://extensionsのデベロッパーモードで `.output/chrome-mv3`、開発中は生成されたdevディレクトリを読み込む。Firefoxはabout:debuggingから対象ビルドを一時読み込みする。作業専用プロファイルを使い、個人の認証情報を自動テストへ持ち込まない。

統合検証はWXT prepareから開始し、失敗時は後続を未実行として停止する。初回は固定されたネイティブ検査ツールを `.harness-tools/` へ取得するため、Windows x64とネット接続が必要。結果JSONとJUnitは `.harness-artifacts/`（Git対象外）へ保存。`pnpm.cmd format` は書式を変更し、`pnpm.cmd format:check` は読み取り検査する。pnpm-workspace.yamlのminimumReleaseAgeStrictで公開待機期間の自動例外追加を防ぐ。セキュリティ例外をツール任せに追加しない。

## 共通Skillsの互換性確認

正本はルートの `.agents/skills/`。同じSkillを.cursor/skillsや.codex/skillsへ複製しない。Cursorルールは共通文書への案内と適用条件に限定する。

公式資料上の対応は[索引](../index.md)で確認済み。ローカル両クライアントでの以下の確認は未実施（[ISS-008](../quality/issues.md#iss-008)）。

1. Cursor / Codexのバージョンと起動ディレクトリを記録し、この作業フォルダを開く。
2. 5 Skillsが検出されることを確認。Codexは `$requirements-analysis`、Cursorは `/requirements-analysis` など利用版の公式UIで明示呼び出しする。
3. 「ISS-002の未決定事項をコード変更なしで整理」と依頼。正本と台帳を読み、仕様を独断確定しないことを確認する。
4. レビューSkillで「routerの通常コメント経路を読み取り専用で確認」と依頼。実コードを読み、変更しないことを確認する。
5. 検証Skillで「現在ある検証と未実施ゲートを区別」と依頼。verify、セキュリティ、Chrome E2Eを利用可能と認識し、未実施のGitHub・同梱Chromium・Firefox/実サイトを成功扱いしないことを確認する。
6. 実際の結果・読まれた参照・変更の有無を記録する。検出だけ、静的構文チェックだけでは互換性確認完了にしない。

検出されない場合は対応版を確認し、必要なSKILL.mdを直接読ませる。実際に試さず再起動や更新で解決済みと記録しない。

## Gitと継続作業

現在のGit配置は[ISS-004](../quality/issues.md#iss-004)で未決定。初期化・remote登録・コミットをこの手順の記載だけで実行しない。利用できる場合は作業前後の差分を確認する。

セッション終了時は計画の進捗、検証、未解決、次の作業を更新。既存成果を破棄して再開しない。
