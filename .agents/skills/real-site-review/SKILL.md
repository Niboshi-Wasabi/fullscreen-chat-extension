---
name: real-site-review
description: Chrome と Firefox の検証専用プロファイルに MCP で接続し、実サイトを確認する。共通形式の results.json に結果を残し、証跡を検査する。合成 E2E や通常 verify の代用ではない。
---

# 実機レビュー（実サイト）

## 使用条件

実サイト・実ブラウザでの確認、ISS の実機再確認、公開前マトリクスの一部実施。実投稿・ログイン・ストア提出の許可ではない。合成 E2E 成功を実サイト合格に読み替えない。

## 参照資料

- 受け入れ条件の正本: [site-verification-checklist-2026-11-15.md](../../../docs/quality/site-verification-checklist-2026-11-15.md)
- 結果形式: [real-site-result.schema.json](../../../docs/quality/real-site-result.schema.json)、[real-site-item-ids.json](../../../docs/quality/real-site-item-ids.json)
- 手順: [browser-verification.md](../../../docs/operations/browser-verification.md)、[debugging.md](../../../docs/operations/debugging.md)
- Chrome MCP 操作: 利用可能な `chrome-devtools` Skill（拡張は `--categoryExtensions` 前提）
- Firefox: プロジェクトの Firefox DevTools MCP（一時拡張読み込み）

## 入力

対象ブラウザ（chrome / firefox）、確認するチェックリスト項目 ID または ISS、ログイン可否、実投稿の明示許可の有無、既存のビルド有無。

## 手順

1. 対象・許可を確認する。無許可なら投稿しない。個人プロファイルを使わない。
2. 対象をビルドする: `pnpm.cmd build` または `pnpm.cmd build:firefox`。
3. 実行単位を開く: `pnpm.cmd real-site:init -- --browser=chrome|firefox`（必要なら `--run-id=` / `--actor=`）。出力の `runId` とビルドハッシュを控える。
4. 専用プロファイルの MCP だけで操作する。Chrome は `install_extension` で `.output/chrome-mv3`。Firefox は一時 `install_extension` で `.output/firefox-mv3`。
5. 項目ごとに observe → act → verify する。合格条件はチェックリストの該当行だけを使う。配信終了・コメント不在・再生エラー・ツール失敗は製品失敗と混同せず `blocked` または `not-run` にする。
6. `.harness-artifacts/real-site/<runId>/results.json` を更新する。`pass` / `fail` / `conditional` には `reason` と run ディレクトリ相対の `evidence` を必須とする。チャット本文・視聴者識別子・認証情報は書かない。
7. 必要なら短い Markdown 実行記録を同 run または `docs/quality/` に残す（既存の chrome / firefox 記録と同じ方針）。
8. `pnpm.cmd check:real-site -- <runId>` を実行する。形式 OK でも未実施が残る場合は「一部確認」と報告し、全部合格と言わない。
9. 不具合（fail / conditional）は問題台帳へ書き、再発防止は [regression-from-live.md](../../../docs/quality/regression-from-live.md) に従う。匿名 fixture・合成テスト・`regression-links.json` 登録・`check:regression-links`・可能なら該当 checklist の実サイト再確認までをセットにする。合成成功だけで ISS を閉じない。

任意で `pnpm.cmd real-site:finalize -- <runId>` により `finishedAt` を書く。

## ブラウザ差

- Chrome: 拡張 URL や popup 操作が使えることが多い。ページへのキー送信では拡張ショートカットが発火しない場合がある。
- Firefox: `moz-extension:` や `about:debugging` への移動が拒否される場合がある。popup はツールバー経由。終了時の内部ログは ISS-015 と混同しない。
- 両方: MCP 名と確認できた版を `browser.mcp` に記録する。起動する版を `@latest` から固定版に変更するかは、オーナーの判断を待つ。

## 制約

- 通常の `pnpm.cmd verify` / CI に実サイトを混ぜない。実サイト画像を合成 E2E の CI 成果物へ入れない。
- 形式検査の成功は機能合格ではない。独立レビューや人間の承認の代用にしない。
- 新しい外部 MCP（Tsaagan / BrowserSkill 等）を無断導入しない。既存 Chrome / Firefox MCP を使う。
- チェックリストの合格条件文を別文書へ複製しない。

## 完了条件

対象項目の判定と証跡が `results.json` に残り、`check:real-site` が形式として通る。未実施・実行不能・対象外が区別され、保証範囲外が報告に残る。

## 出力形式

runId、ブラウザ／ビルド識別、実施した項目 ID と status、`check:real-site` の終了コード、証跡パス、未検証と次の確認。
