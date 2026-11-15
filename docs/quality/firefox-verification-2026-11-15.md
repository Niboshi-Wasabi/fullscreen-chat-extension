# Firefox検証記録（2026-11-15）

最新判定: **履歴復元・終了処理を修正し、独立レビューで追加された3指摘にも対応。Firefox合成20シナリオが成功し、拡張contentの終了タイムアウトは0件。Firefox内部のログは一部残る（ISS-015）**。実サイト・手動操作を含む公開可否の判定ではない。

## 独立レビュー後の再検証（同日14:49 JST）

別コンテキストのレビュー担当がMajor 3件を再現したため、以下を追加修正した。範囲は[修正計画](../plans/2026-11-15-firefox-lifecycle-fixes.md)のFR01〜FR03。

- controllerから各site runtimeへAbortSignalを渡し、古い設定読み込みが停止後に完了しても、画面・受信・別窓を起動しない。
- WXT context無効化時に、各content分岐のライフサイクルを永久停止する。停止中の履歴復元でも古いインスタンスは再起動しない。
- 停止後のPiP応答からOS別窓へフォールバックしない。PiP要求を共有し、close後の遅着windowは閉じ、新しい要求のwindowを保持する。

`pnpm.cmd verify:chrome` は終了0、統合14段階・単体/結合等59件・Chrome E2E 21件が成功。Firefoxの `node .harness-artifacts/firefox-next/verify-firefox.mjs` も終了0、production拡張の20件が成功（14:48:51〜14:49:02 JST）。拡張contentの終了タイムアウトは0件。Firefox内部のstderrは前回同様5行残り、ISS-015の調査範囲を維持する。

恒久回帰は、旧設定読み込みと新runtimeの別窓所有権・停止後のPiP失敗の結合2件、controllerのsignal中断1件、content無効化・再注入1件、PiP遅着成功と新window保持のChrome E2E 1件を追加。PiP/無効化の追加検証はDOM・APIスタブを含み、実Document PiPやHMR実機の成功には読み替えない。

証跡: `.harness-artifacts/firefox-next/verify-chrome.log`、`browser/results.json`、`browser/browser.log`、開始時の全文とハッシュ `before-source.json`。独立レビューの独自再現は `.harness-artifacts/firefox-review/`。全体レビューR01〜R21の再レビューと実サイト・実IMEは、この作業の対象外として残す。

[独立レビュー・再レビュー記録](firefox-lifecycle-review-2026-11-15.md): Major 3件すべての解消、新規Critical/Major/Minor指摘なしを確認。レビュー対象14ファイルのハッシュは最終時点でも一致。これはFirefoxのライフサイクル修正範囲の確認であり、全体レビューや公開承認を代替しない。

popupのキー操作は別途、browser.windows/tabs APIでフォーカスを試したが、headlessの `document.hasFocus()` がfalseのまま、trusted keydown/upのみ到達して既定のclickが発生しなかった。`.harness-artifacts/firefox-keyboard/results.json` の試行は失敗として保存し、popupキーボード操作を合格に加えていない。現時点で製品不具合と断定せず、通常ウィンドウでの確認を残す。

## 修正後の再検証（同日14:38 JST）

[修正計画](../plans/2026-11-15-firefox-lifecycle-fixes.md)に基づき、以下を変更した。後続の「対象と方法」以降は14:24時点の初回検証の記録であり、当時は製品コードを変更していない。

- **履歴復元後にパネル・受信が停止する不具合**: 変更前はYouTubeから離れてBFCacheで戻るとパネルが消失した。contentのpagehideだけで停止していた処理を、共通のpageshow/persistedによる再起動と対にした。YouTubeトップ/iframe、Twitch、ニコ生、Twitch公式チャットに適用し、コマンド購読も停止・再購読する。
- **YouTube終了時のcleanup中断**: JavaScriptのイベント解除ループ位置で `Script terminated by timeout` が発生し、後続stopへ到達しないログを観測した。ナビゲーション2購読をAbortControllerの一括解除に変更。変更前5件だったタイムアウトは、修正後の20シナリオを2回実行していずれも0件。エンジン内部で中断する理由まで確定したものではない。

