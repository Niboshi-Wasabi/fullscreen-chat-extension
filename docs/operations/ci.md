# CIとセキュリティ検査

状態: CIファイルとローカル検査を実装。2026-11-15 に Git／GitHub 配置と初回実行を着手（ISS-004／007）。作業履歴は[Phase 4計画](../plans/2026-11-14-ci-quality-gates.md)。

## ローカルの入口

| コマンド | 範囲 |
|---|---|
| `pnpm.cmd tools:setup` | 固定したGitleaks・Actionlintを準備。初回はネット接続が必要 |
| `pnpm.cmd verify` | Phase 3の全検証にツール整合性とworkflow検査を追加。初回はツールを取得 |
| `pnpm.cmd check:audit` | 開発依存を含む既知脆弱性をレジストリへ照会。全件0で成功 |
| `pnpm.cmd check:secrets` | 作業ファイルと、利用可能なら取得済み全Git履歴を検査 |
| `pnpm.cmd verify:security` | ツール準備、audit、秘密情報検査。ネット接続が必要 |
| `pnpm.cmd verify:ci` | verify、同梱Chromium E2E、securityを統合。完全な取得済みGit履歴を必須とするCI用入口 |

ネイティブツールは現在Windows x64のみ。通常verifyもこの検証環境を前提とし、未対応環境で静かに検査を飛ばさない。macOS対応時は公式配布物の検証と実機確認を追加する。

ブラウザのローカル確認と署名ポリシーの制限は[ブラウザ手順](browser-verification.md)を参照。CIはインストール済みChromeへフォールバックしない。通常verifyはE2Eを含まず、verify:browser / verify:chromeで明示する。

## ツールの固定と信頼境界

[ci-tools.json](../../scripts/ci-tools.json)で公式URL、版、ZIPと展開後exeのSHA-256を固定。[setup-ci-tools.mjs](../../scripts/setup-ci-tools.mjs)は検証してから使用する。既存exeも毎回ハッシュ照合する。格納先 `.harness-tools/` はGit対象外。グローバルPATHへツールを追加しない。

- [Gitleaks v8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1)
- [Actionlint v1.7.12](https://github.com/rhysd/actionlint/releases/tag/v1.7.12)

配布物の固定は更新不要の意味ではない。版更新時は配布元とチェックサム、互換性、負例を確認して正本を更新する。

## 秘密情報検査

Git未配置では作業フォルダを走査し、ルートのnode_modules、生成出力、外部コピー、ハーネス生成物を除いた通常ファイルを一時領域へコピーする。隠しファイルも含む。Git配置後は追跡ファイルとGitのignore対象外の未追跡ファイルを使い、誤ってコミットした生成物も検査する。リンク先は追跡せず、アーカイブ内部の網羅的走査ではない。

Gitが利用できる場合は浅い履歴を拒否し、取得済みの全参照を走査する。Git未配置の通常モードは作業ファイルだけの成功としてhistory=unavailableを記録。`--require-history`やverify:ciではこの状態を不合格にする。リモートにしか存在しない未取得の履歴や削除済み履歴までは保証しない。

[Gitleaks設定](../../scripts/gitleaks.toml)は標準ルールを継承し、inlineのallowコメントと.gitleaksignoreによる抑制を使わない。例外はgeneric-api-keyルールの公開保存移行IDについて、`src/shared/settings.ts`の正確な値に限定したAND条件1件。ファイル全体を除外しない。別の合成トークンを同じファイルへ置いた負例で検出を確認する。

出力はredact=100とし、CIへ保存するsummaryはルール・ファイル・行だけに絞る。検出時は資格情報の有無を調べ、実物なら失効/再発行と履歴対応を行う。ゲート通過のために例外を広げない。

## auditと依存更新

pnpmの公開レジストリへの照会を利用。正常なJSONと完全な件数、プロセス成功、全件0を要求し、照会失敗・タイムアウト・壊れた応答を合格にしない。例外やignoreを自動追加しない。

導入時に検出した[minimatchの問題](https://github.com/advisories/GHSA-g3hv-75wg-m249)には、pnpm-workspace.yamlの対象版限定overrideで11.0.8を指定した。上流の範囲をまたぐためlint・テスト・構造・両ビルドで互換性を確認する。上流が修正版を採用したら不要なoverrideを削除できるか再検討する。公開待機期間の例外は追加していない。

## ワークフローと証跡

[verify.yml](../../.github/workflows/verify.yml)はPR・push・手動起動を対象に、Windows 2025 / Node 22.23.2 / pnpm 11.9.0でverify:ciを実行する。シークレット不要、contents: read、checkout認証情報非保持、fetch-depth: 0、Actionは確認したコミットSHA固定。パス条件で必須チェックを省略しない。concurrencyで古い同一参照の実行を中止し、ジョブに時間上限を付ける。

Actionlintは構文と既知入力を検査し、追加の[ポリシー検査](../../scripts/check-workflows.mjs)でイベント、権限、SHA、無条件の必須コマンド、明示的成果物の範囲を確認。ShellCheck/Pyflakesは使用せず、PowerShellコマンドは記録した3コマンドに限定する。これは任意の悪意ある変更に耐える独立した保護装置ではなく、ポリシー自身の変更はレビューが必要。

診断summary・JUnitとE2EのJSON/JUnit・テスト別画像/trace・HTMLレポートは失敗時も可能な範囲で保存し、両ビルドは全チェック成功時のみ保存する。E2Eは合成データだけを扱い、プロファイルや認証済み実サイトの記録をアップロードしない。成果物保存期間は7日。ハーネス全ディレクトリや秘密情報のrawレポートはアップロードしない。提出・デプロイは自動化しない。

ローカル証跡は `.harness-artifacts/`。verify:securityはsecurity-results.json、通常/CIはverify-results.json、各検査はaudit-summary.json・secrets-summary.json・workflow-summary.jsonを記録する。以前のレポートが残る場合があるため、必ず統合結果の各ステップ状態と時刻を合わせて確認する。

## GitHub作成後に残る作業

1. リポジトリURL、公開/非公開、費用枠と利用プランを確認。Git配置とpushは別の明示許可で行う。
2. [PRテンプレート](../../.github/pull_request_template.md)に沿い、実際のPRでチェックと診断保存を確認する。未信頼forkの実行はGitHub側の承認制約も確認する。
3. 利用可能な保護機能で、実際に表示された `verify-windows` の必須チェックを設定し、最新の対象を検証する。失敗例がマージを止めることを確認する。
4. force-push/削除、直push、管理者の例外の扱いをオーナーが確認する。個人開発で自分のPRに他人の承認を要求する設定にはしない。
5. 独立レビュー記録と本人の最終判断を残す。CIではレビューの意味や本人の意思を保証できない。

上記の実証前は「CI実行済み」「ブランチ保護済み」「Phase 4完了」と報告しない。有料枠・外部契約・認証情報登録は明示許可なしに追加しない。
