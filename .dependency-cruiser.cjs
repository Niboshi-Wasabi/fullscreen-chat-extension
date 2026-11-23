module.exports = {
  forbidden: [
    {
      name: "no-cycles",
      severity: "error",
      comment:
        "Break the cycle using a shared contract / 依存関係を共通の契約に切り出して循環を解消する。",
      from: {},
      to: { circular: true },
    },
    {
      name: "core-must-not-import-runtime",
      severity: "error",
      comment:
        "Compose runtime in app / core から実行層を参照せず、app で組み合わせる。",
      from: { path: "^src/core/" },
      to: { path: "^src/(app|adapters|views|entrypoints|ui)/" },
    },
    {
      name: "views-must-not-import-adapters",
      severity: "error",
      comment:
        "Pass data from app / サイトから取得したデータは、app を経由して View に渡す。",
      from: { path: "^src/(views|ui)/" },
      to: { path: "^src/(adapters|app|entrypoints)/" },
    },
    {
      name: "adapters-must-not-import-presentation",
      severity: "error",
      comment:
        "Return normalized messages / アダプタは正規化メッセージを返す。",
      from: { path: "^src/adapters/" },
      to: { path: "^src/(views|ui|app|entrypoints)/" },
    },
    {
      name: "no-unresolved-imports",
      severity: "error",
      comment:
        "Resolve the module or correct the import / 解決できる参照先を指定する。",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    exclude: { path: "node_modules" },
  },
};
