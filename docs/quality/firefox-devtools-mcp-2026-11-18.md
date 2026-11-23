# Firefox実サイト確認（2026-11-18）

CursorからFirefox DevTools MCP（`@mozilla/firefox-devtools-mcp` 0.10.7）を使い、専用プロファイルの表示ウィンドウで確認した。example.com や合成E2Eの成功は、実サイトの成功に数えない。チャット本文は記録しない。実投稿・購入・ログインはしていない。

## 環境

- Windows。Firefox 160.0。`C:\Program Files\Mozilla Firefox\firefox.exe`。Headless は No。表示領域 1280x720。
- プロファイル: `C:\Users\yukku\AppData\Local\fullscreen-chat-extension\firefox-verify\firefox_devtools_mcp_profile`。通常プロファイルはコピーしていない。
- 拡張: `pnpm.cmd build:firefox` が終了コード 0。一時読み込み `install_extension`（`type: path`、`permanent: false`）。ID `fullscreen-chat-extension@niboshi.dev`。
- ビルド時刻: 2026-11-18T01:06:14+09:00。
- `manifest.json` SHA-256: `010DB009BA2FEEA534B1EF02E82F85C7FAD3493CAA43796D1BDE6F657C1D11C6`
- `content-scripts/content.js` SHA-256: `05E0DCFF60057604511AEE31B594343C05B9E608254AE63C8343C0932DC517AB`
- ログイン状態: YouTube は Sign in、Twitch は Log In が表示された未ログイン。

## Cursorからの接続

| 確認 | 結果 | 証跡 |
|---|---|---|
| ページ一覧 | 成功 | `list_pages`: `[0] Untitled (about:blank)` |
| 移動 | 成功 | `navigate_page` → `https://example.com/`（`wait: complete`） |
| DOM | 成功 | `take_snapshot` が example.com の本文を返した |
| スクリーンショット | 成功 | `C:\Users\yukku\.firefox-devtools-mcp\output\screenshot-2026-11-17T16-06-38-641Z.png` |

## 実サイト

| 項目 | 結果 | 方法と観測 |
|---|---|---|
| 通常YouTube動画 | 成功 | `https://www.youtube.com/watch?v=tUfCW5JVNew`。24:24 の通常動画。`#fce-player-toggle`、パネル、弾幕セレクタは不在。画像 `screenshot-2026-11-17T16-07-28-298Z.png` |
| YouTubeリプレイの弾幕受信 | 成功（再試行） | 初回はパネルのままで弾幕なし。再試行で Danmaku に切り替え、動画上の弾幕を確認。詳細は再試行の節 |
| 拡張 OFF/ON | 成功 | 同じアーカイブ。OFF でラベルが Off になり `.fce-panel` が消えた。ON でラベル On とパネルが戻った。画像 `screenshot-2026-11-17T16-14-07-903Z.png` |
| 全画面の追従 | 成功（パネルの有無） | 全画面ボタンが `Exit full screen` になり、`.fce-panel` は残り、要素画像にも公式チャット枠が写った。退出後は `Full screen` に戻りパネルも残った。画像 `screenshot-2026-11-17T16-14-33-903Z.png`、`screenshot-2026-11-17T16-14-51-100Z.png`。この時点のプレーヤーは再生エラー |
| シーク後の弾幕 | 条件付き（再試行） | 初回の `t=120` は失敗。再試行の右矢印で 0:58 まで進み弾幕も出た。古い弾幕の解除を DOM で前後比較する前に再生エラー |
| Twitchライブ | 成功（埋め込みチャットの更新） | `https://www.twitch.tv/blastpremier`。LIVE、未ログイン。パネル内の公式チャット iframe の表示が2枚の画像のあいだで変わった。`.fce-panel-row` と `.fce-danmaku-item` はなし。画像 `screenshot-2026-11-17T16-16-23-584Z.png`、`screenshot-2026-11-17T16-16-50-768Z.png` |
| Twitch VOD | 成功（拡張の行） | `https://www.twitch.tv/videos/2929144992`。再生位置 00:00:44 のとき、拡張の行が 0:30、0:31、0:34、0:35 の4件。弾幕要素はなし。スナップショット `snapshot-2026-11-17T16-17-48-632Z.txt` |

