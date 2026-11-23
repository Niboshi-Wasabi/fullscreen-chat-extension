# ADR 0005: GitHub Release 監視と Draft 配布ワークフロー

- 日付: 2026-11-24
- 状態: ローカル監視・ワークフロー定義を実装（`feature/release-harness`）。本番タグ実行・公開は人間の明示判断で行う。
- 関連: [ADR 0003](0003-ci-security.md)、[CI手順](../operations/ci.md)、[リリース手順](../operations/release.md)。

## 決定

PR・push 用の品質ゲート [verify.yml](../../.github/workflows/verify.yml) は最小権限 `contents: read` を維持したまま、GitHub Release 配布用のワークフロー [release.yml](../../.github/workflows/release.yml) を独立させて追加する。

1. **ローカル乖離・整合監視の追加**: [check-release.mjs](../../scripts/check-release.mjs)（`pnpm.cmd check:release` / `check:release:pack` / `check:release:drift`）により、外部展開ツールを追加せず Node 標準機能のみで ZIP 内 `manifest.json`・同梱資産・ビルド一致・`SHA256SUMS.txt` を検査し、`gh api` 経由で `origin/main` と GitHub Release（公開済みおよび Draft）の乖離を検知する。
2. **Draft 専用リリースワークフローの分離**: `release.yml` は `push.tags: ["v*"]` と手動 `workflow_dispatch` のみで起動し、`permissions: { contents: write }` の単一ジョブ上で `pnpm.cmd verify:ci`、`pnpm.cmd release:pack`、`pnpm.cmd check:release:pack`、[publish-draft-release.mjs](../../scripts/publish-draft-release.mjs)（`pnpm.cmd release:draft`）を無条件かつ順に実行する。
3. **シークレット不要・既定 Draft・上書き防止**: 組み込み `github.token`（`GH_TOKEN`）と既定 Action 3種（固定コミット SHA）のみを使用し、カスタムシークレット・外部サードパーティ Release Action・ストア自動提出は導入しない。公開済みリリースの上書きは拒否し、作成・更新は常に Draft（下書き）に留め、公開とタグ作成は人間が明示的に判断する。
4. **ワークフローポリシー検査の拡張**: [check-workflows.mjs](../../scripts/check-workflows.mjs) に `releaseWorkflowPolicy` を追加し、許可ワークフローを `verify.yml` と `release.yml` の 2 本に固定したうえで両方のトリガー・権限・必須ゲートを静的検査する。

## 代替案とトレードオフ

- **既存 `verify.yml` へ Release 更新を組み込む案**: すべての PR や通常 push の経路に `contents: write` やタグ・配布処理が近接するため採らない。通常 CI の読み取り専用境界を守るため、ファイル単位で分離する。
- **PR マージごとに自動公開（または自動 Draft 更新）する案**: 機能単位のマージと配布版・リリースノートの確定が一致しない場面が多いため、PR マージ時は `check:release:drift` で乖離を検知して報告し、Draft 更新や公開用タグ作成は明示的なリリース単位で起動する。
- **サードパーティ製 ZIP パーサや Release Action を導入する案**: 依存パッケージと権限面（外部 Action のサプライチェーン検証）が増えるため、Node 標準の `node:zlib` と公式 `gh` CLI を用いる最小構成を選んだ。
