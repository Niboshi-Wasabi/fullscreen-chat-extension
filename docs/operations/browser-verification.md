# ブラウザ検証と観測

状態: 分離したChromeプロファイルでproduction拡張のE2Eを実行済み。Firefox 160でも専用プロファイルとproduction拡張で合成20シナリオが成功。履歴復元とYouTube終了処理を修正し、拡張contentの終了タイムアウトは0件。Firefox内部の終了ログは一部残る。同梱Chromiumはこの端末のコード整合性ポリシーで起動できず、成功扱いにしていない。実サイト、GitHubランナー、macOSは未検証。[Phase 5計画](../plans/2026-11-14-browser-verification.md)と[Firefox検証記録](../quality/firefox-verification-2026-11-15.md)を参照。

## コマンドとブラウザの区別

| コマンド | 動作 |
|---|---|
| `pnpm.cmd browser:setup` | Playwright 1.65.0が指定するChromiumを.harness-tools/playwrightへ取得 |
| `pnpm.cmd test:e2e` | ビルド済み.output/chrome-mv3を同梱Chromiumで検査。先にbuild/browser:setupが必要 |
| `pnpm.cmd test:e2e:chrome` | 専用一時プロファイルのインストール済みChromeとブラウザCDPで検査。実バージョンを記録 |
| `pnpm.cmd test:e2e:firefox` | インストール済みFirefox + WebDriver BiDi。専用一時プロファイルで一時拡張読み込み、合成YT受信、OFF/ON、後始末。通常verify/CIには含めない |
| `pnpm.cmd verify:browser` | 通常verify + Chromium準備 + E2E |
| `pnpm.cmd verify:chrome` | 通常verify + 明示的なインストール済みChrome E2E。Chromiumの成功とは区別 |
| `pnpm.cmd verify:ci` | 通常verify + 同梱Chromium E2E + オンラインセキュリティ検査 + Git履歴必須 |

通常の `verify` は静的/回帰/両ビルドの入口を維持し、ブラウザ検査を含むとは報告しない。CIではE2Eを省略せず、インストール済みChromeへの暗黙のフォールバックも行わない。

## 実行方式と隔離

[Playwright設定](../../playwright.config.ts)と[fixture](../../tests/e2e/fixtures.ts)を使い、各テストに新しい永続コンテキストとstorageを用意する。個人の既定プロファイルやログイン情報は使用しない。テスト完了/起動失敗時には専用領域内のパスを確認してプロファイルを削除する。

同梱Chromiumは拡張ロード用の起動引数を使う。署名済みChromeモードは専用プロファイルとremote-debugging-pipeを使い、ブラウザCDPのExtensions.loadUnpackedで拡張をロードする。OSのコード整合性・署名ポリシーや通常利用のブラウザ設定は変更しない。ブラウザCDP用の開発フラグはこのテストプロセスだけに適用する。

YouTubeの許可済みURLを合成HTMLで置き換え、テストページからのその他の要求をcontext.routeで遮断する。manifestにlocalhostや追加ホストを加えず、実サイト・ログイン・実投稿をテストに混ぜない。これはページの通信制御であり、OS全体の通信を遮断するファイアウォールではない。

## 現在の自動検証

- service workerから実際の拡張IDを取得し、production popup/optionsをロード。
- キーボードで有効/無効を変更し、表示モード・言語が別ページにも保存されることを確認。
- optionsのカテゴリ操作とNG保存・再ロード。
- 合成YouTubeライブでパネル表示、NG除外、弾幕トグル、Fullscreen APIによる再配置、無効化・再有効化。
- 通常YouTube動画・Shorts（非ライブ）ではパネルおよびプレーヤーボタンが起動しないこと。
- 100件の合成コメント投入後の表示上限と表示到達を確認し、時間・DOM・CDPのheap/task等を記録。
- 明暗両テーマのpopupとoptions全5カテゴリにaxe（wcag2a/2aa/21a/21aaタグ）を適用。違反を無視して通過させない。アイコン名が単語としてはみ出す表示も検出。