YouTubeアーカイブの再生は一度 0:09 まで進み、その後「Something went wrong. Refresh or try again later.」になった。再読み込みでいったん戻った。

`[fce]` を含むコンソール行は、通常動画とTwitchライブのエラー絞り込みでは空だった。拡張のバックグラウンド調査画面は開いていない。

## ツール制約

- ポップアップとオプションは `moz-extension:` への移動が拒否され、`Alt+Shift+D` も表示モードを変えなかった。再試行では、自動化Firefoxのツールバーからポップアップを開き、Danmaku を選んだ。
- `list_extensions` は特権モジュール側のため、この設定では使っていない。読み込み確認は `install_extension` の戻り値。
- `about:debugging` への移動も拒否された。
- ページのコンソールは `list_console_messages`。Firefoxプロセス出力は `get_firefox_output` で、拡張コンソールとは別。

## 再試行（YouTubeアーカイブ）

同じ専用プロファイル、同じ一時読み込みのまま `https://www.youtube.com/watch?v=Rjw63eOY8pY` をやり直した。ポップアップの Mode を Danmaku にした。ログインはしていない。

| 項目 | 結果 | 観測 |
|---|---|---|
| 弾幕受信 | 成功 | 再生中、動画の上に複数の弾幕が出た。時刻は約 0:22。画像 `screenshot-2026-11-17T16-26-03-126Z.png`。`[fce]` の error は空 |
| シーク | 条件付き | 右矢印で 0:00 付近から 0:58 へ進み、その画面でも弾幕が出ていた。その後「Something went wrong」で時計が 1:00 のまま止まった。同じ弾幕ノードが消え、新しい弾幕が来た前後の DOM 比較は取れていない |
| 全画面 | 未再検証 | 前回のパネル表示での出入りは成功のまま。弾幕モードでの出入りは今回見ていない |
| OFF/ON | 未再検証 | 前回の成功のまま |

再生は数十秒で同じ YouTube のエラーになる。拡張のコンソールエラーではない。

## Twitch VOD の再確認（Danmaku）

2026-11-18 11:15 JST 頃。同じ一時読み込み、表示モードは Danmaku のまま `https://www.twitch.tv/videos/2929144992` を再生。未ログイン。

- トグルは On。`#fce-danmaku-host` は動画上にある。`.fce-panel` と `.fce-danmaku-item` は無い。
- 公式の「Chat on Videos」には 0:35 から 4:27 付近の行が見える。プレーヤー時刻は 00:04:29。
- 画像: `screenshot-2026-11-18T02-15-03-738Z.png`、弾幕レイヤー `screenshot-2026-11-18T02-15-22-050Z.png`。
- `[fce]` を含むコンソール行は空。
- 時刻付きの VOD メッセージはパネル用の履歴へ入り、`danmaku.push` はライブ同様の新規1件の経路だけ。この観測では弾幕は出ていない。

シーク・全画面・OFF/ON は、この Danmaku 表示のままでは自前リストが無いため未実施。

## 追加（未ログイン、2026-11-18 午後）

接続し直したタブは `about:blank` だった。同じ専用プロファイルへ、同じ `.output/firefox-mv3` を一時読み込みした。ID は `fullscreen-chat-extension@niboshi.dev`。表示モードは直前の Danmaku のまま。未ログイン。

| 項目 | 結果 | 観測 |
|---|---|---|
| Shorts | 成功 | `shorts/4qwUVSb3YgI`。動画プレーヤーはある。`#fce-player-toggle` は無い |
| YouTube ライブ | 条件付き | `watch?v=4t4AQ15yj1M`。トグルは `Fullscreen Chat: On`。右カラムの公式チャットに行がある。画面 `screenshot-2026-11-18T03-56-53-292Z.png` では動画上の弾幕も拡張パネルも確認できない |
| Highlights | 条件付き | `videos/2763258199`。トグルは On。`#fce-danmaku-host` はある。`.fce-panel-list` は無い。プレーヤーは `00:08:00 / 02:08:07`。右は「Chat on Videos」。画像 `screenshot-2026-11-18T03-57-30-800Z.png`。時刻付きの行は弾幕へ乗らない、という VOD 再確認と同じ |

