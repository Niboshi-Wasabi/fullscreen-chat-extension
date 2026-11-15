# Twitch実サイト報告対応 独立レビュー最終記録

## 対象と独立性

- 独立レビュー担当: `/root/firefox_review`。実装担当から分離したサブエージェント。製品・設定・既存テストへの編集なし。
- 対象: `src/adapters/twitch/index.ts`、`src/views/overlay-panel/index.ts`、追加修正の`src/app/site-runtime.ts`、`src/views/danmaku/index.ts`、新規`tests/e2e/twitch-regressions.spec.ts`。関連する保存・受信・フィルタ・描画・停止経路も確認。
- Git未配置。完全比較元 `.harness-artifacts/twitch-fixes/before-source.json` と現sourceを照合し、4製品ファイルの完全差分を `source.diff` に保存して直接確認。レビュー対象5ファイルの最終SHA-256は `reviewed-file-hashes.json`。
- AGENTS、code-review skill、既読PRD/architecture/quality文書、今回計画を参照。単に実装担当の報告を採用するのではなく、差分と関連コードを読み、独自再現を実行。
- ユーザーは、当初報告した移動・OFF/ON・別窓・弾幕の全症状が再読込で改善したと回答した。以下の合成再現を実サイト症状の原因と断定しない。未知のOFF残留・別窓原因への推測修正を今回の完了条件へ追加しない。

## 指摘履歴と解消確認

### 初回レビュー: Major 3件

**T1: pointerup後〜保存通知前の旧snapshotで移動が戻る**

位置: overlay-panelのendDrag/endResizeとapplyVisuals。実Chromeで移動後x590/y126→旧snapshot適用でx765/y56へ戻ることを再現。実装担当がpending位置を保持し、単一gesture条件は解消。

**T2: 親子で行セレクタが一致すると同一投稿を二重発行**

位置: Twitch ingest/scan/追加node経路。data-a-targetを持つ親と.chat-line__messageの子から同文がネイティブIDと生成IDの2件として発行された。実装担当がingest入口で公式行ownerへ正規化。最終独自再現でtwitch-nestedの1件のみ、解消確認済み。

**T3: 非空本文の段階描画が別投稿へ分裂し、完成本文を受信しない**

位置: Twitch fingerprint/ID生成、site-runtime seenIds経路。IDなし同一行のPar→Partial completedが異IDになった。IDありは同ID更新をruntimeが捨てていた。IDなしは安定Element IDへ戻し、Twitch liveの既存履歴は同IDで置換、弾幕は新規発行せずupdateで更新するよう修正。最終独自再現ではIDなし2通知のIDが一致し、runtime/UI向け恒久回帰も直接確認。解消確認済み。

### 最初の再レビュー: T1/T3の追加残条件 Major 2件

**T1追加残: 連続gestureの先行保存ackで最新位置が戻る**

pending単一位置ではB→C操作後のB通知を外部変更と誤認してC→Bへ戻した。実装担当が未ack位置キューへ変更。最終独自再現でC=x510/y140は先行B通知後も維持される。base・自分の未ack以外の外部位置を受理する分岐、unmount時キュー解除を直接確認。解消確認済み。

**T3追加残: NG更新後に予約retry/flushから旧弾幕が復活**

20x20 hostでpush→同ID update(false)→host拡大により旧本文が1件表示された。実装担当が予約段階からlatestMessagesを保持し、spawn開始と計測後に最新本文/可視性を参照するよう変更。最終独自再現はcount=0。flush、計測中更新、予約NGの恒久回帰、timersのunmount解除、旧mount計測応答が新mount状態を削除しないガードも確認。解消確認済み。

### 次の再レビュー: 新規Major 1件

**T4: 密度間引きで破棄した投稿本文を無制限に保持**

latestMessages導入後、densityのreturnでexpiryが登録されず、低密度20投稿・全DOM消滅後に12件の本文が残ることを再現。実装担当が未mount/未settings登録を抑止し、mode/densityの最終棄却、同mount計測中断、expiry/unmountで状態を削除。最終独自再現で全DOM0・Map0・unmount後0。解消確認済み。