| 検証 | 結果 |
|---|---|
| `pnpm.cmd verify:chrome` | 終了0、統合14段階・単体/結合等55件・Chrome E2E 20件成功 |
| `node .harness-artifacts/firefox-fixes/verify.mjs` | 終了0、Firefox 160のproduction拡張で20/20成功 |
| 最終Firefox実行 | 2026-11-15 14:38:10〜14:38:20 JST |

従来15件に加え、YouTube通常コメント、YouTubeリプレイiframe、Twitch、ニコ生、Twitch公式チャットで各2回、**実際の履歴移動と `pageshow.persisted === true`** を確認した。復元後の受信/NG・ON/OFF・単一パネルを検査した。恒久回帰として、共通ライフサイクルの単体2件と、production拡張の合成pagehide/pageshow・停止中設定変更・重複復元イベントのChrome E2E 1件を追加した。

修正後の証跡は `.harness-artifacts/firefox-fixes/` の `results.json`、`browser.log`、`verify.mjs`、`verify-chrome.log`。変更前は `before-results.json` / `before-browser.log`、ライフサイクルだけ修正した段階は `lifecycle-results.json` / `lifecycle-browser.log` に保存した。履歴移動で発生したfavicon要求10件は拒否され、実サイトには送っていない。

残るstderrは5行（Firefox Remote Agentのcontext消失1、ContentPrefsのshutdown 1、Conduits/RunListener中断3）。合格フラグと別にすべて記録している。製品コードを含まないstorage通知中のiframe破棄だけの最小拡張でも、10回の操作で同じRunListener中断を10行再現した（`.harness-artifacts/firefox-conduit/`）。このログは製品拡張固有ではない。最小構成ではFirefox自身のPictureInPictureChildにもdead objectログが出た。これらを隠す変更やAPI待機時間の恣意的な引き延ばしは行っていない。

拡張なしの全画面入退場・終了3回ではContentPrefsエラーを再現しなかった（`.harness-artifacts/firefox-no-addon/`）。context/ContentPrefsの発生条件と通常手動終了での比較は未確定のため、ISS-015は調査継続。popupの信頼されたキー操作・実IME・実サイト・Document PiPの未検証も引き続き残る。自己確認であり、独立レビューは未実施。

## 対象と方法

