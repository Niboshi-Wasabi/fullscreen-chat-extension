# Phase 4: CIと品質ゲート

## 目的・背景

[Phase 3](2026-11-14-verification-foundation.md)のローカル検証をPR時に再現し、脆弱性・秘密情報・ワークフロー自体の検査と証跡保存を追加する。ユーザーの「次へ」に基づく後続作業。

## 対象範囲・対象外

GitHub ActionsとPRテンプレート、固定した検査ツールの準備・検査スクリプト、負例テスト、運用文書が対象。ユーザー確認によりGitHubリポジトリは未作成。ローカルGitも未配置のため、Git初期化・コミット・push・リモート作成・GitHub保護設定は行わない。費用が発生する実行、有料サービス、ストア提出は対象外。

## 設計・依存関係

- Windowsを優先し、Windows固定イメージ・Node/pnpm固定版で既存verifyを実行する。
- PR、push、手動起動に対応。pull_request_targetやシークレットを使わず、contents: read、checkout認証情報非保持、Actionは実在するコミットSHAで固定する。
- Gitleaksとactionlintの公式Windowsバイナリを版・配布物SHA-256で固定し、プロジェクト内の無視ディレクトリへ配置。ダウンロード/展開後の失敗を成功扱いしない。
- 秘密情報は作業ツリーをステージングして検査し、Git配置後は全取得履歴も検査する。Git未配置では履歴未検証と記録し、CIでは履歴必須。
- npm auditは開発依存も対象とし、照会・解析失敗は非ゼロ終了。既知の問題をignoreで隠さない。
- 検証結果と両ビルドを保存し、自動公開はしない。失敗時に診断を保存するが、秘密情報の検出内容はredactする。

## 実装手順・変更対象

1. 現状と対象リポジトリを確認、公式資料と配布元から版・SHAを調査。
2. 既存依存のaudit結果を調査し、検出した問題を安全に更新または未解決として記録。
3. 検査ツール準備、audit/secret/workflow検査、CI、PRテンプレートを実装。
4. 負例を検査し、ローカルverifyとセキュリティ検査を実行。
5. 文書・導入状態・残条件を同期。

## リスク・復旧

GitHub実行前の静的検査はCI実行成功の証明ではない。PRのコードは未信頼として権限を絞り、特権実行やシークレットを追加しない。依存更新は検出した問題に限定し、互換性を実テストで確認する。生成物や外部コピーを走査対象から分離するが、著者管理ファイルは除外しない。

## 検証・完了条件

Actionlintでworkflow構文・入力を検査し、追加の規則で固定SHA・イベント・権限・必須ゲートを確認する。Gitleaksの合成キー検出と安全なfixture、auditの問題/通信失敗/正常を負例で確認。ローカル成功とGitHub未実行、作業ツリーと履歴の検査範囲を区別する。リモート作成後の初回PR検証とブランチ保護が完了するまでPhase 4全体完了としない。

## 進捗・証跡

- GitHubリポジトリ未作成とのユーザー回答を確認。GitHub検索でもこのフォルダと対応する所有リポジトリを特定できなかった。
- 初回auditはmoderate 1件（minimatch、GHSA-g3hv-75wg-m249）を検出。対象版限定overrideで11.0.8へ更新し、再照会は全重大度0件。audit ignoreや公開待機期間の例外は追加していない。
- Gitleaks 8.30.1 / Actionlint 1.7.12の公式配布物をGitHub release metadataのSHA-256で照合して展開し、exeハッシュも固定。キャッシュのない状態からsetup-ci-tools.mjsのダウンロード・検証・展開を実行し、両exeが一致（終了0）。
- ActionのタグをGitHub APIで確認し、checkout v7.0.1、setup-node v7.1.0、upload-artifact v7.0.2をコミットSHAへ固定。各コミットのaction.ymlとローカルActionlintで入力を確認。
- `pnpm.cmd verify`: 13ステップ成功、6ファイル40テスト成功。lint・型・構造・両ビルド・manifestも成功。Node v22.23.2 / Windows x64 / pnpm 11.9.0。
- 追加テスト11件: auditの正常/問題/非ゼロ終了/解析・照会失敗、権限イベント・可変タグ・認証情報保持・必須ゲートの無効化・診断の誤った保存条件・シークレット公開の拒否、バイナリ改変検出、合成トークン検出とredact、限定例外下での検出、隠し著者ファイル、Git履歴必須時の不合格を確認。
- `pnpm.cmd verify:security`: ツール整合性、オンラインaudit全件0、作業ファイルの秘密情報検出0で終了0。Git履歴はunavailableで、履歴走査成功とは報告しない。
- 初回Gitleaksの移行ID誤検出はファイル・正確な非秘密値・generic-api-keyルールのAND条件に限定して対応。同じファイル内の別トークンを検出する。テスト用の非秘密値もコードで組み立て、テストファイル全体を除外していない。
- `pnpm.cmd install --frozen-lockfile --ignore-scripts --offline`: 終了0、lockfile整合。ネイティブバイナリ・証跡はGit対象外。アプリ本体の変更、Git初期化、コミット、push、GitHub変更は行っていない。
- ローカル証跡: `.harness-artifacts/verify-phase4.log`、`verify-results.json`、`test-results.xml`、`security-phase4.log`、`security-results.json`、各検査summary。レビュー用の著者管理ファイルのハッシュを `phase4-file-hashes.json` へ保存する。Git比較の代わりではない。
- 今回の確認は自己確認。GitHub初回PR、成果物のリモート保存、全履歴走査、失敗時のマージ阻止、保護設定、独立レビューは未実施。Phase 4全体や公開準備が完了したとは判定しない。

## 未解決・次の作業

Git配置・GitHub初回実行・保護設定はISS-004、独立レビューはISS-010。既存のプロダクト要件の未決定をこの作業で承認扱いにしない。
