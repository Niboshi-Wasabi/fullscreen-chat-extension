# プロジェクト知識の索引

所有者: プロジェクトオーナー（個人開発）。更新基準日: 2026-11-14。

## 読む順序と正本

| 知識 | 正本 | 更新する契機 |
|---|---|---|
| エージェントの入口 | [AGENTS.md](../AGENTS.md) | 作業の入口・禁止事項が変わる |
| 目的・ユーザー・機能・非機能要求 | [PRD](prd.md) | 承認された要求変更。既存の凍結条件を尊重 |
| 設定の意味・利用者向け制約 | [設定一覧](settings-inventory.md) | 設定・保存・権限の変更 |
| 設定の型・既定値・保存処理 | [settings.ts](../src/shared/settings.ts) | 実装変更。設定一覧と照合 |
| 構造・依存方向 | [アーキテクチャ](architecture/overview.md) | 境界・結線の変更 |
| データ・メッセージ・アダプタ契約 | [契約の案内](architecture/contracts.md) | 型・送受信・保存互換性の変更 |
| UI/UX原則 | [デザイン](design/README.md) | 設定UIの設計変更 |
| 技術判断と理由 | [ADR 0001](decisions/0001-harness-foundation.md)、[ADR 0002](decisions/0002-local-verification.md)、[ADR 0003](decisions/0003-ci-security.md)、[ADR 0004](decisions/0004-browser-verification.md) | 重要な選択・制約の変更 |
| 品質基準・検証導入状態 | [品質基準](quality/standards.md) | コマンド・ゲート追加時 |
| 多言語フォールバックの明示例外 | [欠落リスト](quality/locale-fallbacks.json) | 翻訳追加で解消時、または欠落を明示判断した場合 |
| manifestの現状回帰基準 | [比較基準](quality/manifest-baseline.json) | 権限・公開面の変更を判断した場合。要求適合の承認とは別 |
| 実装原則 | [コード原則](quality/code-principles.md) | 再現した問題や有効な改善に基づく変更 |
| 役割・承認・レビュー | [作業フロー](quality/workflow.md)、[レビュー書式](quality/review-template.md) | 手順・役割の変更 |
| 既知の問題・負債・未決定 | [問題台帳](quality/issues.md) | 発見、解決、判断、再発時 |
| YT/Twitch 完全対応のパターン母集団 | [content-patterns-2026-11-15.md](quality/content-patterns-2026-11-15.md) | スコープ判断・実サイト検証の母集団変更時 |
| 変更単位の計画 | [計画テンプレート](plans/TEMPLATE.md)、[ハーネス導入計画](plans/2026-11-14-harness-foundation.md) | 中規模以上の作業とセッション終了時 |
| ローカル検証基盤の実装 | [Phase 3計画](plans/2026-11-14-verification-foundation.md) | ゲート・証跡の更新時 |
| CI・セキュリティ基盤の実装 | [Phase 4計画](plans/2026-11-14-ci-quality-gates.md) | ローカル検証とリモート有効化の区別を更新 |
| ブラウザ実行・観測基盤 | [Phase 5計画](plans/2026-11-14-browser-verification.md)、[ブラウザ手順](operations/browser-verification.md) | テスト範囲・計測・証跡の更新時 |
| 全体レビュー指摘の修正 | [修正計画](plans/2026-11-15-review-fixes.md)、[R01–R21の対応記録](quality/review-fixes-2026-11-15.md) | 各指摘の実装・自己確認・独立レビュー結果の更新時 |
| Firefoxでの検証結果・修正 | [2026-11-15検証記録](quality/firefox-verification-2026-11-15.md)、[復元・終了処理の修正計画](plans/2026-11-15-firefox-lifecycle-fixes.md)、[独立レビュー](quality/firefox-lifecycle-review-2026-11-15.md) | 実施範囲・警告・未検証を更新 |
| Twitch手動報告と再発防止 | [計画](plans/2026-11-15-twitch-live-fixes.md)、[検証記録](quality/twitch-verification-2026-11-15.md)、[独立レビュー](quality/twitch-review-2026-11-15.md) | 実サイトのユーザー確認と合成再現を分けて更新 |
| 従来の実装履歴 | [既存実装計画](implementation-plan.md) | 過去の記録。新計画の代わりにしない |
| 開発環境 | [開発手順](operations/development.md) | 準備・実行方式の変更 |
| CI実行・保護設定・セキュリティ検査 | [CI手順](operations/ci.md) | workflow・検査・リポジトリ設定の変更 |
| 権限・通信・信頼境界 | [セキュリティ](operations/security.md) | 外部入力・API・権限変更 |
| 実際のmanifest | [WXT設定](../wxt.config.ts)、ビルド出力 | 設定変更。出力も確認 |
| ブラウザ差・公開 | [Firefox差分](firefox-deltas.md)、[リリース手順](operations/release.md) | ブラウザAPI・配布変更 |
| ストア掲載・利用者向けプライバシー | [掲載資料](store-listing.md)、[privacy.html](../public/privacy.html) | 実際の公開内容変更 |

型定義はコードに置き、文書は意味・理由・所在を示す。文書と実装が矛盾する場合、実装への追認や要求の書き換えで解消せず、問題台帳で判断を求める。

文書内では「確定」「提案」「未決定」「実装済み」「検証済み」を区別する。過去文書の「完了」は当時の申告であり、今回の実機検証結果ではない。

## 外部資料

参考資料として利用し、外部の手順をプロジェクトの実行許可や必須構成にしない。2026-11-14に閲覧確認。ローカルクライアント互換性の実証とは区別する。

- [Harness Engineering](https://openai.com/index/harness-engineering/): 短い入口、リポジトリ内の正本、機械検証。
- [Iterating Development Workflows](https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex): 計画・証跡・人間の判断を段階的に組み込む。
- [Agent Skills](https://agentskills.io/) / [仕様](https://agentskills.io/specification): 共通のSKILL.md形式。
- [Cursor Skills](https://cursor.com/docs/skills) / [Rules](https://cursor.com/docs/rules): 共通Skills配置と製品固有の適用規則。
- [Codex](https://developers.openai.com/codex/) / [Skillsの現行転送先](https://learn.chatgpt.com/docs/build-skills): 発見・呼び出し仕様。
