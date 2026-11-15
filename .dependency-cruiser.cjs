module.exports = {
  forbidden: [
    {
      name: "no-cycles",
      severity: "error",
      comment:
        "Break the cycle using a shared contract / 共通契約へ依存を分離する。",
      from: {},
      to: { circular: true },
    },
    {
      name: "core-must-not-import-runtime",
      severity: "error",
      comment:
        "Compose runtime in app / coreから実行層を参照せずappで結線する。",
      from: { path: "^src/core/" },
      to: { path: "^src/(app|adapters|views|entrypoints|ui)/" },
    },
    {
      name: "views-must-not-import-adapters",
      severity: "error",
      comment: "Pass data from app / サイト取得はapp経由でViewへ渡す。",
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
