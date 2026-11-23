# ADR 0003: CIの権限とセキュリティ検査

- 日付: 2026-11-14
- 状態: ローカル実装。GitHub実行・保護設定は未実施。
- 背景: [Phase 4計画](../plans/2026-11-14-ci-quality-gates.md)。GitHubリポジトリ未作成とのユーザー確認。

## 決定

PR、push、手動実行は 1 つの Windows 2025 ジョブで処理する。ローカルと同じ Node、pnpm、検証コマンドを使う。contents: readと認証情報非保持、特権イベント・シークレットなし、確認済みActionコミットSHAを採用する。

Gitleaks 8.30.1・Actionlint 1.7.12の公式Windows x64配布物を、ZIPとexeのSHA-256を照合してから使用。第三者インストールスクリプトやライセンス用シークレットを必要とするActionは導入しない。macOS用配布物は実機検証まで追加しない。

auditは全件0を要求し、失敗を無視しない。検出したminimatch問題は対象版限定で11.0.8へoverrideする。上流範囲をまたぐ互換性の負担を、全体検証と将来のoverride削除判断で管理する。

秘密情報は作業ファイルと取得済み全履歴を分けて記録。Git未配置のローカル確認は履歴未確認を明示し、CIは履歴必須。公開保存移行IDの誤検出だけをファイル・値・ルールのAND条件で除外し、同じファイルの別トークンを検出する負例を残す。

## 代替案とトレードオフ

Linux併用や複数ジョブは並列化できるが、Windows優先の現段階では検証環境と実行時間・費用を増やす。汎用のActionインストーラーは短く記述できる一方、配布物とローカル検査の再現性を別途管理する必要がある。

静的検査とローカル実行はGitHubランナー実行の証明ではない。リポジトリ作成後に実際のPR、成果物、失敗阻止、利用可能な保護設定を確認する。本人による最終判断や独立レビューの妥当性をCIで保証したとはしない。

## 参照

- [GitHubの安全な利用](https://docs.github.com/en/actions/reference/security/secure-use)
- [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)
- [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0)
- [upload-artifact v7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2)
- [Gitleaks設定](https://github.com/gitleaks/gitleaks/tree/v8.30.1)
- [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