axe通過は正式なWCAG適合認定ではなく、キーボード操作全体・スクリーンリーダー・200%拡大等の手動確認を置き換えない。iconの幅検査もすべての未収録グリフの完全な解析ではない。

2026-11-15に [レビュー回帰](../../tests/e2e/review-regressions.spec.ts) を追加した。production拡張でサイト別ON/OFF・履歴復元・SPA再起動、IME・失敗時の下書き保持、既知YouTube iframeからの受信と偽装イベント拒否・巻戻し、Twitch公式別窓のNG/ロール/OFF、ニコ生別窓の失敗、複数optionsの並行保存と不正なインポートを確認する。

PiP入力、返信先限定、Twitchパーサ/エモート切替、弾幕行数、バッジ、ネイティブ入力の単独経路は、原本モジュールをTypeScriptでメモリ内変換して合成ページで実行する。productionのテスト用APIは追加しない。この経路のbrowser/通信/Document PiP APIはスタブであり、実際のPiPウィンドウや実サイトの送信成功を保証しない。

## 証跡・計測の解釈

`.harness-artifacts/e2e-results.json`、`e2e-junit.xml`、`e2e-report/`、テスト別の `e2e-results/` を保存する。失敗時にはtrace.zip・ページ画像、成功時にも診断JSON・合成画面の代表画像・axe結果・合成負荷の測定を残す。起動できない場合はlaunch-error.jsonを保存し、UIの失敗とは区別する。

traceは `pnpm.cmd trace:e2e -- <trace.zipのパス>` で127.0.0.1の一時ポートから通常のブラウザタブへ表示できる。同梱Chromiumのviewer起動に依存しない。今回の画像・traceは合成データだけを含む。今後、認証済み実サイトの記録を扱う場合は、このCI成果物保存へ混入させない。

計測は端末、ブラウザ版、描画待機、プロトコル往復に依存する。投入から表示確認までの観測時間を製品のレイテンシ保証としない。CDPの累積値は開始前後を保存し、差分・単位を確認する。CPU/メモリの合格閾値や同期精度の保証はISS-005で未決定のまま。開発者サーバや外部解析へ測定を送信する機能は追加していない。

## Firefox・実サイトの手動確認

常設の最小合成回帰は `pnpm.cmd build:firefox` のあと `pnpm.cmd test:e2e:firefox`。証跡は `.harness-artifacts/firefox-synthetic/runs/<runId>/`（`results.json`・`browser.log`）。起動失敗と機能失敗は非ゼロ終了。終了時の Firefox 内部ログ（ISS-015 系）は機能合格を自動で覆さないが記録する。実サイト・実IME・Document PiP・CI必須化は別条件。依存はインストール済み Firefox と Node 組み込み WebSocket のみ（追加 npm なし）。

2026-11-15のFirefox 160 headless検証では、BiDiによる一時読み込みで設定・YT/Twitch/ニコ生の合成受信・全画面・ニコ生OS別窓を確認した。実施結果、終了時警告、popupキーボード操作の制限は[検証記録](../quality/firefox-verification-2026-11-15.md)を正本とする。当時のランナーはローカル成果物のみだった。常設Firefox CIは未導入で、以下の手動・実サイト確認は残る。

Firefoxのビルド成功やChromeテストを、Firefox拡張の動作確認と読み替えない。手動では別プロファイルを用意しabout:debuggingで.output/firefox-mv3/manifest.jsonを一時読み込みする。次をブラウザ版・OS・テストデータ・結果と合わせて[レビュー書式](../quality/review-template.md)に記録する。

1. popup/optionsの設定保存、日英/長文/RTL、明暗、キーボードとフォーカス。
2. サイトごとのライブ/VOD/アーカイブの受信とNG適用範囲（通常動画では非起動）。
3. 全画面の出入り、シーク、別窓、PiPの能力差、SPA遷移、繰り返し有効化・解除。
4. 実投稿は本人が明示許可した検証環境のみ。認証や許可がなければ未検証として残す。

