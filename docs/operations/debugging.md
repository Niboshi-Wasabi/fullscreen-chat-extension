# デバッグ手段まとめ

この拡張機能（YouTube / Twitch 対応、WXT + TypeScript）をローカル環境で読み込み・観測・切り分けするための手順をまとめます。ビルド／テスト全体の正本は[開発手順](development.md)、[品質基準](../quality/standards.md)、[ブラウザ手順](browser-verification.md)を参照してください。

## 1. ブラウザへの手動読み込み手順

この節は人が手動で読み込む手順です。エージェントは[エージェントの実サイト操作](browser-verification.md#エージェントの実サイト操作)に従ってください。

まず対象ブラウザ向けにビルドします（PowerShell では `pnpm.cmd` を使用）。

```powershell
# Chromium 向け
pnpm.cmd build          # .output/chrome-mv3 を生成
pnpm.cmd dev            # 開発ビルド（.output/chrome-mv3-dev）

# Firefox 向け
pnpm.cmd build:firefox  # .output/firefox-mv3 を生成
pnpm.cmd zip:firefox    # 提出・配布用の未署名 .zip を生成
```

### Chrome / Chromium 系

1. アドレスバーで `chrome://extensions` を開く。
2. 右上の「デベロッパーモード」を ON にする。
3. 「パッケージ化されていない拡張機能を読み込む」から **フォルダ**（`.output/chrome-mv3`、開発時は `.output/chrome-mv3-dev`）を選択する。
4. 再ビルド後は拡張カードの更新（リロード）ボタンを押し、対象タブも再読み込みする。

### Firefox

1. アドレスバーで `about:debugging#/runtime/this-firefox` を開く。
2. 「一時的なアドオンを読み込む...」をクリックする。
3. Chrome と違い **ファイル選択ダイアログ** のため、`.output/firefox-mv3` フォルダを開き、中の `.output/firefox-mv3/manifest.json` ファイルを選択する（`.output/fullscreen-chat-extension-0.1.0-firefox.zip` でも可）。
4. 再ビルド後は `about:debugging` の「再読み込み」を押し、対象タブも再読み込みする。

> [!NOTE]
> - `.zip` を `about:addons`（「ファイルからアドオンをインストール」）やドラッグ＆ドロップで入れると、未署名アドオンとして拒否されます。ローカル検証では必ず `about:debugging` から読み込んでください。
> - `.output/` 配下に過去の `firefox-mv2` 等が残っている場合でも、現行対象は MV3（`.output/firefox-mv3`）です（[wxt.config.ts](../../wxt.config.ts)）。
> - `pnpm.cmd dev:firefox` は `web-ext` 未導入時は手動読み込み（`ManualRunner`）になるため、自動起動されない場合は生成された `manifest.json` を `about:debugging` から読み込みます。

---

## 2. コンテキスト別のログ・DOM・設定確認

この拡張はページ側・チャット iframe・Background・UI ページに処理が分かれているため、調査対象に応じて DevTools を切り替えます。

| 調査対象 | DevTools の開き方 | 主に見るポイント |
|---|---|---|
| Top Frame（パネル・弾幕・プレーヤーUI） | YouTube / Twitch タブで F12 → Console / Elements | `[fce]` 警告ログ、`#fce-player-toggle`、`.fce-panel`、`#fce-native-chat-frame`、`#fce-hidden-live-chat-frame`、`.fce-danmaku-item` |
| 公式チャット iframe 側（受信・NG・入力フォーカス） | 同じタブの Console 上部コンテキスト切替から `live_chat` / `live_chat_replay` / Twitch `embed`・`popout` iframe を選択 | チャット DOM 監視、`top` への `postMessage`、ネイティブチャット NG 適用 |
| Background（別窓管理・設定書込・ショートカット中継） | Chrome: `chrome://extensions` の「Service Worker」リンク<br>Firefox: `about:debugging` の「調査」ボタン | `browser.windows` 関連エラー、`storage.local` / `storage.session` の状態、詳細は[Firefox差分](../firefox-deltas.md)参照 |
| Popup / Options | ポップアップを右クリック→「検証」、または `about:debugging`「調査」内／拡張 URL 直開き | 設定トグル反映、ロケール表示、コンソールエラー |

---

## 3. 自動テスト・E2E・トレースによる切り分け

コード変更後の回帰確認や不具合の再現には、目的別に以下のコマンドを使います。

```powershell
# 型・lint・format・単体/結合・文書・多言語・両ビルド・manifest の一括確認
pnpm.cmd verify

# 単体／結合テストのみ（Vitest）
pnpm.cmd test

# 型チェックのみ
pnpm.cmd compile

# インストール済み Chrome を使った合成 E2E（要事前ビルド）
pnpm.cmd test:e2e:chrome

# インストール済み Firefox の最小合成回帰（要 build:firefox。通常 verify 外）
pnpm.cmd test:e2e:firefox

# 特定の E2E ファイルだけ実行する場合
pnpm.cmd test:e2e:chrome -- tests/e2e/review-regressions.spec.ts
```

- 失敗した E2E のスクリーンショット・`trace.zip`・診断 JSON は `.harness-artifacts/` に保存されます。
- トレース閲覧: `pnpm.cmd trace:e2e -- <trace.zipのパス>`（ローカル一時ポートでブラウザ表示）。
- 各検査コマンドの正確な範囲と制限は[品質基準](../quality/standards.md)および[ブラウザ手順](browser-verification.md)を参照してください。

### 実サイト実機レビュー（任意）

合成 E2E とは別に、専用プロファイルの MCP で実サイト項目を確認するときは Skill [real-site-review](../../.agents/skills/real-site-review/SKILL.md) に従う。

```powershell
pnpm.cmd real-site:init -- --browser=chrome   # または firefox
pnpm.cmd check:real-site -- <runId>
```

チェックリスト項目 ID・合格条件は[実サイトチェックリスト](../quality/site-verification-checklist-2026-11-15.md)。形式検査の成功を製品合格に読み替えない。詳細は[ブラウザ手順](browser-verification.md)の「実サイト結果の記録」。

実サイトで見つかった不具合の再発防止（匿名 fixture・リンク台帳・両面確認）は [regression-from-live.md](../quality/regression-from-live.md) と `pnpm.cmd check:regression-links`。

---

## 4. よくある症状別の確認ポイント

- **Firefox でフォルダを開いても読み込めない**
  - 「一時的なアドオンを読み込む」はファイル選択です。`.output/firefox-mv3` フォルダの中にある `manifest.json` を選択してください。
- **YouTube の通常動画・Shorts でボタンやパネルが出ない**
  - 仕様上、ライブ配信・プレミア公開・チャットリプレイ付きの動画（および Twitch）でのみ有効になります。チャット枠がない通常動画では起動しません。
- **YouTube SPA 遷移後に前の動画のコメントが混ざる／大量に流れる**
  - 隠し iframe（`#fce-hidden-live-chat-frame`）や埋め込みチャットの URL が新しい `v=` に追従しているか、また広告再生中や時刻同期（`video-clock` / `archive-sync`）の状態を Elements / Console で確認してください。
- **ビルド時に `EPERM: operation not permitted, unlink ...` が出る**
  - `.output/` や `node_modules/.vite/` のファイルを他プロセスや制限環境が掴んでいる可能性があります。該当ブラウザ・開発サーバを閉じてから再実行してください。
