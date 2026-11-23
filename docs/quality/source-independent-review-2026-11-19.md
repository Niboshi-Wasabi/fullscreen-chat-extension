# ソース独立レビュー（2026-11-19）

状態: 以下の初回独立レビューを履歴として保持する。2026-11-19の再確認でもR1–R4は残存し、オーナーの明示依頼に基づいて同担当が修正へ移行した。修正後は独立レビューではなく自己確認として末尾へ記録する。

## 対象・独立性

比較元はHEAD `889116b378ab11357544f9fd8e83aadfb0bbf52c`、対象は現在の未コミット変更・新規ファイルを含む製品ソースとハーネス。仕様は[PRD](../prd.md)、[設定一覧](../settings-inventory.md)、[構造](../architecture/overview.md)、[品質基準](standards.md)、[コード原則](code-principles.md)、関連計画・問題台帳に照合した。

製品実装はこのレビュー担当が変更していない。このチャットで以前作成したChrome確認記録・Firefoxハーネス計画は独立レビューの対象外。ソース差分と関連する受信、NG、表示、別窓／PiP、設定、ライフサイクル、ハーネスを直接確認した。全行の網羅的な保証や実サイトでの再レビューではない。

レビュー時のソース・scripts・testsのSHA-256はローカル `.harness-artifacts/review-2026-11-19/source-hashes.json` に保存。ソース・設定・既存テストは修正せず、診断スクリプトはGit対象外の同ディレクトリへ保存した。

## 指摘

### R1 — Major / P2: Twitch公式チャットのNGが本文の先頭断片しか検査しない

- 位置: [native-chat-ng.ts](../../src/app/native-chat-ng.ts) 172–179行付近。
- 条件: `chat-line-message-body` が無い行で、本文が複数の `.text-fragment` に分かれ、後半にNG語がある。
- 根拠: `querySelector(".text-fragment")` は最初の1要素だけ返す。合成入力 `safe forbidden` から実際のparserが `safe` のみを返し、NG語 `forbidden` の判定がfalseとなることを再現した。
- 影響: 自前パネル／弾幕側のアダプタは断片を結合する一方、公式パネル・公式別窓では同じNGがすり抜け、モード横断のフィルタ仕様に反する。比較元から残る問題であり、今回の差分だけが導入した回帰とは扱わない。
- 修正方針: アダプタと本文抽出を揃え、全断片・絵文字を含めて判定する。複数断片の後半だけにNG語がある公式チャット回帰を追加する。

### R2 — Major / P2: Twitch公式チャットへログイン名による除外が伝わらない

- 位置: [native-chat-ng.ts](../../src/app/native-chat-ng.ts) 167–195行付近。
- 条件: 表示名がログイン名と異なる利用者について、`blockedUsers` にログイン名を設定する。
- 根拠: アダプタが読む `.chat-author__intl-login` を公式NG側は読まず、`authorLogin` を渡さない。表示名 `表示名`、login `blocked_login` の行で、loginを除外しても実際のparser＋filterがfalseを返すことを再現した。
- 影響: 自前表示では除外できる利用者が公式表示には残る。R1とは別に作者識別情報の欠落が原因。比較元からの残存問題。
- 修正方針: 同じ作者識別情報を両経路へ渡し、表示名とloginが異なるケースでモード横断の回帰を追加する。

### R3 — Major / P2: PiPの公式チャット拒否がフォールバックへ接続されていない

