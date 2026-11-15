# 全体レビュー R01–R21 対応記録

対象: 2026-11-15のユーザー依頼で認可された21件の修正。[計画](../plans/2026-11-15-review-fixes.md)に従う。元レビューと201ファイルのハッシュはローカルの `.harness-artifacts/review/` に保存されている。Git未配置のためコミットIDはない。

状態: 全21件を実装。下記の正式な回帰を追加し自己確認済み。同一チャットの実装と確認であり、独立レビュー済みとは扱わない。

| 指摘 | 修正 | 主な回帰 |
|---|---|---|
| R01 IME | 3入力面が共通の変換中Enter除外を使用 | パネル・PiP・ニコ別窓の変換中入力保持、通常Enter、Shift+Enter |
| R02 下書き消失 | 成否を全経路で返し、失敗説明と保持、重複抑止、送信中の編集保護 | 失敗・成功・未完了・二重送信・編集、無効な公式ボタン |
| R03 返信の新規投稿化 | 返信先消失時はfalse、返信入力と送信ボタンをスレッド内へ限定 | 消失・UI未出現で新規投稿0回、正しい返信先だけ成功 |
| R04 ページ中継 | 既知iframe source/origin/パス、ブラウザmessageイベント、型/サイズ/URLを検査 | 正常なiframe受信、ページpostMessageと偽装MessageEvent拒否、不正payload |
| R05 backup | 版・型・値域・配列・UTF-8サイズを保存前に検査、既存不正値は安全な既定値へ回復 | 不正nested/版/多バイト過大入力、無書込、設定画面使用継続 |
| R06 二重起動 | 直列化と世代番号で古い非同期起動を解放 | 遅い起動・停止中完了・連続YTイベント |
| R07 サイト切替 | 初期OFFでも設定監視を継続し、再起動にもサイトフラグを適用 | 初期OFF→ON、OFF後のDOM更新 |
| R08 再取得 | サイトDOM属性を使わずインスタンスのWeakSetで既読を管理 | 再有効化後の既存YT/Twitch履歴 |
| R09 並行保存 | backgroundキュー、ネストも部分patch、古いoptionsフォームの変更差分だけ送信 | 異なる設定/同じ袋の並行更新、2つの実optionsページ、保存失敗後の回復 |
| R10 NDGR ID | サーバIDを安定IDに使用、日時・乱数を付加しない | 同一protobuf再取得と別IDの同文投稿 |
| R11 Twitch ID | 投稿IDを優先、不在時はDOM要素のWeakMapで個別ID | 同文の別要素2件、同じDOMの再走査/再起動 |
| R12 遅着 | 未解放行を許容ズレ内で追いつかせる | 許容内遅着1回・古すぎる履歴・未来の行・既存シーク |
| R13 巻戻し | 履歴が空でもViewへ反映、設定値でなく実際のnative表示を判定 | 最初のコメント前へのシークで0件 |
| R14 NG OFF | マスタ・サイトフラグも判定し、元displayスタイルを復元 | 動作中OFFと初期OFF |
| R15 公式別窓NG | top-level Twitch公式popoutもhider対象 | 合成公式popoutのviewer除外 |
| R16 会員種別 | Nico Premiumをchannel member権限へ変換しない | 通常/プレミアム両方で同じNGが有効 |
| R17 ロールNG | Twitch badge/role判定を公式UIとAdapterで共有 | モデレーターのコマンドを保護、viewerは除外 |
| R18 最大行数 | 実測配置候補をmaxLines以内に制限 | 同じ画面・フォントで8と60のトラック数を比較 |
| R19 バッジ | 表示バッジとトグルを接続、内部マーカーを除外 | VIP表示とOFF、内部名の非表示 |
| R20 フォーカス | 現在のパネル/PiP/公式チャット/別窓へ伝達、隠し受信はフォーカス対象外 | パネルのblur後のコマンド、公式Twitch入力フォーカス |
| R21 エモート | 設定監視、世代確認とAbortControllerで古い結果を破棄 | 取得中OFF、同一チャンネルON/OFFと解除 |

主な正式テスト:

- [設定結合](../../tests/integration/settings.test.ts)
- [起動停止](../../tests/unit/runtime-controller.test.ts)
- [受信境界](../../tests/unit/receive-boundaries.test.ts)
- [アーカイブ](../../tests/unit/archive-sync.test.ts)
- [Chrome合成回帰](../../tests/e2e/review-regressions.spec.ts)

送信trueは有効な公式UI操作までで、サーバ受理ではない。APIスタブのPiP検証を実PiP検証と呼ばない。Firefox実機・実サイトの認証/送受信・GitHub CI・独立レビューは未実施。権限と依存の追加はない。sendFailedの42言語は英語フォールバックであり翻訳済みではない。

## 最終検証

Windows / Node 22.23.2 / Chrome 157.0.8103.52で実行。

| コマンド | 終了コード | 結果 |
|---|---:|---|
| `pnpm.cmd verify:chrome` | 0 | 全14項目成功。単体/結合53テスト、Chrome合成E2E 19テスト、両ブラウザビルドを含む |
| `pnpm.cmd check:secrets` | 0 | 著者管理ファイルの検出0件。Git未配置のため履歴はunavailable |

新規依存・権限追加なし。オンラインauditは依存変更がないため今回は再実行していない。型・ビルド・Chrome結果をFirefox実機成功とは扱わない。初期レビューと同じ担当による修正確認なので独立レビューは待ち。

証跡は `.harness-artifacts/verify-results.json`、`test-results.xml`、`e2e-results.json` とテスト別診断。ローカルの生成物をコミット対象へ混入させない。
