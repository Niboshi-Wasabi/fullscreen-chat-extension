# 日本語検査ツール

実行方法は [日本語の校閲と差分検査](../../docs/operations/japanese-proofreading.md) を参照してください。

| ツール | 固定したコミット | 同梱範囲 |
| --- | --- | --- |
| [yomiyasu v3.3.0](https://github.com/nanaism/yomiyasu/tree/v3.3.0) | `8831b14a5c2c12d41096495f0b8fe52d46d390c6` | `skills/yomiyasu` の `yomiyasu_lint.py`、`yomiyasu_diff.py`、`markdown_visibility.py`、参照資料、MIT・Unicode ライセンス |
| [nihongo v3.0.0](https://github.com/AnIT012/nihongo/tree/v3.0.0) | `15de10bcf9e405e4fa23165f5ad04312882a1074` | `nihongo/scripts`、`nihongo/references`、リポジトリの MIT ライセンス |

両ツールは `vendor/` に配布元のまま収録しています。更新時はリリースタグと対応するコミットを確認し、同じ範囲を置き換えます。この表の版、コミット、同梱範囲を更新したうえで、`pnpm.cmd check:japanese --self-test` と `pnpm.cmd check:japanese --all` を実行してください。公開されている検査関数の引数や戻り値が変わった場合は、`check.py` も更新します。
