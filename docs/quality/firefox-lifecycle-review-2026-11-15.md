# Firefox lifecycle 独立レビュー・再レビュー

## 対象と独立性

- レビュー担当: 実装担当から分離したサブエージェント `/root/firefox_review`。製品・設定・既存テストへの編集なし。
- 要求: Firefox BFCache復元、終了時cleanup、停止後の遅着起動、新旧runtime競合、購読・DOM・タイマー解除、WXT無効化。
- 初回対象: page-lifecycle/content、関連runtime controller/site runtime、各site wrapper、adapter/views、単体・cached-page E2E、Firefox計画・検証記録。再レビューでPiP controller、runtime-lifetime/content-invalidation追加テストを含む変更範囲と関連経路を再確認。
- Git未配置。初回11対象は `.harness-artifacts/firefox-fixes/changed-file-hashes.json` と実SHA-256がすべて一致。Firefox修正前はhashのみで完全なsource差分がなく、初回修正の完全diffは未確認。今回の指摘対応前sourceは `.harness-artifacts/firefox-next/before-source.json`。再レビュー対象識別は同ディレクトリの `reviewed-file-hashes.json` を参照。
- AGENTS、code-review skill、PRD、issues、architecture、workflow、review-template、code-principles、standards、Firefox修正計画・検証記録を参照。

## 初回指摘と解消確認

### F1 Major: 停止済みの非同期起動が復元後の別窓を閉じる

- 位置: site-runtime.ts のloadSettings直後、content.tsの各runtime起動、runtime-controller.ts。
- 再現: 旧runtimeのstorage待ち中に停止、新runtimeで別窓を開き、旧storageを解決するとopen/open/closeとなり、新runtimeの管理別窓が閉じた。旧adapterの開始も発生。
- 修正: controllerはactivationごとのAbortSignalを渡し、restart/stopで即abort。YouTube live/comments、Twitch、ニコ生wrapperからstartSiteRuntimeへsignalを伝達し、loadSettings後の副作用前にabortedを確認。
- 再レビュー: contentから各wrapperへ伝達する経路を直接確認。YouTube親の即時async wrapperは同期でinner controllerとdisposerを作り、停止時にinnerを停止する。独自再現を新契約に修正して実行し、旧storage解決後も管理別窓はopen、adapter開始は1回、旧open/closeなし。
- 状態: 解消確認済み。

### F2 Major: WXT無効化時にライフサイクルとruntimeを解除しない

- 位置: content.ts mainの各分岐。
- 再現: main起動→context無効化→再注入でiframe observer/NG/focusが各2本。WXTの同梱ContentScriptContext/entrypointも直接読み、自動cleanupがないことを確認。
- 修正: main(ctx)とし、全起動分岐でbindPageLifecycleの永久停止をctx.onInvalidatedへ登録。
- 再レビュー: 全分岐の結線、永久停止中のpageshowで再開しない動作を直接確認。独自再現で再注入後の購読は各1本。追加テストは停止中の無効化→pageshow→再注入を検証。
- 状態: 解消確認済み。

### F3 Major: 停止後のPiP応答が別窓を復活・残存させる

- 位置: site-runtime.ts syncPopout、views/pip-chat/index.ts open/close。
- 再現: PiP open保留中に停止、falseを解決するとpip-close/openとなり通常別窓が復活。
- 修正: active runtimeのdisposedとPiP世代で遅着fallbackを禁止。PiP controllerはpending共有、要求世代、closeによる失効、古い成功windowのclose、window単位のpagehide確認、locale遅着対象確認を追加。
- 再レビュー: 独自再現で停止後false応答のopenなし。実PiP sourceをNode上のWindow/DOM/APIスタブで実行し、保留open共有、close後新open成功→旧open成功で、旧windowだけ閉鎖、新windowを保持し最終closeで閉鎖することを確認。
- 状態: 解消確認済み。

## 検証

レビュー担当自身の実行:

| 方法 | 終了コード | 結果・証跡 |
|---|---|---|
| vitest: page-lifecycle/runtime-controller/content-invalidation/runtime-lifetime | 0 | 4ファイル8件成功、rereview-unit-results.xml |
| node late-start-rereview.mjs | 0 | 旧storage解決後open=true、adapter開始1回、late-start-rereview-result.json |
| node invalidation.mjs | 0 | 再注入後observer/NG/focus各1本、invalidation-result.json |
| node late-pip.mjs | 0 | 停止後のfallbackなし、late-pip-result.json |
| node late-pip-success.mjs | 0 | requests=2、oldClosed=1、currentClosed=1、stillOpen=true、late-pip-success-result.json |

独自再現は実sourceをTypeScript変換し、DOM・browser API・一部viewをスタブ化する。実ブラウザ確認とは区別する。初回late-pip再現作成時のスタブ不足によるTypeErrorは修正して再実行し、正常なruntime停止経路で初回不具合と修正後結果を確認した。

実装担当が実行した `.harness-artifacts/firefox-next/verify-chrome.log` と `.harness-artifacts/verify-results.json` を直接読み、prepareからbrowser-e2eまで14段階がpassed/exitCode=0であることを確認。これはレビュー担当自身のブラウザ実行ではない。

## 結論

- 再レビューで新規のCritical / Major / Minor指摘なし。初回Major 3件はすべて解消確認済み。
- source、テスト、設定にレビュー担当の編集はない。作成したものは許可されたfirefox-review証跡のみ。
- 独立レビュー状態: 指摘解消確認済み。
- レビュー担当自身による実Firefox/Chrome起動、実HMR、実サイト、実Document PiP、実IME、最低対応版、macOS、公開・署名は未実施。親側による修正後Firefox再実行と文書同期の最終結果はこの記録作成時点では未受領。
- 実ブラウザと公開の最終判断は、人間の確認と既存未検証・ISS-015の扱いを含めて実装担当が報告する。合成テストと本レビューだけで公開可能とは判定しない。

## 補足

- このレビューはFirefox lifecycleと関連する3指摘対応が対象。R01–R21全体の独立レビューを代替しない。
- 実装担当の統合検証証跡は単体/結合59件、Chrome E2E21件成功。修正後production Firefox20件は親側で実行中。
- 再レビュー対象14ファイルの完全なSHA-256一覧は `.harness-artifacts/firefox-review/reviewed-file-hashes.json`。計画・検証文書の追記後に製品ファイルが変わる場合は再確認が必要。

## 実装担当による後続検証の追記

上記は独立レビュー担当の記録。以下は実装担当の実行・照合結果であり、独立レビュー担当自身のブラウザ実行とは区別する。

- production Firefox 160の専用プロファイル・headless・合成20シナリオが終了0で成功（2026-11-15 14:48:51〜14:49:02 JST）。拡張contentの終了タイムアウト0件、既知のFirefox内部ログ5行はISS-015として継続。
- レビュー対象14ファイルのSHA-256は最終文書同期時にも全件一致。レビュー後に製品・テストを変更していない。
- 証跡は `.harness-artifacts/firefox-next/browser/results.json` と `browser.log`。範囲・未検証の正本は [Firefox検証記録](firefox-verification-2026-11-15.md)。
- 対象範囲の独立レビューは指摘解消確認済み。実サイト・実IME・通常ウィンドウのpopupキー操作・実HMR・実Document PiPと、全体レビューR01〜R21の再レビューは残る。公開承認とはしない。
