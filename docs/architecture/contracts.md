# データとインターフェースの契約

状態: 現在の型定義への案内。ランタイム検証の十分性を保証する文書ではない。

| 契約 | 実体の正本 | 変更時の確認 |
|---|---|---|
| 正規化コメント・サイト種別 | [core/message.ts](../../src/core/message.ts) | サイト別の欠損値、絵文字、ロール、時刻、通常コメント |
| サイトアダプタ | [adapters/types.ts](../../src/adapters/types.ts) | start / stopの対、購読解除、投稿・返信の失敗 |
| 設定・保存 | [shared/settings.ts](../../src/shared/settings.ts) | 既定値、既存保存値の互換性、不正値、watch解除 |
| 設定バックアップ | [shared/settings-backup.ts](../../src/shared/settings-backup.ts) | 不正なJSON、未知の値、サイズ、復元失敗 |
| 別窓runtime通信 | [shared/runtime-messages.ts](../../src/shared/runtime-messages.ts) | 呼出元、URL、siteKey、必須フィールド、副作用前の検証 |
| ページ・iframeからの中継 | [content.ts](../../src/entrypoints/content.ts)、各adapter | origin / source / frameとpayloadの検証 |

本プロジェクトに開発者サーバのAPIやDBスキーマは現時点で導入しない。ブラウザ内保存と通信境界を契約管理の対象とする。

TypeScriptの型と型ガードという名称だけでは、外部入力を検証したことにならない。現在のruntime通信ガードは主にtype値を判定するため、受信ハンドラを含む経路全体の検証が必要（[ISS-009](../quality/issues.md#iss-009)）。

契約変更では送信側・受信側・保存済みデータ・設定UI・関連文書を同時に確認し、互換性を壊す判断は計画とADRへ残す。型宣言をこの文書に複製しない。

## 2026-11-15のレビュー修正

- 設定の書込は `fce:settings-write` でbackgroundへ集約する。background自身の更新、import/resetも同じキューで直列化。呼出側はネストも変更フィールドだけを渡す。読込は書込を行わず、不正な既存フィールドを既定値へ回復する。
- バックアップはversion 1の封筒、または設定項目を持つ素のオブジェクトを受理する。未知版、未知フィールド、型・列挙・値域の不正、1 MiBを超えるUTF-8 JSONは保存しない。判定の正本は [settings-validation.ts](../../src/shared/settings-validation.ts)。
- YouTube中継は既知チャットiframeのWindow・HTTPS origin・パスを照合し、ブラウザのmessageイベントと [payload検証](../../src/shared/youtube-chat-bridge.ts) を通った行だけを使う。同じoriginのサイト自身によるDOM改変を防ぐ認証方式ではない。
- 投稿は `Promise<boolean>` の結果を3入力面まで返す。失敗・例外時は本文と返信先を保持し、送信中の重複操作を抑止する。trueは有効な公式UIへの送信操作までで、サーバ受理・配送の確認ではない。返信先の消失は新規コメントへ切り替えない。
- 詳細と回帰の対応は [修正記録](../quality/review-fixes-2026-11-15.md) を参照。既存runtime通信全経路の監査完了を意味しない。
