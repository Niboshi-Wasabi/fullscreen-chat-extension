# 実サイト発見から再発防止へ

状態: **第3段階の手順正本（2026-11-19）**。リンク台帳は [regression-links.json](regression-links.json)。形式検査は `pnpm.cmd check:regression-links`。

合成成功を実サイト合格に読み替えない。実サイト画像・チャット本文・視聴者識別子・認証情報を合成 fixture や CI 成果物へ入れない。

## いつ使うか

MCP や手動操作で実サイトの不具合、または特定の条件での失敗を確認し、再発防止のテストを残すときに使う。公開承認そのものではない。

## 手順

1. **台帳**: [issues.md](issues.md) に安定 ID・再現条件・影響・解決条件を書く。チェックリスト項目 ID（例: `YL-6`）を関連付ける。合格条件文は[チェックリスト](site-verification-checklist-2026-11-15.md)から複製しない。
2. **匿名化**: DOM／メッセージ／URL から個人・配信固有情報を除き、`tests/fixtures/` または既存の単体・結合・E2E フィクスチャへ落とす。本文は `Synthetic …` 等の固定句にする。スクリーンショットに本文が写る場合は切り取りか破棄する。
3. **合成回帰**: 決定的なアサーションを単体／結合／`test:e2e:chrome`／必要なら `test:e2e:firefox` に追加する。製品にテスト専用 API を足さない（既存方針）。
4. **リンク登録**: `regression-links.json` に 1 行追加する。`issueId`・`checklistIds`・`synthetic.path`・`testNameContains`・`liveRecheck` を必須とする。`anonymized` は true のみ受理する。
5. **検査**: `pnpm.cmd check:regression-links` が通ること。未知の ISS／チェックリスト ID、欠落ファイル、一致しないテスト名は拒否する。
6. **修正後の両面確認**:
   - 合成: 追加したテスト（と影響する `pnpm.cmd test` / 明示 E2E）を実行する。
   - 実サイト: 該当 `checklistIds` を Skill [real-site-review](../../.agents/skills/real-site-review/SKILL.md) で再確認する。配信終了・未ログイン・ツール制約なら `liveRecheck.status` を `pending` または `blocked` のまま理由を残し、合成成功だけで閉じない。
7. **閉じ方**: 合成が通り、実サイト再確認が `done`（または対象外 `na`＋根拠）になってから ISS の解決条件を満たす。`pending` のまま「再発防止完了」と報告しない。

## liveRecheck.status

| 値 | 意味 |
|---|---|
| `pending` | 合成はあるが実サイト再確認が未実施 |
| `done` | 実サイトで当該項目を再確認した（記録または runId を reason に） |
| `blocked` | 配信・認証・ツール制約で今は再確認できない |
| `na` | スコープ上、実サイト再確認が不要（根拠必須） |

## エージェント向け短い流れ

実サイト fail/conditional → ISS → 匿名 fixture + テスト → `regression-links.json` → `check:regression-links` → 合成再実行 → 可能なら実サイト再確認 → 台帳更新。

## 完了の見分け

- レジストリと検査が導入され、既知の再発防止リンクが機械検証できる。
- 新しい実サイト指摘をこの手順なしに「回帰済み」と呼ばない。
- CI 必須化は別判断（本手順の導入だけでは verify に混ぜない）。
