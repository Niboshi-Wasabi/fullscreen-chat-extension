# Chrome合成デバッグ記録（2026-11-17）

[デバッグ手順](../operations/debugging.md)に基づく検証。Windows UI操作は現在URLの判定失敗で停止したため、ユーザーの代替手段実行依頼により、インストール済みChromeの専用プロファイルで既存E2Eを実行した。

## 対象と環境

- 対象: HEAD `889116b378ab11357544f9fd8e83aadfb0bbf52c` と実行時の既存未コミット変更一式。HEAD単独の検証ではない。
- Windows、Chrome `157.0.8103.79`、Node `v22.23.2`、Playwright `1.65.0`。Chromeはheadless、各テストで専用プロファイルを使用。
- 既存のソース・設定・テストは変更せず、production拡張を再ビルドした。
- 合成データのみを使用し、個人プロファイル・認証・実投稿は使用していない。

## 実行結果

| コマンド | 終了コード | 結果 |
|---|---|---|
| `pnpm.cmd build` | 0 | `.output/chrome-mv3` 生成成功 |
| `pnpm.cmd test:e2e:chrome` | 0 | 34件成功、失敗・skip・flaky 0件、51.4秒 |

- 設定保存、日英切替、並行保存、不正バックアップ拒否、明暗のaxe検査を確認。
- YouTube合成ライブの受信・NG・全画面・再有効化、既知iframe境界、巻戻し・高速シーク・SPA切替、初期弾幕抑制、通常動画／Shortsの非起動を確認。
- Twitch合成DOMで遅延描画・行再利用、NG・モデレーター保護、公式iframeのOFF/ON、ドラッグ・resize、弾幕継続・状態解放、VODの重複排除と時刻同期を確認。
- IME・送信失敗時の下書き保持、PiPの遅れて完了する処理等を確認。ただし一部経路は原本モジュールの変換実行とAPIスタブを使用する（[保証範囲](../operations/browser-verification.md)）。
- 34件の診断JSONを集計し、ページ例外0件、コンソールwarning/error 0件、テストの通信遮断記録0件。実行ランナーには `NO_COLOR` / `FORCE_COLOR` の表示用警告があるが、ブラウザ内エラーではない。
- 合成100件投入で100行を維持し、表示確認まで323.5 msを観測。単一実行の計測であり、実サイトの性能保証ではない。

## 証跡と制限

ローカル証跡は `.harness-artifacts/e2e-results.json`、`.harness-artifacts/e2e-junit.xml`、`.harness-artifacts/e2e-report/`、`.harness-artifacts/e2e-results/`。診断JSON、合成画面画像、axe結果、負荷観測を保存した。これらは次回E2Eで更新される。今回の成功実行では失敗時用トレースの保存条件に該当しない。

今回の合成E2Eでは不具合を再現しなかった。実サイトのDOM・認証・公式iframe制約、実メディアとの同期、実Document PiP、実投稿、Firefox、通常Chromeウィンドウの手動操作は未検証。統合 `verify` は今回未実行で、静的検査や両ブラウザビルド全体の合格を示すものではない。

次の実サイト確認は[実サイトチェックリスト](site-verification-checklist-2026-11-15.md)に従う。本記録は独立コードレビューやマージ・公開承認ではない。