パネル、別窓、ショートカット、NG はこの時点では未実施。次の節で、ウィンドウを主画面へ移したあとやり直している。

## 全パターンの初回（ツールバーが別画面）

専用プロファイルは Danmaku のまま。`moz-extension:` は拒否され、ツールバーは別モニターで押せない。ページへ送った `alt+shift+c`、`m`、`p` は `browser.commands` に届かず、トグルは On のまま、別窓は増えなかった。未ログイン。

| パターン | 結果 | 観測 |
|---|---|---|
| Shorts | 成功 | `shorts/4qwUVSb3YgI`。`#fce-player-toggle` は無い |
| 通常動画 | 成功 | `watch?v=tUfCW5JVNew`。トグルは無い |
| Twitch ライブ・弾幕 | この時点は条件付き | k4sen。トグルは On。`#fce-danmaku-host` はある。動画は黒く、浮遊テキストは無い。右の Stream Chat には行がある。画像 `screenshot-2026-11-18T04-11-00-995Z.png`。再生中のやり直しは次の節 |
| YouTube ライブ・弾幕 | この時点は条件付き | `watch?v=4t4AQ15yj1M`。トグルは On。ホストはある。浮遊テキストは無い。右の Top chat は空。画像 `screenshot-2026-11-18T04-12-35-815Z.png`。再生中のやり直しは次の節 |
| Twitch VOD・弾幕 | 条件付き | `videos/2929144992`。トグルは On。ホストはある。子要素は無い。時刻付きの行は弾幕へ乗らない |

## 主画面でのやり直し（2026-11-18 13時台）

自動化している Firefox だけを主画面に置いた。同じ一時読み込み、未ログイン。ポップアップはツールバーのパズルアイコンから開いた。Mode は Danmaku だったので Panel にした。Enabled は On。オプションページは Firefox MCP の `take_snapshot` が BiDi の system access 拒否で操作できない。`MOZ_REMOTE_ALLOW_SYSTEM_ACCESS` は付けず、表示中のウィンドウを操作した。

| パターン | 結果 | 観測 |
|---|---|---|
| Twitch ライブ・パネル | 成功 | `https://www.twitch.tv/k4sen`。LIVE、動画は再生中。`.fce-panel` が公式チャット iframe（`twitch.tv/embed`）付きで動画上にある。`#fce-danmaku-host` は無い |
| Twitch ライブ・弾幕 | 成功 | 同じ配信の再生中に Danmaku へ戻した。ホストに子要素があり、要素画像 `screenshot-2026-11-18T04-24-29-421Z.png`。黒い画面のときの空表示は、再生と新規コメントが揃っていなかったため |
| YouTube ライブ・弾幕 | 成功のあとプレーヤーエラー | `watch?v=4t4AQ15yj1M`。再生開始後、浮遊テキストが同時刻の Top chat の行と一致した。その後プレーヤーが「Something went wrong. Refresh or try again later.」。チャットは更新を続けた。拡張のコンソールエラーではない |
| YouTube ライブ・パネル | 成功 | エラー表示のまま Panel へ戻すと、動画上に公式チャット iframe（`youtube.com/live_chat`）のパネルが出た |
| YouTube OFF/ON | 成功 | `#fce-player-toggle` が `Fullscreen Chat: Off` になり `.fce-panel` が消え、再クリックでパネルが戻った |
| YouTube 別窓 | 成功 | Mode を Popout にすると `live_chat?is_popout=1` のタブが開き、ページ内パネルは外れた。Panel へ戻すと別窓タブは閉じた |
| NG | 成功（自前リスト） | 公式の Top chat は数秒で行が入れ替わるため、単語の消失だけでは証明にならない。Official chat UI を切ると拡張の自前リストになった。そこに見えていた1語を NG に入れると、その行だけが隣の行を残して消えた。その後 NG 欄は空に戻し Saved.。Official chat UI は青の On と Saved. まで戻した |
| Twitch 全画面 | 成功 | 再生中の k4sen。ボタンは `Fullscreen (f)` から `Exit Fullscreen (f)` になり、動画が画面を占め、パネルは残った。同じボタンで退出した。Escape は使っていない |
| ショートカット | 成功 | 自動化 Firefox が前面のとき、OS のキーで送った。`Alt+Shift+C` は On と Off を往復し、Off のときラベルは `Fullscreen Chat: Off` で動画上のパネルが消えた。`Alt+Shift+M` は Panel から別窓（ページ内パネルが外れ、Stream Chat の別ウィンドウ）、Danmaku（ホストあり。浮遊テキストが同時刻の公式チャットと一致。画像 `screenshot-2026-11-18T04-39-51-191Z.png`）、Panel の順。`Alt+Shift+D` は、弾幕が既に有効だと一度目はパネルのまま無効化され、次の押下でパネルが外れ `#fce-danmaku-host` が付いた（画像 `screenshot-2026-11-18T04-40-23-310Z.png` の瞬間には浮遊テキストは写っていない）。`Alt+Shift+P` は表示モードを Panel のまま別窓を開いた。別窓は閉じた |
| 終了時の表示 | 成功 | Panel、トグル `Fullscreen Chat: On`、`#fce-danmaku-host` は不在。別窓とオプションタブは閉じた |