- Windows、インストール済みFirefox 160.0、build ID `20261104181552`、headless。
- レビュー修正後のproduction出力 `.output/firefox-mv3` をWebDriver BiDiの `webExtension.install` で一時読み込み。実際のbackground・content・popup・options・ニコ生別窓を使用した。
- 個人プロファイルや認証情報を使わず、専用の一時プロファイルを作成。検証後にブラウザを終了し、プロファイルを削除した。
- YouTube・Twitch・ニコ生の許可済みHTTPS URLへの要求を合成HTMLで応答し、それ以外のページ要求は拒否する構成。実サイトへの投稿はしていない。ニコ生の送信成功は合成ページ内のボタン到達と入力クリアを確認したもの。
- Firefoxプロセスだけに `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` を設定して拡張ページを検査。個人プロファイル・OSの署名ポリシーは変更していない。[MozillaのSystem Access説明](https://firefox-source-docs.mozilla.org/remote/Security.html)と[一時拡張読み込み](https://firefox-source-docs.mozilla.org/remote/webdriver-bidi/Extensions.html)を参照した。
- 製品ソース・設定・既存テストは変更なし。前回のハッシュ記録との比較で対象コード・設定の差分0件。検査ランナーはローカル証跡領域のみで、常設CIには未導入。

## コマンド・証跡

| 実行 | 結果 |
|---|---|
| `pnpm.cmd build:firefox` | 終了コード0 |
| `node .harness-artifacts/firefox/verify.mjs` | 終了コード0、15/15機能成功。ただしstderr警告あり |

最終実行: 2026-11-15 14:23:53〜14:24:02 JST。ブラウザの起動にはこの端末の実行サンドボックス外での実行を使用した。

ローカル証跡（Git対象外）: `.harness-artifacts/firefox/results.json`、`browser.log`、`verify.mjs`、代表画面PNG、`.harness-artifacts/firefox-build.log`。結果JSONの総合状態は `functional-checks-passed-with-teardown-warnings`。`passed: true` は機能アサーションの成功であり、警告0件の意味ではない。

## 成功した機能検証

| # | 対象 | 確認した結果 |
|---|---|---|
| 1 | 拡張起動 | 一時読み込み、background設定API、session/windows API、commands登録 |
| 2 | popup | DOMクリックによるON/OFF、日本語切替、再読込で保存維持、サイト別トグルの描画 |
| 3 | options | NG語入力・保存・再読込 |
| 4 | YouTube通常コメント | 受信・NG、弾幕禁止、無効化後の履歴復元、SPAイベント重複時のruntime単一性 |
| 5 | 入力 | 合成isComposingイベントで下書き保持、失敗時の下書き・エラー表示、フォーカスコマンドのメッセージ到達 |
| 6 | 全画面 | Firefox Fullscreen APIで入退場、パネルの再配置 |
| 7 | YouTubeリプレイ | 実content script間のiframe受信、偽装メッセージ拒否、巻戻しで表示消去 |
| 8 | YouTubeライブ | 弾幕の表示と無効化時の解除 |
| 9 | Twitch | 同文・異なるIDの2件を受信、無効化後の履歴復元 |
| 10 | Twitch公式別窓相当ページ | 一般視聴者のNG、モデレーター保護、無効化時の復元 |
| 11 | ニコ生 | DOM受信、設定変更時のNG再適用 |
| 12 | ニコ生別窓 | 実windows APIで作成・コメント中継・合成UIへの送信・終了、480×720のサイズ保存と再オープン時の復元 |
| 13 | 管理元のないニコ生別窓 | 合成IMEイベントと送信失敗で下書き保持 |
| 14 | 設定境界 | 2つのproduction optionsからの並行保存で別フィールド維持、不正バックアップ拒否・保存不変 |
| 15 | ライフサイクル | 通常タブでYouTube→空ページ→YouTubeを3往復後も応答 |

## 警告・未検証

最終実行のstderrに抽出対象の警告・エラー8行を記録した。うち5行はタブ終了時の拡張content scriptに対する `Script terminated by timeout`。ほかにFirefox内部のcontext消失、ContentPrefsのshutdown、ConduitsのRunListener中断がある。BiDiコマンド失敗と `log.entryAdded` のJavaScriptエラーは0件だが、stderrの問題を除外して「エラーなし」とは判定しない。

通常ページ遷移の3往復と機能アサーションでは停止・失敗を再現していない。拡張cleanup、BiDiによるタブ破棄、Firefox自身の処理のどこに原因があるかは未確定。通常の手動タブ終了との比較・最小再現が次の確認（[ISS-015](issues.md#iss-015)）。

Firefox 160のBiDiではmoz-extensionページへの `browsingContext.activate` がprivileged scope非対応となった。popupはDOMクリックで検証し、信頼されたキーボード入力によるトグル操作の合格には数えていない。OSショートカットそのもの、実IMEの変換・確定、ツールバーから開くpopup、スクリーンリーダーも未確認。

実サイトの現行DOM・ログイン・配信受信・実メディア同期・実投稿、ニコ生NDGR/タイムシフト、実Document PiP、最低対応版、macOS、署名・AMO提出は未検証。Document PiP名の存在検査は、実際のウィンドウ生成成功を保証しない。合成ページでの受信成功を実サイト全体の対応保証に読み替えない。
