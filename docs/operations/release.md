# マージ・ストア公開

状態: 人手による手順。CIファイル・ローカルセキュリティ検査・初回GitHub実行・ブランチ保護は実施済み。自動提出、署名シークレット登録、最新変更分のPR検証は未実施。[CI手順](ci.md)を参照。

## 公開前の条件

- [品質基準](../quality/standards.md)の適用する必須検証が成功し、対象コミットまたは対象ファイルが明確。
- [ブラウザ検証](browser-verification.md)の合成E2Eと、以下の実サイト・Firefoxの手動確認を区別。Chrome合成テストの成功で全経路を代用しない。
- 独立レビューでCritical / Major / Minorを解消。未検証の必須項目を残さない。
- [問題台帳](../quality/issues.md)の権限・NG範囲・対応環境など、公開に影響する未決定事項を解消。
- [掲載資料](../store-listing.md)、[Firefox差分](../firefox-deltas.md)、[プライバシー](../../public/privacy.html)が対象パッケージと一致。
- 人間が最終対象を確認し、マージ・提出を明示的に許可。個人開発の承認方式は[作業フロー](../quality/workflow.md)を参照。

## Windows実機マトリクス

対象バージョンを記録し、保証対象（[ISS-005](../quality/issues.md#iss-005): Chrome/Chromium 121+、Firefox 121.0）で次を確認する。自動Chromiumテストだけでは実製品・Firefox合格にしない。

| 経路 | 確認内容 |
|---|---|
| YouTubeライブ | 全画面・シアター、待機室（チャット可）、受信、公式入力、NG、別窓、Super Chat 表示 |
| YouTubeアーカイブ | 再生・シーク後の同期、設定オフセット。許容値は承認後に判定 |
| YouTube通常動画 | 対象外（ISS-027）。パネル・プレーヤーボタンが誤起動しないことのみ確認 |
| Twitchライブ | チャットを閉じた場合の受信、エモートON/OFF、入力、別窓、Cheer／レイド表示 |
| Twitch VOD | 再生・シーク後の同期、Highlights 同経路、設定オフセット、チャンネル解決（エモート）。公式チャットの別窓と埋め込みは対象外 |
| 混合チャット（YT ライブ ⇄ Twitch ライブ） | パネル・弾幕・通常別窓（`bridge-popout.html`）でのロゴ識別・読み取り専用・0〜120 秒遅延・停止／シーク／広告マスク・場面記録補正・タブ切断復帰が初回保証対象。混合 Document PiP は対応環境のベストエフォート |
| Twitchクリップ | 対象外（ISS-020）。確認不要（破綻観察のみ任意） |
| ニコ生 | 対象外（ISS-018）。確認不要 |
| 共通 | SPA遷移、再有効化、資源解放、設定復元・不正インポート、キー操作、明暗・長文言語。ミニ／映像 PiP は対象外 |

コンテンツごとの対応範囲は[コンテンツパターン一覧](../quality/content-patterns-2026-11-15.md)を参照する。

実投稿はアカウント所有者の明示許可がある検証環境でのみ行う。許可や環境がなければ未検証として記録する。

## パッケージ

既存コマンド `pnpm.cmd zip` / `pnpm.cmd zip:firefox`（または統合入口 `pnpm.cmd release:pack`）で生成する。`pnpm.cmd check:release:pack` で両 ZIP 内の manifest の権限・ホスト・背景処理・gecko ID・同梱フォント・アイコン・バージョンおよび未圧縮ビルドとの一致を検査し、`.output/SHA256SUMS.txt` を出力する。

検証したパッケージと提出物を一致させる。コード・設定・依存・生成物が変わったら影響する検証とレビューを更新する。成果物の存在だけで公開可能としない。

## GitHub Release での配布と監視

PR マージや配布準備の節目に、本番ブランチ `main` と GitHub Release（公開済みおよび Draft）の乖離を監視し、パッケージ整合を検査する。構成判断の正本は [ADR 0005](../decisions/0005-github-release-harness.md)。

| コマンド / 手段 | 役割 |
|---|---|
| `pnpm.cmd check:release` | 生成済み ZIP（存在時）の manifest・同梱資産・ビルド一致を検査 |
| `pnpm.cmd release:pack` | `wxt zip` と `wxt zip -b firefox` を実行し両配布 ZIP を生成 |
| `pnpm.cmd check:release:pack` | 両 ZIP 必須で検証し `.output/SHA256SUMS.txt` を生成 |
| `pnpm.cmd check:release:drift` | `origin/main` と GitHub Release（公開済み・Draft・本文 SHA-256）の乖離を確認 |
| `node scripts/publish-draft-release.mjs --dry-run` | リリースノート案・Draft 作成/更新計画をローカルでプレビュー（変更なし） |
| [release.yml](../../.github/workflows/release.yml) | `v*` タグまたは手動 `workflow_dispatch` で `verify:ci` 通過後に ZIP 検証と Draft Release 作成/更新を実行 |

- **PR マージ時の監視**: `main` へ PR をマージした際は `pnpm.cmd check:release:drift` を実行し、`up-to-date` 以外（`drift`、`draft-only`、`draft-stale`、`no-release`、`unknown`）なら未配布差分、古い Draft、またはタグ基準未確認の状態がある旨を報告する。
- **Draft 生成・公開の境界**: `release.yml` と `pnpm.cmd release:draft` は常に `--draft`（下書き）としてのみ作成・更新し、公開済みリリースの上書きは拒否する。タグ `v<version>` の作成、`workflow_dispatch` の実行、Draft Release の公開（`draft=false` への変更）、および Chrome Web Store / Firefox AMO への提出は人間が明示的に許可・操作する。

公開はChrome Web Store / Firefox AMOへ人間が提出する方式から開始。認証情報をリポジトリへ保存しない。自動公開は別ADRと承認を経て導入する。