VOD と Highlights で弾幕が空なのは、時刻付きの行が `danmaku.push` の前に戻る仕様のまま。YouTube の全画面とシークは、この再確認ではプレーヤーが YouTube のエラー表示だったため未実施。メンバー限定の受信と、パネルからの実投稿はログインが要るためしていない。

## 最終状態

Firefox の専用プロファイルは開いたまま。選択タブは `https://www.youtube.com/watch?v=Rjw63eOY8pY`。もう一方のタブは `https://www.twitch.tv/k4sen`。表示モードは Panel、Enabled は On、Official chat UI は On、別窓は閉じている。未ログイン。プレーヤーは YouTube の「Something went wrong. Refresh or try again later.」。

## ISS-028 / ISS-029 の再確認（2026-11-18 15時台）

修正後の `pnpm.cmd build:firefox` を、空のタブへ一時読み込みした。ID は `fullscreen-chat-extension@niboshi.dev`。未ログイン。チャット本文は記録しない。

| 項目 | 結果 | 観測 |
|---|---|---|
| YouTube アーカイブ、ページ側を開いたまま | 成功 | `watch?v=Rjw63eOY8pY`。トグルは `Fullscreen Chat: On`。ページ側は Top chat replay。`.fce-panel` は無い。画像 `screenshot-2026-11-18T06-44-47-173Z.png` |
| ページ側を閉じたあと | 成功 | 同じアーカイブ。`.fce-panel` と Official chat（`youtube.com/live_chat_replay`）が動画上に出た |
| YouTube 全画面 | 成功 | ボタンは `Full screen (f)` から `Exit full screen` になり、`.fce-panel` は残った。同じボタンで退出すると `Full screen` に戻った。Escape は使っていない |
| Twitch ライブ、ページ側を開いたまま | 成功 | `https://www.twitch.tv/k4sen`。LIVE。トグルは On。折りたたみボタンは `Collapse Chat`。`.fce-panel` は無い |
| ページ側を折りたたんだあと | 成功 | ボタン操作のあと `.fce-panel` と Official chat（`twitch.tv/embed`）が出た |
| Twitch 全画面 | 成功 | ボタンは `Fullscreen (f)` から `Exit Fullscreen (f)` になり、`#fce-native-chat-frame` は残った。同じボタンで退出した |
| 別窓は視聴中のタブだけ | 成功 | YouTube アーカイブを裏に置いたまま、前面の Twitch で `Alt+Shift+M`。別窓は一つで `https://www.twitch.tv/popout/k4sen/chat?popout=`。数秒後も YouTube へは替わらなかった。YouTube タブへ切り替えると、同じ窓が YouTube のチャットリプレイになった。YouTube 側のリプレイ本文は「Refresh or try again later.」で、URL の付け替えとは別 |