エージェントの実機確認で使うプロジェクト MCP（Chrome・Firefox の DevTools）の起動設定 `.cursor/mcp.json` は、端末ごとの絶対パス（専用プロファイルの場所）を含むためローカル専用とし、Git に入れない（2026-11-19 オーナー判断）。各自が作る。プロファイルは `%LOCALAPPDATA%\fullscreen-chat-extension\` 配下の検証専用のものを使い、個人のプロファイルを指さない。サーバーを `@latest` で起動すると毎回最新版を実行するので、版を固定するかは各自の判断とする。

### エージェントの実サイト操作

1. 検証専用プロファイルへの接続を確認し、MCP のタブ一覧で操作対象のタブ ID と URL を照合する。MCP の再接続後やタブの作り直し後は、一覧を取り直す。
2. URL は対象タブを指定できる MCP の遷移操作で開く。GUI のアドレスバーへの入力、クリップボードからの貼り付け、Enter キーによる遷移で代用しない。ページ内で入力が必要な場合は、対象タブと入力要素を確認し、その要素を指定する操作を使う。
3. 通常利用のプロファイルと検証範囲外のタブは操作対象から外す。読み取り検証ではチャットや SNS の投稿欄に一切入力しない。実投稿を確認する場合は、本人が明示許可した検証環境と送信先に限定する。
4. 対象プロファイル・タブ・入力先を確認できない場合、または別のタブやウィンドウにフォーカスが移った場合は、入力や送信の前に止めて、どの操作で止まったかを報告する。

### 実サイト結果の記録（任意・通常 verify 外）

Chrome / Firefox とも同じ形式で記録する。受け入れ条件の正本は[実サイトチェックリスト](../quality/site-verification-checklist-2026-11-15.md)。手順は Skill [real-site-review](../../.agents/skills/real-site-review/SKILL.md)。

```powershell
pnpm.cmd build                 # または build:firefox
pnpm.cmd real-site:init -- --browser=chrome   # または firefox。runId とビルドハッシュを出力
# MCP で項目を確認し .harness-artifacts/real-site/<runId>/results.json と evidence/ を更新
pnpm.cmd check:real-site -- <runId>
pnpm.cmd real-site:finalize -- <runId>        # 任意
```

- スキーマ: [real-site-result.schema.json](../quality/real-site-result.schema.json)。既知 ID: [real-site-item-ids.json](../quality/real-site-item-ids.json)。
- `check:real-site` は形式・証跡パス・未知 ID 等の検査だけであり、機能合格や公開承認ではない。
- 成果物は `.harness-artifacts/real-site/`（Git 対象外）。合成 E2E の CI 成果物へ実サイト画像・ログを混入させない。
- 接続案の第1段階: [Firefox MCP 接続案](../plans/2026-11-18-firefox-harness-integration.md)（Chrome も同結果形式）。

### 実サイト発見から再発防止（第3段階）

手順正本: [regression-from-live.md](../quality/regression-from-live.md)。リンク台帳: [regression-links.json](../quality/regression-links.json)。

```powershell
pnpm.cmd check:regression-links
```

- 実サイトの fail/conditional → ISS → 匿名 fixture + 決定的テスト → 台帳登録 → 合成再実行 → 可能なら該当 checklist の実サイト再確認。
- `liveRecheck.status` が `pending` / `blocked` のあいだは、合成成功だけで再発防止完了としない。
- 形式検査はリンクの整合だけを見る。通常 verify / CI には含めない。

実サイトのDOM・認証・公式iframe・実メディア同期、Twitch経路はこの合成YouTube E2Eでは検証していない。公開前は[リリース手順](release.md)のマトリクスを完了する。

## 参考資料

- [Playwrightの拡張検証](https://playwright.dev/docs/chrome-extensions)
- [axeを利用した検査](https://playwright.dev/docs/accessibility-testing)
- [Chrome CDPのExtensionsドメイン](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Extensions.pdl)
- [専用プロファイルとChrome remote debugging](https://developer.chrome.com/blog/remote-debugging-port)
