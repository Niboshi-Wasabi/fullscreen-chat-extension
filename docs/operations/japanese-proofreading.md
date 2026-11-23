# 日本語の校閲と差分検査

README、仕様書、開発手順、ストア掲載文、プライバシーポリシー、UI 文言、コードコメントの日本語を変更するときに使います。

## 校閲の進め方

1. 読み手と文章の目的を確かめます。利用者向けの案内には操作と結果を、開発者向けの文書には実行条件と参照先を示します。
2. 日本語を直したら、原文の主体、対象、条件・例外、否定、数値・単位、義務や確度が保たれているかを確認します。API 名、設定キー、テストデータ、記録に引用した文言は原文と照合します。
3. 差分検査を実行し、候補の前後を読み比べます。仕様を明確にするために追記する場合は、内容を確認できる正本やコードを参照します。

文体は [yomiyasu の技術文書ガイド](../../tools/japanese-guard/vendor/yomiyasu/references/domains/tech.md)、意味の保持と操作文言は nihongo の[技術文書ガイド](../../tools/japanese-guard/vendor/nihongo/references/technical-writing.md)と [UI 文言ガイド](../../tools/japanese-guard/vendor/nihongo/references/ui-copy.md)を参照してください。

## コマンド

Git と Python 3.10 以降を用意し、リポジトリのルートで実行します。インターネット接続と Python パッケージの追加は不要です。

```powershell
pnpm.cmd check:japanese
pnpm.cmd check:japanese --base origin/main
pnpm.cmd check:japanese --all
pnpm.cmd check:japanese --baseline .harness-artifacts/pre-edit --all
pnpm.cmd check:japanese --self-test
```

- 既定では `HEAD` と作業ツリーを比較します。`--base` で比較元の Git ref を指定できます。
- `--baseline` には編集前のファイルをリポジトリと同じ相対パスで保存したディレクトリを指定します。開始時点に未コミットの変更がある場合に使えます。
- `--all` は変更のない日本語にも文体検査を実行します。校閲対象は Git 管理下と未追跡のプロジェクト文書・ソースです。検査対象となる拡張子は [check.py](../../tools/japanese-guard/check.py) を参照してください。
- 結果は `.harness-artifacts/japanese-guard.json` に保存します。yomiyasu が文体と意味の変化、nihongo が意味の変化の候補を示します。通常実行では候補を報告し、`--strict` を指定すると意味の候補がある場合に終了コード 1 を返します。
- `--self-test` は、文章中の上限値の変更、文体の候補、改行コードだけを変えた差分の扱いを確かめます。

検査結果は校閲の手掛かりです。意味の最終判断は原文と修正後の文章を読み比べて行います。文章を自動で書き換える処理はありません。通常の `verify` と CI の既存の判定は [品質基準](../quality/standards.md) に従います。

同梱版の出典と更新手順は [日本語検査ツール](../../tools/japanese-guard/README.md) を参照してください。