確認のあとポップアップで Panel に戻し、別窓タブは閉じた。製品ソースの追加修正、コミット、push はしていない。

## 設定の往復、第三者エモート、常に前面（2026-11-18 21時台）

同じ専用プロファイル、Firefox 160.0、未ログイン。読み込んだのは 15:42 の `.output/firefox-mv3`（一時読み込み、ID `fullscreen-chat-extension@niboshi.dev`）。`MOZ_REMOTE_ALLOW_SYSTEM_ACCESS` は付けていない。オプションページは表示中のウィンドウから開いた。チャット本文は記録しない。終わった時点の表示モードはパネル、公式チャット UI はオン、常に前面はオフ、NG ワードは空、BTTV / FFZ / 7TV はオン。別窓は閉じ、残っているタブは `https://www.twitch.tv/xqc`。製品ソースの追加修正、コミット、push はしていない。

| 項目 | 結果 | 観測 |
|---|---|---|
| 設定の書き出し／読み込み | 成功 | フィルタの NG ワードを入れて書き出し、欄を空にしたあと、そのファイルを読み込むと最初の語に戻った。状態表示は「Settings imported.」。戻した語を証跡にする。NG 欄は空に戻し「Saved.」。書き出した `fullscreen-chat-settings-2026-11-18T12-27-07.json` は確認後に削除した |
| 第三者エモート | 一部確認 | k4sen はオフラインだったので `https://www.twitch.tv/xqc` を使った。公式チャット UI はオフ、BTTV / FFZ / 7TV はオン。拡張の自前リスト（`.fce-panel`）に `https://cdn.7tv.app/emote/.../1x.webp` の画像が2つあった。同じ一覧に `betterttv` と `frankerfacez` の画像は無かった。Twitch 自身の `static-cdn.jtvnw.net` の画像はあった。取得失敗とは分けて記録する |
| 常に前面（Document PiP） | フォールバック | 常に前面をオンにし、前面の xQc で表示モードを別窓にした。開いたのは `https://www.twitch.tv/popout/xqc/chat?popout=`。タイトルは「xQc - Chat - Twitch」、ブラウザ枠があり、ウィンドウの最前面フラグは付いていなかった。枠の無い Document PiP は出なかった。Firefox には Document PiP が無い（この行の推測。22時台の確認で誤りと分かった。原因はページ上の操作が無かったこと） |

途中、アドオン管理の有効スイッチが一度オフになった。再読み込みでオンに戻してから、表示モードをパネル、常に前面をオフ、公式チャット UI をオンへ戻した。

## ISS-030〜032 の確認（2026-11-18 22時台）

Firefox 160.0、同じ専用プロファイル、未ログイン。セッションが作り直されていたので、22:44 の `.output/firefox-mv3`（ISS-030〜032 の実装を含む）を一時読み込みした。内部 UUID は前と同じで、設定も残っていた。ページは `https://www.twitch.tv/xqc`（LIVE）。操作は表示中のウィンドウへのクリックと、アドレスバーへの拡張ページ URL の入力。チャット本文は記録しない。

