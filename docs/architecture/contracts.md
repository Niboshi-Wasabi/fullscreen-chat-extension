# データとインターフェースの契約

状態: 現在の型定義への案内。ランタイム検証の十分性を保証する文書ではない。

| 契約 | 実体の正本 | 変更時の確認 |
|---|---|---|
| 正規化コメント・サイト種別 | [core/message.ts](../../src/core/message.ts) | サイト別の欠損値、絵文字、ロール、時刻 |
| サイトアダプタ | [adapters/types.ts](../../src/adapters/types.ts) | start / stopの対、購読解除、送信の失敗 |
| 設定・保存 | [shared/settings.ts](../../src/shared/settings.ts) | 既定値、既存保存値の互換性、不正値、watch解除 |
| 設定バックアップ | [shared/settings-backup.ts](../../src/shared/settings-backup.ts) | 不正なJSON、未知の値、サイズ、復元失敗 |
| 別窓runtime通信 | [shared/runtime-messages.ts](../../src/shared/runtime-messages.ts) | 呼び出し元、URL、siteKey、必須フィールド、副作用前の検証 |
| 混合チャットタブ間中継 | [shared/bridge-messages.ts](../../src/shared/bridge-messages.ts)、[app/bridge-hub.ts](../../src/app/bridge-hub.ts) | 送信元 ID・URL・top frame・サイト種別検証、メッセージサニタイズ、`storage.session` メタデータのみ保持 |
| ページ・iframeからの中継 | [content.ts](../../src/entrypoints/content.ts)、各adapter | origin / source / frameとpayloadの検証 |

本プロジェクトに開発者サーバのAPIやDBスキーマは現時点で導入しない。ブラウザ内保存と通信境界を契約管理の対象とする。

TypeScriptの型と型ガードという名称だけでは、外部入力を検証したことにならない。現在のruntime通信ガードは主にtype値を判定するため、受信ハンドラを含む経路全体の検証が必要（[ISS-009](../quality/issues.md#iss-009)）。

契約変更では送信側・受信側・保存済みデータ・設定UI・関連文書を同時に確認し、互換性を壊す判断は計画とADRへ残す。型宣言をこの文書に複製しない。

## 2026-11-15のレビュー修正

- 設定の書き込みは `fce:settings-write` でbackgroundへ集約する。background自身の更新、import/resetも同じキューで直列化。呼び出し側は入れ子の設定も変更したフィールドだけを渡す。読み込み時は書き込まず、不正な既存フィールドには既定値を使う。
- バックアップはバージョン 1 のバックアップ形式と、設定項目だけを持つオブジェクトを受け付ける。未知版、未知フィールド、型・列挙・値域の不正、1 MiBを超えるUTF-8 JSONは保存しない。廃止した機能のキー（`youtubeComments`、ISS-027）だけは、旧版の書き出しを読めるよう検証の前に取り除く。判定の正本は [settings-validation.ts](../../src/shared/settings-validation.ts)。
- YouTube中継は既知チャットiframeのWindow・HTTPS origin・パスを照合し、ブラウザのmessageイベントと [payload検証](../../src/shared/youtube-chat-bridge.ts) を通った行だけを使う。同じoriginのサイト自身によるDOM改変を防ぐ認証方式ではない。
- 投稿は `Promise<boolean>` の結果を3入力面まで返す。失敗・例外時は本文を保持し、送信中の重複操作を抑止する。trueは有効な公式UIへの送信操作までで、サーバ受理・配送の確認ではない。返信先の扱いは通常動画コメントとともに廃止した（ISS-027）。
- 詳細と回帰の対応は [修正記録](../quality/review-fixes-2026-11-15.md) を参照。既存runtime通信全経路の監査完了を意味しない。

## 2026-11-23の混合チャット統合（ISS-034）

- タブ間のライブチャット登録・購読・バッチ転送（`bridge-messages.ts` / `bridge-hub.ts` / `bridge-client.ts`）は、送信元の拡張 ID・HTTPS URL・`frameId === 0`・サイト種別・自サイトとの非重複を検査し、相手側からの取得コメントが再び送信側へ戻らないよう自サイト由来の行のみを転送する。`bridge-popout.html` からの購読もトップフレームの拡張ページ送信元に限定する。
- 遅延バッファ（[core/live-delay-buffer.ts](../../src/core/live-delay-buffer.ts)）の保持範囲（遅延秒・場面マーク・未放出キュー）および視聴タブで選んだ接続先・読み取り専用状態はページメモリ内のみに置く。`bridge-hub` はサービスワーカー再起動対策として `storage.session`（`fceBridgeHubState`）に配信元・購読関係・別窓ビューアのタブメタデータだけを保持し、チャット本文・投稿者名・視聴者識別子はストレージへ保存しない。
- 初回登録が失敗・無応答だった場合は同じ配信キーを再登録できるようにし、指数的バックオフ（上限 3 回）と新規メッセージ／再同期契機で再試行する。
