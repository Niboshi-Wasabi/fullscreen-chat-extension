# 品質基準と検証の導入状態

状態: Phase 3ローカル基盤、Phase 4のCIファイル・セキュリティ検査・初回GitHub実行・保護設定、Phase 5の拡張E2E基盤を実装（最新変更分のPR再実行と実サイト確認は別途要）。証跡は[Phase 3計画](../plans/2026-11-14-verification-foundation.md)、[Phase 4計画](../plans/2026-11-14-ci-quality-gates.md)、[Phase 5計画](../plans/2026-11-14-browser-verification.md)、[CI手順](../operations/ci.md)へ記録する。

## 統合検証

`pnpm.cmd verify` は [verify.mjs](../../scripts/verify.mjs)を実行する。WXT prepare、検査ツール準備・整合性、workflow、文書、locale、format、lint、型、テスト、依存制約、Chromiumビルド、Firefoxビルド、manifestの順で実行し、最初の失敗で停止する。後続はnot-runとして記録し、非ゼロ終了する。固定ツールはWindows x64向けで、初回取得はネット接続が必要。

結果は `.harness-artifacts/verify-results.json`、JUnitは同ディレクトリの `test-results.xml`。このディレクトリはGit対象外。子プロセスはNodeで直接起動し、シェル展開やWindows専用の連結コマンドに依存しない。

| 検証           | 単独コマンド                                         | 判定できる範囲                                                                                                         |
| -------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| format         | `pnpm.cmd format:check`                              | src、scripts、tests、.github、ルートのTS/JS/JSON設定。docs等のMarkdown、public、生成物、翻訳元カタログは書式検査対象外 |
| lint           | `pnpm.cmd lint`                                      | JS/TSの推奨規則、background以外のwindows直接参照。APIの別名追跡や型付き非同期解析は未導入                              |
| 型             | `pnpm.cmd compile`                                   | strictを維持。allowJsでJS検査器をTSテストから参照できるが、checkJsは無効                                             |
| 回帰           | `pnpm.cmd test`                                      | NG、表示ルート判定、ライブページ境界、アーカイブ同期、設定保存APIのfake-browser結合、ハーネス負例                      |
| 構造           | `pnpm.cmd check:architecture`                        | 循環、逆方向、解決不能import。動的importと型参照を含む                                                                 |
| 文書・Skills   | `pnpm.cmd check:docs`                                | 入口、インライン形式のローカルMarkdownリンク、課題アンカー、Skill/ルールYAML、Skill必須項目、AGENTS行数                |
| 多言語         | `pnpm.cmd check:locales`                             | キー集合、文字列型、locale一覧、{name}/$NAME$補間、明示的フォールバック例外と不要になった例外                          |
| Chromiumビルド | `pnpm.cmd build`                                     | バンドル生成。実機動作は保証しない                                                                                     |
| Firefoxビルド  | `pnpm.cmd build:firefox`                             | Firefox向け生成。実機動作は保証しない                                                                                  |
| manifest       | `pnpm.cmd check:manifests`                           | 両ビルドのMV3、版、記録した権限/ホスト/実行構成、参照資産、Firefox識別・宣言。先に両ビルドが必要                       |
| workflow       | `pnpm.cmd check:workflows`                           | Actionlint構文/入力と、`verify.yml` / `release.yml` のイベント・権限・固定SHA・必須ゲート・成果物範囲               |
| 配布ZIP整合    | `pnpm.cmd check:release` / `pnpm.cmd check:release:pack`（任意） | 生成済み両ZIP内のmanifest・資産・ビルド一致・`SHA256SUMS.txt`生成。未生成時は `check:release:pack` で必須失敗     |
| Release乖離監視 | `pnpm.cmd check:release:drift`（任意・オンライン）   | `gh api` で `origin/main` と GitHub Release（公開済み・Draft・ZIPアセット・本文SHA-256）の乖離を検知                 |
| 脆弱性         | `pnpm.cmd check:audit`                               | 開発用依存含む全件照会。通信/解析失敗や既知の問題を不合格                                                              |
| 秘密情報       | `pnpm.cmd check:secrets`                             | 著者管理ファイル、利用可能なら取得済み全履歴。Git未配置の履歴はunavailable                                             |
| 拡張E2E        | `pnpm.cmd verify:browser` / `pnpm.cmd verify:chrome` | 同梱Chromiumまたは明示的なChrome。合成YouTube・popup/options、明暗axe、アイコン表示。範囲はブラウザ手順を参照          |
| Firefox合成E2E | `pnpm.cmd test:e2e:firefox`（任意）                | インストール済みFirefox + BiDi。一時拡張・合成YT受信・OFF/ON・後始末。通常 verify / CI には含めない。実サイトではない |
| 実サイト結果形式 | `pnpm.cmd check:real-site`（任意）                 | 実機 run の `results.json` 形式・既知項目ID・証跡パス。機能合格ではない。通常 verify / CI には含めない。手順は[ブラウザ手順](../operations/browser-verification.md)と Skill `real-site-review` |
| 実サイト→回帰リンク | `pnpm.cmd check:regression-links`（任意）        | [regression-links.json](regression-links.json) の ISS・checklist・合成テスト対応。pending の liveRecheck は失敗にしない。手順は[regression-from-live.md](regression-from-live.md) |

オンライン検査は `pnpm.cmd verify:security`。CI用の `pnpm.cmd verify:ci` は通常検証に同梱Chromium E2E、auditと秘密情報検査を加え、浅くないGit履歴も必須とする。通常verifyはブラウザ検査を含まない。ローカルではブラウザ別の明示的な統合入口を使う。2026-11-15にGit配置・公開・初回 `verify:ci` 実行・ブランチ保護を実施済み（[CI手順](../operations/ci.md)）。変更ごとのPR実行・実サイト確認と[ブラウザ手順](../operations/browser-verification.md)を併用する。