| 項目 | 結果 | 観測 |
|---|---|---|
| `open-popout` の既定キー（ISS-030） | 成功 | `about:addons` の「Manage Extension Shortcuts」で、Open or focus popout window は「Type a shortcut」（未割当）。C / M / D は Shift+Alt で割当済み。オプションのショートカット説明は「Alt+Shift+C toggle · M mode · D danmaku」 |
| 常に前面オフのパネルメニュー | 成功 | 歯車メニューは Opacity、Font size、Options の三つで、「Pin on top」は無い |
| オプションのスイッチ（ISS-032） | 想定と違う | スイッチは押せ、説明は通常の文言のまま。ビルドの判定は `documentPictureInPicture` の有無で、Firefox 160 の拡張ページにはそれがあった。無効表示にならないのは判定どおり |
| 「Pin on top」（ISS-032） | 成功 | 常に前面をオンにすると歯車メニューに「Pin on top」が出た。押すと「Mozilla Firefox」の小窓（アドレス欄は `www.twitch.tv/xqc`、見出し「Fullscreen Chat」、Comment 欄と Send）が開き、動画上のパネルは消えた。小窓を本体ウィンドウの上へ動かして本体をクリックしても、小窓は上に残った |
| PiP の中身 | 不具合 | Twitch のページ側チャット欄を折りたたんでいるあいだ、PiP の一覧は空のままだった。ページ側を開くとすぐ流れ始めた。PiP はページ側の DOM から読んだメッセージだけを表示する（ISS-033） |
| PiP を閉じる（ISS-031） | 成功 | 小窓の × で閉じたあと、ポップアップページの Mode は Panel |
| ポップアップから別窓（常に前面オン） | フォールバック | ポップアップページで Popout を選び Twitch タブへ戻ると、通常の別窓 `twitch.tv/popout/xqc/chat` が開いた。ページ上の操作が無いので PiP にはならない（想定どおり） |
| 通常の別窓を閉じる（ISS-031） | 成功 | 別窓の × で閉じたあと 3 秒待っても開き直さず、ポップアップページを再読み込みすると Mode は Panel。開いたままのポップアップページは再読み込みまで Popout と表示していた |

確認のあと常に前面をオフに戻した。表示モードはパネル、公式チャット UI はオン。Twitch のページ側チャット欄は開いたまま。拡張側から別窓を閉じる経路（ポップアップで Panel を選ぶ）は今回やり直していない。

## ISS-031〜033 修正後の再確認（2026-11-18 23時台）

Firefox 160.0、同じ専用プロファイル、未ログイン。23:04 の `.output/firefox-mv3` を一時読み込みし直した（内部 UUID は同じ）。ページは `https://www.twitch.tv/xqc`（LIVE）、公式チャット UI はオン。チャット本文は記録しない。

| 項目 | 結果 | 観測 |
|---|---|---|
| オプションのスイッチ（ISS-032） | 成功 | 「Always on top」は押せ、説明は「Adds "Pin on top" to the panel menu…」 |
| PiP の中身（ISS-033） | 成功 | ページ側のチャット欄を折りたたんでから「Pin on top」を押すと、小窓に Twitch の公式チャットが出た。「Connecting to Chat」のあと数秒で流れ始めた |
| PiP を閉じる（ISS-031） | 成功 | 小窓の × で閉じると、動画上にパネルが戻った |
| 通常の別窓を閉じる（ISS-031） | 成功 | 常に前面オフでポップアップページから Popout を選び、Twitch タブへ戻ると通常の別窓が開いた。本体をクリックしても別窓は残った（ページ一覧に残存）。× 一回で閉じ、動画上にパネルが戻り、開き直さなかった。ポップアップページを再読み込みすると Mode は Panel |

確認のあと常に前面をオフに戻した。表示モードはパネル、公式チャット UI はオン。Twitch のページ側チャット欄は開いた状態に戻した。

## レビュー修正後の再確認（2026-11-19 2時台）

Firefox 160.0、同じ専用プロファイル、未ログイン、Headless は No。`.output/firefox-mv3`（2026-11-19 2:39 のビルド）を一時読み込み。ID `fullscreen-chat-extension@niboshi.dev`。チャット本文は記録しない。別窓の取り直し、背面に作る窓、PiP を閉じた直後は、この回の Firefox では操作していない。

| 項目 | 結果 | 観測 |
|---|---|---|
| 通常動画 | 成功 | `watch?v=tUfCW5JVNew`。時計は `0:00 / 24:24`。コントロールは Play、Mute、Subtitles、Settings、Theater mode、Full screen。`#fce-player-toggle` と `.fce-panel` は無い |
| ホーム | 成功 | `youtube.com`。拡張のボタンとパネルは無い |
| Shorts | 成功 | `shorts/4qwUVSb3YgI`。プレーヤーはある。拡張のボタンとパネルは無い |
| アーカイブ | 成功 | `watch?v=Rjw63eOY8pY`。ボタンは「Fullscreen Chat: On」 |