- 位置: [site-runtime.ts](../../src/app/site-runtime.ts) 244–258行付近、[pip-chat/index.ts](../../src/views/pip-chat/index.ts) 210–217行付近。
- 条件: ネイティブ表示のPiP内iframeが、読取り可能な「Chat is disabled」を返す。
- 根拠: PiP controllerは文言を検出して `onNativeChatRejected` を呼ぶが、実際のruntime生成箇所がそのcallbackを渡していない。callback無しの原本controllerでloadイベントを発生させ、`list.hidden=true`、公式frame表示のままであることを再現した。自前メッセージの追加でもnativeモードは解除されない。
- 影響: パネルにある[ISS-022](issues.md#iss-022)のフォールバックがPiPでは機能せず、チャット面を使えない。これはスタブでの結線確認であり、特定配信の実Document PiP再現ではない。
- 修正方針: PiP拒否状態をruntimeへ通知してnative URLを解除し、自前一覧を表示する。次のpublishでnative URLを再設定しないことも検証する。

### R4 — Minor / P2: 開いているPiPに入力欄ON/OFFの変更が反映されない

- 位置: [pip-chat/index.ts](../../src/views/pip-chat/index.ts) 181–192行付近、[site-runtime.ts](../../src/app/site-runtime.ts) のsettings購読経路。
- 条件: 自前一覧のPiPを開いたままOptionsで `compose.enabled` を変更する。
- 根拠: PiPは作成時の `loadSettings()` でしか値を取り込まず、settings購読や設定適用APIがない。runtimeの通知も既存PiPにはメッセージを渡すだけ。ONで開き、保存設定をOFFへ変え、再publish相当の `setMessages` と既存窓への `open` を呼んでもformは表示のまま、設定読込み回数1であることを再現した。逆方向も開き直すまで反映されない。
- 影響: 設定一覧の「パネル／別窓で入力欄を出す」と開いている窓の動作が一致しない。
- 修正方針: settings通知からPiPへ最新設定を適用する。既存窓を閉じずON/OFF両方向が反映される回帰を追加する。

上記の原本実行はローカル `reproduce.cjs` と `reproduction-results.json` を参照。NGは原本parserとfilter＋合成Element、PiPは原本controller＋Window／DOM／設定スタブを使用。製品ファイルにはテスト用公開APIを追加していない。

## 検証

| 方法 | 終了コード | 結果 |
|---|---|---|
| `pnpm.cmd verify`（2回） | 1 / 1 | いずれも131/132件成功。`content-invalidation.test.ts` がVitest SSR一時ファイルのENOENTで失敗。prepare・tools・workflow・docs・locale・format・lint・型は成功。後続4段階は未実行 |
| `pnpm.cmd exec vitest run tests/unit/content-invalidation.test.ts` | 0 | 同テスト単独は1件成功。全体実行時の原因は未確定、製品ライフサイクル不具合とは断定しない |
| `pnpm.cmd build` | 0 | Chrome出力を更新 |
| `pnpm.cmd test:e2e:chrome` | 1 | 33/34件成功。light popupのaxe color-contrastが4.07、期待4.5で失敗 |
| 同コマンド `--grep 'accessibility.*light'` | 0 | 単独再実行は成功。恒常的な配色不具合とは断定せず、描画・CSS遷移など計測時の状態を追加調査する |
| `pnpm.cmd check:architecture` | 0 | 依存違反なし |
| `pnpm.cmd build:firefox` | 0 | Firefox出力生成成功。実機成功ではない |
| `pnpm.cmd check:manifests` | 0 | 両出力検査成功 |
| `node .harness-artifacts/review-2026-11-19/reproduce.cjs` | 0 | R1–R4の不一致を診断JSONへ記録。0は診断完走であり製品合格の意味ではない |

初回E2Eの全文JSONは `.harness-artifacts/review-2026-11-19/e2e-initial.json`、axeエラーは `axe-initial-error.md` に保存した。通常のE2E結果領域は単独再実行の結果で更新されている。統合verifyの結果JSONには失敗と後続未実行が残る。

## 結論

Critical 0、Major 3、Minor 1。修正・再レビュー待ちであり、マージ／公開可能とは判定しない。統合テストとE2Eの全体実行に失敗があり、単独成功で全体成功へ読み替えない。

オンラインsecurity検査、同梱Chromium、Firefox実機、YouTube／Twitch実サイト、実IME、実Document PiPは今回未実行。過去の検証記録を今回の成功に加算していない。

## 再確認と修正（2026-11-19、自己確認）

オーナー依頼「再レビューを行った後、修正してください」に基づき、R1–R4の関連コードを読み直し、4件とも残存することを確認してから修正した。修正に移行したため、以降は独立レビューではない。[修正計画](../plans/2026-11-19-project-review-fixes.md)の追加再レビュー欄を参照。

| 指摘 | 変更と回帰 |
|---|---|
| R1 | 公式Twitch NGにも既存の本文・絵文字抽出を使用。全断片を結合し、本文コンテナの優先順位とVODの装飾コロン除去をアダプタに揃えた。production拡張E2Eで後半NG語、絵文字名、本文優先、VODコマンド、正常行とNG解除を確認 |
| R2 | `.chat-author__intl-login` を読み、括弧を除去したloginを共通filterへ渡す。同E2Eで表示名とloginが異なるユーザーの除外・解除を確認 |
| R3 | runtimeへPiP拒否callbackを接続し、自前一覧へ切替。同候補URLの再設定を防ぎ、URL変更時には再試行する。controllerのload通知単体とruntimeのフォーカス・URL変更結合を追加 |
| R4 | PiPが開いている間だけ設定を購読。入力欄ON/OFF・表示上限・ロケールを更新し、遅着初期読み込みみ／翻訳完了で新しい状態を上書きしない。ON/OFF両方向、遅着読込み、通常closeと利用者closeの購読解除を単体確認 |

追加したPiP／runtime回帰は修正前に失敗を確認した。単体テストのi18nはブラウザ言語APIをモックして検証環境を整えた。PiPはWindow・DOM・APIのスタブを用いており、実Document PiPの成功保証ではない。

修正後初回の統合verifyでも従来のSSR一時ファイルENOENTが発生した（135/136件成功）。`content-invalidation.test.ts` はiframeライフサイクルを検証するため、対象外のトップフレームruntimeとプレーヤーUIをテスト境界でモックした。iframeの起動・破棄・再注入のアサーションは維持し、テストのskipや成功条件の緩和はしていない。この分離後は統合verifyが成功した。Vitest内部の一般的な原因を確定したものではない。

最終ソースで `pnpm.cmd verify` は終了0、13段階すべて成功、19ファイル・136テスト成功。型・lint・format・文書・locale・依存構造・両ビルド・manifestを含む。`pnpm.cmd test:e2e:chrome` も終了0、35/35件成功（49.5秒）。前回のlight axeも全体実行で成功し、検査の無効化・閾値変更はしていない。今回変更したソース・テスト・計画に対する `git diff --check` も成功。作業ツリー全体には、既存文書3ファイルのMarkdown改行用末尾空白の警告があるため、その除去は行っていない。オンラインsecurity・実サイト・Firefox実機は今回未実施。

修正後の検証結果と変更ファイルのハッシュはローカル `.harness-artifacts/review-fixes-2026-11-19/`、E2E診断・画像等は通常の `.harness-artifacts/e2e-results/` に保存する。前回レビュー時のハッシュと証跡は上書きしない。

R1–R4は実装修正・自己確認済み。修正後の新しい独立レビューと人間の最終判断は待ちであり、マージ／公開承認ではない。
