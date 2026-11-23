# 別窓ショートカット・閉じたときの戻り・前面固定の見直し（2026-11-18）

状態: 実装済み・両ブラウザで実機確認済み。独立レビュー（2026-11-19、[記録](../quality/iss-027-033-review-2026-11-19.md)）の指摘を修正し、再レビューで Critical・Major・Minor 0。修正分は実機で未確認。

## 目的・背景

同日の実機確認で見つかった 3 件を、オーナーの判断に従って修正する。[ISS-030](../quality/issues.md#iss-030)、[ISS-031](../quality/issues.md#iss-031)、[ISS-032](../quality/issues.md#iss-032)。

- 別窓を開く `Alt+Shift+P` が Chrome のタブグループ操作と衝突する。
- 別窓モードのまま別窓を閉じると、拡張が開き直す。
- 「常に前面」をオンにしても、両ブラウザで普通の別窓になる。

## 対象範囲・対象外

対象: `open-popout` の既定キー、利用者が閉じたときの表示モード、Document PiP を開く操作と Firefox での表示。

対象外: 別窓の位置記憶、前面タブだけが別窓を持つ仕組み（ISS-028）。保存形式は変えない（`popout.alwaysOnTop` の意味だけ変わる）。PiP 窓の中身は当初対象外だったが、実機で空になる不具合が見つかり [ISS-033](../quality/issues.md#iss-033) として追加した。

## 変更対象・依存関係

- `wxt.config.ts`: `open-popout` から `suggested_key` を外す。
- `src/entrypoints/background.ts`: `windows.onRemoved` で管理中の窓なら `displayMode` をパネルへ。session storage の記録を検証して読む関数を `restoreManagedPopout` と共有する。
- `src/views/pip-chat/index.ts`: `close()` 以外で窓が閉じたら `onClosedExternally` を呼ぶ。
- `src/app/site-runtime.ts`: パネルの「前面に固定」でクリック内に PiP を要求し、表示モードを別窓へ。PiP が外から閉じたらパネルへ。ページ離脱中は戻さない。
- `src/views/overlay-panel/index.ts`: 歯車メニューに「前面に固定」。`alwaysOnTop` がオンで Document PiP があるときだけ出す。
- `src/entrypoints/options/*`、`src/ui/chrome.css`: Document PiP が無いとスイッチを無効にして説明を差し替える。
- 翻訳: `panelPinOnTop`、`popoutAlwaysOnTopUnavailable` を追加（英日以外は `locale-fallbacks.json`）。`popoutAlwaysOnTopHint` と `shortcutsHelp` を更新。
- 実機確認後の追加: `background.ts` は開く要求の前に記録した窓の存在を確かめ、消えていればパネルへ戻す。`site-runtime.ts` は PiP が断られたら表示モードが変わるまで通常別窓を保つ。`pip-chat` は公式チャット UI オンのとき公式チャットの iframe を出す（YouTube リプレイを除く）。`popoutAlwaysOnTopUnavailable` からブラウザ名を外した。

## 設計・判断・承認

オーナーが2026-11-18に選んだ案: 既定キーを外す／閉じたらパネルへ戻す／ページ内ボタンで PiP を開き Firefox では無効表示。実機で Firefox 160 にも Document PiP があると分かり、同日に「機能の有無で判定する」へ改めた。PiP の中身は、公式チャット UI がオンならパネルと同じ公式チャットを出す案をオーナーが選んだ。代わりの案（別キーへの割り当て、閉じたあと別窓モードのまま開き直さない、設定ごと削除）は採らなかった。

Document PiP は開く側のページでの利用者操作が要る。ポップアップやショートカットからはページに操作が渡らないため、そこから別窓にしたときは従来どおり通常の別窓へフォールバックする。

## リスク

- ブラウザ終了で別窓が閉じても、表示モードがパネルになる。
- 既存利用者に割り当て済みの `Alt+Shift+P` が更新後に残るかは未確認。
- PiP の要求と設定保存のあいだに別の設定変更が入ると、PiP がすぐ閉じて通常別窓になる余地がある。

## 検証方法・完了条件

自動: `pnpm.cmd verify`。追加回帰は `tests/integration/background-popout.test.ts`（利用者が閉じたときだけパネルへ、再起動後も判定）と `tests/integration/runtime-lifetime.test.ts`（クリック内で PiP を要求、PiP を閉じたらパネルへ）。

実機: Chrome と Firefox で、ショートカット設定に `open-popout` の既定キーが無いこと、別窓と PiP を閉じるとパネルに戻ること、ボタンから前面固定の窓が開くこと、Twitch のページ側を折りたたんでも PiP にチャットが出ること。

## 進捗・検証証跡

2026-11-18: 実装と回帰テストを追加。`pnpm.cmd verify` は終了コード 0（13段階すべて成功、単体・結合 92 件）。両ビルドの manifest で `open-popout` に既定キーが無いことを確認。実機確認は未実施。

2026-11-18 22〜23時台: Chrome 157 と Firefox 160 の実機で確認（未ログイン、`twitch.tv/xqc`）。PiP が空になる不具合（ISS-033）と、Chrome で通常別窓を閉じても別窓モードが残る不具合が見つかった。どちらも修正し、回帰を足して `pnpm.cmd verify` が13段階すべて成功。修正後のビルドで、PiP と通常別窓の閉じ方、前面固定、PiP の公式チャットを両ブラウザで確かめた。結果は [Chrome 記録](../quality/chrome-project-mcp-2026-11-18.md)、[Firefox 記録](../quality/firefox-devtools-mcp-2026-11-18.md)、問題台帳の各項目。

## 未解決・次の作業

独立レビュー、英日以外の翻訳。`popoutAnyPage`（2026-11-19 に Twitch 限定の意味へ変更）と `popoutAlwaysOnTopHint` は、オーナー判断（2026-11-19）で翻訳待ちとし、42言語の [欠落リスト](../quality/locale-fallbacks.json) に登録した。各言語のファイルからは外し、表示は英語にフォールバックする。`scripts/locale-catalogs/rows.json` は以前から現行のキー数と合わず、生成スクリプトは使えない。実機で未確認: Chrome のショートカット設定画面、既存の `Alt+Shift+P` が更新後に残るか、全画面中の「前面に固定」、YouTube の PiP、Document PiP が無いブラウザでの無効表示。
