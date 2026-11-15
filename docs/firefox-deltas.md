# Firefox 差分・機能フラグ

状態: Phase 7（2026-11-14）／2026-11-14 改訂（content は `windows` 非参照）  
対応コード: `src/shared/feature-flags.ts`（content 共用）、`src/entrypoints/background.ts`（windows 実処理）

## 方針

Chromium と Firefox の両方をビルド対象とする。差異は **黙って壊さない**。

- **content script** は `browser.windows` に触れない（未定義アクセスで落ちる）。
- 別窓の作成・bounds 保存は **background** のみが `windows` を使う。
- `getFeatureFlags()` は content 安全な能力だけを返す。

## 差分一覧

| 項目 | Chromium | Firefox | 扱い |
|------|----------|---------|------|
| Manifest | MV3 service worker | MV3 background scripts（WXT 出力） | ビルドで吸収 |
| `permissions: windows` | 別窓作成に使用 | 必要。未付与だと Popout 不可 | マニフェストで明示。欠けるビルドは不具合 |
| `windows.onBoundsChanged` | あり | 無い場合あり | background で optional。無ければ閉じるときに bounds 保存 |
| `storage.session` | 別窓 ID 復元 | 基本あり（121+） | 無ければメモリのみ（`getFeatureFlags().sessionStorage`） |
| `commands` suggested_key | 最大 4 | 5 本目にデフォルトを付けられる場合あり | Chrome 制約に合わせて 4+未割当 |
| データ収集プロンプト | なし | `data_collection_permissions.required: ["none"]` | 解析送信なし。AMO 提出用に manifest へ宣言済み |

## 機能フラグ（論理）

```text
popoutWindowApi   — content では常に true（別窓は background メッセージ経由）
sessionStorage    — 別窓管理状態を session に残せるか
documentPip       — Document PiP（常時前面）が使えるか
```

`windows.onBoundsChanged` はフラグ化しない。background が直接 optional bind する。

別窓オープン失敗時はログのみ（`popout open failed`）。表示モード自体のパネル強制フォールバックは、サイトが popout 非対応（例: 通常 YT コメント）のとき `routeDisplay` が担当する。

## 検証チェックリスト

以下は従来の手動・配布向けチェックリスト。2026-11-15にはFirefox 160 headlessへBiDiで一時読み込みし、合成ページでの受信・弾幕・全画面・別窓サイズ復元を確認した（当時の記録にニコ生が含まれるが、ニコ生は ISS-018 で削除済み）。`zip:firefox`、about:debugging手動操作、実サイトの公式別窓は今回の確認対象外。終了時の警告と残りの確認は[Firefox検証記録](quality/firefox-verification-2026-11-15.md)を参照。

- [ ] `pnpm build:firefox` / `pnpm zip:firefox` が通る
- [ ] manifest の gecko id と `data_collection_permissions` を確認
- [ ] `about:debugging` で一時読み込み
- [ ] YT ライブでパネル表示
- [ ] 別窓（`windows` 権限あり）で公式チャットが開く
- [ ] 弾幕モード（通常コメントでは無効のまま）
- [ ] content のコンソールに `onBoundsChanged` / windows 関連 TypeError が出ない
