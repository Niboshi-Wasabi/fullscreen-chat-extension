# Phase 5: ブラウザ実行・観測基盤

## 目的・背景

ユーザーの「次どうぞ」に基づき、ビルド成功だけでは検出できない拡張の実行・UI・ライフサイクルをChromium上で検証する。[全体計画](2026-11-14-harness-foundation.md)と[品質基準](../quality/standards.md)を参照。

## 対象範囲・対象外

Playwright同梱Chromiumへの拡張ロード、設定保存・言語・キーボード操作、合成YouTube通常コメントページのパネル/NG/全画面/再有効化、axe自動検査、失敗時のtrace/画像/ログ、ローカル測定記録、CIファイルへの接続が対象。

実サイト・ログイン・実投稿・Firefox拡張の自動化・macOS保証・性能数値の保証・GitHub実行・公開は対象外。ブラウザの個人プロファイルを使わず、未決定の品質数値をテストの正解にしない。発見したUIの既存原則違反は最小限の修正と再検証を行い、要求の矛盾は台帳へ残す。

## 設計・依存・変更対象

- Playwrightとaxeを固定版で導入。公開待機期間に抵触する版は選び直し、例外を追加しない。
- production manifestを変えず、許可済みYouTube URLへの要求を合成HTMLで置換し、その他の外部通信を遮断する。DOMはテスト用の最小fixtureであり、実サイト互換性の保証ではない。
- 各テストは専用の一時永続コンテキスト。実際のservice workerとstorage APIを使い、製品コードへテスト専用APIを追加しない。
- Playwrightブラウザは `.harness-tools/playwright/`、結果は `.harness-artifacts/`。ブラウザ本体・プロファイル・証跡はGit対象外。
- axeの自動検査で確認した問題は既存UI原則に沿って修正。自動検査の通過をWCAG全体の適合証明やスクリーンリーダー実機確認としない。
- 性能は固定fixtureで測定値と環境を保存するが、未決定のCPU/メモリ/同期閾値による合否は付けない。

## 手順と依存関係

1. 既存DOMと実行経路を読み、依存・ブラウザを導入する。
2. fixture・Playwright設定・分離コンテキスト・証跡保存を実装する。
3. 自前UIとcontent scriptの実行を確認し、実在する不具合は最小修正する。
4. 統合verify・CIへ追加し、既存検証とセキュリティ検査を実施。
5. 自動化した範囲とFirefox/実サイト等の未検証を運用文書と台帳へ同期。

## リスク・復旧

ヘッドレス拡張・全画面API・Windowsのプロセス制限による実行不能をテスト失敗と区別して記録する。fixtureを実サイトの証明にしない。ブラウザ生成物の削除は解決済み絶対パスが専用一時領域内であることを確認する。アプリ変更が必要なら変更前を保持し、テストを弱めて通過させない。

## 検証・完了条件

production拡張を実際にロードし、storage・View・DOMの観測可能な結果を検証する。実行失敗は非ゼロ終了。結果JSON/JUnit、失敗trace/画像/ログを保存し、既存回帰・型・lint・両ビルド・workflow検査が成功する。Firefox/実サイト/性能保証・独立レビューが未実施なら公開可能とは判定しない。

## 進捗・証跡

- 調査: Playwrightの拡張検証はChromium永続コンテキストを使う。Firefox結果へ読み替えない。
- Playwright 1.65.1は公開待機期間に抵触し導入を拒否。1.65.0とaxe 4.14.0を固定して導入し、待機期間例外は追加していない。
- 同梱Chromium 158.0.8127.18は0xC0E90002で起動失敗。通常権限での再実行も同じ。読み取り確認したWindows Code Integrityイベント3077/3033はchrome_elf.dllの署名拒否を示した。OSポリシーは変更せずISS-012に記録。
- 署名済みChrome 157.0.8103.52の専用プロファイルとブラウザCDPで拡張ロードを実証。最初の3機能テストが成功し、axeが入力名欠落を検出。42入力に可視ラベルとの静的aria-labelledbyを追加し、明色の選択カテゴリ文字を既存の前景色へ修正した。
- 画像確認でMaterial Symbolsの未収録グリフを発見。新しい幅検査がdownload/upload/restart_altの単語表示を検出する負例を確認。使用中26アイコンで公式woff2を再取得し、4236バイト、SHA-256 b3c3ee3770ea2d5991eb674f6497f6a59abfcdf6e79a6f71d726462e15f30788。出典とApacheライセンスを保存。実行時の外部フォント通信は追加していない。
- `pnpm.cmd verify:chrome`: 14ステップ成功。7ファイル43回帰テスト + Chrome E2E 5件が成功。型/lint/format/workflow/構造/locale/両ビルド/manifestも終了0。E2Eの明暗axeはpopupとoptions全5カテゴリを検査し、自動検出違反0。CIがChromium E2Eと全履歴検査を省略しないプロファイルテストも追加。
- `pnpm.cmd verify:security`: audit全重大度0、作業ファイル秘密情報検出0、終了0。Git履歴はunavailableのまま。
- 合成100コメントで表示上限100を確認。最終観測の表示確認到達492 ms、CDP TaskDuration差分0.483097 s、JSHeapUsedSize 5662992→4395960 bytes。測定値はプロトコル往復・GC・端末等の影響を含み、性能保証や合否閾値にしない。未決定の品質目標はISS-005のまま。
- 画像の目視確認を行い、失敗時のtrace/画像/診断出力も実際のラベル・アイコン検出失敗で確認した。アプリの表示変更はラベル関係・選択文字色・同梱フォントとライセンスだけ。元ファイルは `.harness-artifacts/phase5-baseline/` に保持。
- 証跡: `.harness-artifacts/verify-phase5.log`、`verify-results.json`、`test-results.xml`、`e2e-results.json`、`e2e-junit.xml`、`e2e-report/`、`e2e-results/`、`security-phase5.log`。Git対象外。今回の確認は自己確認であり独立レビューではない。

## 未解決・次の作業

GitHub未作成、独立レビュー、対応版/性能/同期保証は既存の未決定を維持。実サイト・Firefoxは公開前の手動確認を残す。

同梱ChromiumとGitHubランナー実行、Firefox/実サイト、正式アクセシビリティ適合、性能保証が未実証のためPhase 5全体や公開準備完了とは判定しない。合成負荷の評価はISS-013で追跡する。