各段階の独立した詳細記録: `initial-review.md`、`rereview-findings.md`、`final-rereview-finding.md`。後段で残った指摘を初回時点から解消していたようには扱わない。

## 検証

レビュー担当自身の最終実行:

| 実行 | 終了コード | 結果 |
|---|---|---|
| `node .harness-artifacts/twitch-review/reproduce.mjs` | 0 | 親子重複なし、IDなし水和は安定ID、pointerup後の旧snapshotで位置維持 |
| `node .harness-artifacts/twitch-review/concurrent-gesture.mjs` | 0 | 先行ack後も最新x510/y140を維持 |
| `node .harness-artifacts/twitch-review/retry-update.mjs` | 0 | NG更新後の予約弾幕0件 |
| `node .harness-artifacts/twitch-review/density-retention.mjs` | 0 | 低密度20件・全expiry後DOM0、保持Map0、unmount後0 |

独自実行はインストール済みChrome headless、about:blankの実DOM上で現sourceをTypeScript変換して使用。browser/storageの一部はスタブ。retention計測だけ、変換後MapをglobalThisへ公開するinstrumentationを行い、製品に検査APIを追加していない。実拡張/実サイトを通した実行とは区別する。初回実行時の遷移中context消失はabout:blankへ固定して解消し、上記はすべて正常終了した再実行。

実装担当の最新 `verify-chrome.log` と `.harness-artifacts/verify-results.json` を直接読み、2026-11-15T06:36:00.173Z時点の統合14段階passed/exitCode=0、単体/結合59件、Chrome E2E28件成功を確認した。恒久E2Eではgesture中/終了直後/先行ack、nested、production panelの同ID完成本文・行数、継続弾幕、予約NG/計測更新、低密度状態解放を確認する内容を直接読んだ。これらの統合実行は実装担当によるもの。

Firefoxについては、親側がcleanup修正前22件成功・cleanup後再実行予定と報告。最終cleanup後のFirefox結果は本記録作成時点では未受領。後続結果は親の追記として区別する。

## 結論と限界

- 初回Major 3件、再レビューで残った追加条件Major 2件、新規Major T4はすべて解消確認済み。
- **最終再レビューで未解消のCritical / Major / Minor指摘なし。** 独立レビュー状態: 指摘解消確認済み。
- ネイティブIDのない仮想化行では、新しい投稿と同じ投稿の編集を確実に区別できない既存の限界を維持する。安定Element IDへ戻したことを、新投稿識別の完全保証として扱わない。
- 実Twitch現在DOM/ログイン/配信/投稿での修正後再確認は本担当では未実施。ユーザーの再読込後改善という事実と、本レビューの合成再現による実装上の解消は別の証拠。
- 本担当自身によるFirefox実行、実HMR、実Document PiP、実IME、最低対応版、macOS、ストア公開・署名は未実施。R01–R21全体を再レビューしたものではない。
- 親の最終文書同期とcleanup後Firefox結果の追記、人間の確認を残す。合成検証や本レビューだけで公開承認としない。最終hash対象の製品/テストが後から変わる場合は影響を再確認する。

## 実装担当による後続検証

上記は独立レビュー担当の記録。以下は実装担当の実行結果。

- cleanup修正後のFirefox 160で22/22成功、終了0（2026-11-15 15:36:08〜15:36:22 JST）。content timeout0。Firefox内部stderr7行はISS-015の継続調査とする。
- 最終文書同期時、レビュー対象5ファイルのSHA-256を再計算し全件一致。レビュー後の製品・テスト変更なし。
- 証跡 `.harness-artifacts/twitch-fixes/firefox/results.json` / `browser.log`。実サイトのユーザー確認と自動検証の区別は [Twitch検証記録](twitch-verification-2026-11-15.md)を参照。