`pnpm.cmd format` は上記書式対象を変更する。初期導入の既存ソース変更は書式のみで、Phase 3計画に比較結果を記録する。ルート設定やソースから参照される資産、文書の意味の一致はレビューも必要。現在の検査は全てのリンク記法や任意のHTML/動的参照の完全解析ではない。

## 明示的な比較基準

2026-11-15のレビュー修正で、単体/結合に起動競合、設定の並行保存・不正入力、NDGR ID/会員種別、YouTube payload、遅着同期の回帰を追加した。Chrome合成回帰は [修正記録](review-fixes-2026-11-15.md) と [ブラウザ手順](../operations/browser-verification.md) を参照。

同日のFirefox修正の独立レビュー後には、起動キャンセル・別runtimeの別窓所有権・WXT無効化・PiPの遅れて届いた応答を回帰に追加した。単体/結合等59件、Chrome E2E 21件、Firefox合成20件が成功。Firefox検査はローカルBiDiランナーによる実行で、常設CIや実サイト・実Document PiPの保証とは区別する。[検証記録](firefox-verification-2026-11-15.md)を参照。

後続のTwitch再発防止では、ドラッグ/resizeと保存通知、段階描画・再利用行、公式iframeのOFF/ON、初回後の弾幕継続、予約NGと破棄データ解放を追加した。単体/結合等59件、Chrome 28件、Firefox合成22件が成功し、対象の独立再レビューも解消確認済み。[Twitch検証記録](twitch-verification-2026-11-15.md)を参照。ユーザーの実サイト改善確認と合成検証を分けて扱う。

全体レビューR01–R21は修正後の[独立再レビュー](r21-rereview-2026-11-15.md)で全件解消・新規指摘0を確認。ストア公開や実サイト合格の代替にはしない。

新しい送信失敗文言 `sendFailed` 等は日英を実装し、他42言語は既存の英語フォールバック方針で明示的に管理する（対象7キー: `playerToggleOn`、`playerToggleOff`、`sendFailed`、`popoutAnyPage`、`popoutAlwaysOnTopHint`、`panelPinOnTop`、`popoutAlwaysOnTopUnavailable`）。誤訳を作る代わりに英語フォールバックを返す判断であり、これらを翻訳済みとは報告しない。今後の不足を自動追認するルールではない。

- [locale-fallbacks.json](locale-fallbacks.json): 翻訳が無いキーの明示的な欠落リスト（294件）。英語へフォールバックし、翻訳済みとは数えない。新たな不足を自動追加せず、翻訳または明示判断を行う。翻訳が追加されたら不要な例外を削除する。
- [manifest-baseline.json](manifest-baseline.json): 現行出力の回帰基準（権限・ホスト・コマンド・資産）。ISS-001 決定後のホスト表と一致する前提。差分の意味を判断せず機械的に基準を書き換えない。最低ブラウザ版・同期目安は[ISS-005](issues.md#iss-005)。

## 未導入

| Phase | 項目                              | 予定・制限                                                                                                                                                 |
| ----- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4     | PRごとのCI再検証・リリース承認    | 初回 `verify-windows`（run `43695401625`）と保護設定は2026-11-15実施済み。最新未コミット変更のPR実行と人間の承認は残る                                   |
| 5     | 同梱 Chromium と CI での実行     | E2E は実装し、Chrome 157 で実行した。同梱 Chromium 158 は端末の署名ポリシーにより実行できない（ISS-012）。代替環境の成功は、同梱 Chromium の合格には含めない。 |
| 5     | Firefox常設CI・実サイト・手動確認 | 常設コマンド `test:e2e:firefox` は導入済み（通常verify外）。CI必須化と実サイトは未実施。2026-11-15の広範囲合成記録は[記録](firefox-verification-2026-11-15.md)。内部ログはISS-015 |
| 5     | アクセシビリティの手動・適合確認  | 自前UIの明暗axeと一部キー操作は自動化。スクリーンリーダー・拡大等の手動確認と正式適合目標は未決定                                                          |
| 5     | 性能・同期保証                    | 件数・機器等の測定条件と人間が確認した基準が必要。現在の単体テストは性能保証ではない                                                                       |

依存はpackage.jsonとlockfileで再現し、Node/pnpm要件は[開発手順](../operations/development.md)を参照する。外部ライブサイトを通常検証の唯一の根拠にせず、匿名化fixtureと実機確認を組み合わせる。fake-browser結合は実ブラウザ検証ではない。

## 変更ごとの適用

- 日本語の文章: `pnpm.cmd check:japanese` で文体と意味の変化の候補を確認し、原文と照合する。[校閲手順](../operations/japanese-proofreading.md)
- 文書・Skillsだけ: `check:docs`と内容の整合性確認。無関係なビルドは必須ではない。
- コード・設定・ハーネス: 統合verifyに加えて影響する手動検証。検査器の変更には意味のある負例も確認。
- DOM・ライフサイクル: SPA、繰り返し起動/停止、監視解除、全画面、サイト/モード別確認。
- 権限・通信・公開: [セキュリティ](../operations/security.md)、[公開手順](../operations/release.md)を併用。

カバレッジ値や空のテストで品質を代用しない。状態は成功・失敗・未実行・実行不能・対象外を区別し、対象外には根拠を付ける。重大な脆弱性やCritical/Major/Minorが残る場合はマージ・公開可能としない。独立レビュー・人間の判断は別条件であり、verify成功だけで代用しない。
