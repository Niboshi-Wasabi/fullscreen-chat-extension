# Firefoxのページ復元・終了処理修正

状態: 独立レビューのMajor 3件を追加修正、回帰成功・独立再レビューで解消確認済み。ユーザーのFirefox検証後の修正依頼に基づく。

## 目的・対象

ISS-015の終了時警告を調査し、再現した製品不具合を修正する。追加検証でYouTubeから移動して履歴で戻ると、BFCache復元後にパネルがなくなることを確認した。contentのpagehideで停止し、pageshowで再開しないことが原因。

対象はcontentのライフサイクルとその回帰検証。権限・保存形式・サイト仕様を変更しない。実投稿・公開・有料導入は対象外。

## 設計・変更対象

- contentの各起動関数が停止関数を返し、共通のpagehide/pageshow管理から停止と再開を対にする。YouTubeトップだけでなくTwitch・ニコ生・公式チャットフレームにも適用する。
- 再開時には新しいruntime controllerを作り、停止済みの非同期起動を既存controllerの世代管理で破棄する。command購読も停止時に解除し、再開時に1本だけ購読する。
- `src/app/page-lifecycle.ts`、`src/entrypoints/content.ts`、単体・ブラウザ回帰を変更する。
- タブ終了警告は最小拡張との比較で原因を切り分ける。警告の削除や握りつぶしで合格にしない。

## 手順・リスク・検証

1. 変更前のFirefox合成15件とBFCache再現結果を証跡へ保存。
2. 共通の停止/復元処理を実装。重複購読、停止後の遅着起動、フレーム再開を検査。
3. 単体回帰・統合verify・Chrome回帰とFirefox production拡張を検証。
4. 結果と残るFirefox内部警告・未検証をISS-015と検証記録へ反映。

再開時の二重起動と、旧runtimeの非同期停止が新runtimeのDOMを消す競合に注意する。BFCache復元の実確認と設定反映・NG・単一パネルを完了条件とする。独立レビューは別セッションで必要。

## 進捗・証跡

- 変更前: `.harness-artifacts/firefox-fixes/diagnose.mjs` / `results.json`。従来15件は成功、履歴復元後パネル存在チェックが失敗。
- 最小拡張: `.harness-artifacts/firefox-minimal/`。pagehideの2要素ループ解除と直接解除を各3回行って警告0件。for-of単独を原因とは確定しない。
- 診断ランナーの追加拡張installはtimeout。製品拡張のuninstallで最後の拡張ページが閉じた後の診断であり、独立した最小拡張用プロファイルに分離して再実行した。
- 共通ライフサイクルと各content起動経路の停止/復元、コマンドの再購読を実装。YouTubeのナビゲーション2購読はAbortControllerで一括解除し、停止前のJSループ中断を回避。
- `pnpm.cmd verify:chrome` 終了0。統合14段階、単体/結合等55件、Chrome E2E 20件成功。新規回帰は単体2件・合成ライフサイクルE2E 1件。
- Firefox 160のproduction拡張で従来15件と5経路の実BFCache復元を確認、20/20成功を2回記録。拡張contentの終了タイムアウトは各0件。各経路で履歴復元2回後の受信・NG・設定反映と単一パネルを確認。
- 残るRunListener中断は製品なしの最小拡張でも10回再現。Firefox内部context/ContentPrefsのログは調査継続（ISS-015）。履歴復元の修正はISS-016。実サイト・実IME・popupの信頼されたキー入力・独立レビューは未実施。
- 詳細と証跡の所在は[Firefox検証記録](../quality/firefox-verification-2026-11-15.md)を正本とする。次の担当はISS-015の通常手動終了との比較、ISS-016の独立レビューを行う。

## 独立レビュー後の追加修正

別コンテキストのレビュー担当が関連コードを直接確認し、DOM/APIをスタブ化した実ソース実行でMajor 3件を再現した。実装担当の自己確認とは区別する。記録・再現はローカル `.harness-artifacts/firefox-review/`。

| ID | 指摘と修正 |
|---|---|
| FR01 | 停止済みの設定読み込みが遅れて完了し、新runtimeの管理別窓を閉じる。controllerからactivationごとのAbortSignalを各site runtimeへ渡し、loadSettings後・副作用前に中断判定する。restart/stopで即abortする |
| FR02 | WXT再注入時に旧購読が残る。main(ctx)の全起動分岐で共通ライフサイクルの永久停止をctx.onInvalidatedへ登録する |
| FR03 | PiP保留中の停止後に、遅着失敗でOS別窓が復活する。active runtimeの停止・PiP要求世代を完了callbackで検査する。PiP controllerも保留要求を共有し、close後の遅着成功windowは閉じ、新要求のwindowを保持する |

保存形式・権限・依存を変更しない。変更対象をruntime-controller/site-runtime、4つのsite wrapper、content、PiP view、関連回帰へ拡張する。旧設定読み込みの解決順序、新旧windowの逆順応答、無効化中のpageshowを固定条件で検証し、Firefox合成20件も再実行する。再レビュー結果と残るISS-015/実サイト確認を分けて完了報告する。

最終結果: `pnpm.cmd verify:chrome` 終了0（14段階・単体/結合等59件・Chrome E2E 21件）。修正後Firefox production合成20件も終了0、content timeout0、既知内部ログ5行は継続。[独立再レビュー](../quality/firefox-lifecycle-review-2026-11-15.md)で3件の解消・新規指摘なしを確認。対象14ファイルはレビュー後変更なし、SHA-256を最終照合した。ISS-016は解消確認、ISS-015の通常手動終了との比較と実サイト・実IME・実HMR・実Document PiP、全体R01〜R21の再レビューは残る。
