import js from "@eslint/js";
import tseslint from "typescript-eslint";

const windowsApi = [
  {
    selector:
      "MemberExpression[object.name=/^(browser|chrome)$/][property.name='windows']",
    message:
      "Use runtime messages to background.ts for window operations / windows API の操作は background に委ねてください。",
  },
  {
    selector:
      "MemberExpression[object.name=/^(browser|chrome)$/][computed=true][property.value='windows']",
    message:
      "Use background.ts for windows API / windows API は background 専用です。",
  },
  {
    selector:
      "VariableDeclarator[id.type='ObjectPattern'][init.name=/^(browser|chrome)$/] > ObjectPattern > Property[key.name='windows']",
    message:
      "Do not extract windows in content modules / コンテンツモジュールで windows API を分割代入しないでください。",
  },
];

export default [
  {
    ignores: [
      "node_modules/**",
      ".wxt/**",
      ".output/**",
      ".tmp-extensions/**",
      ".harness-artifacts/**",
      ".harness-tools/**",
    ],
  },
  {
    files: ["**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        WebSocket: "readonly",
      },
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  {
    files: ["src/**/*.ts"],
    ignores: ["src/entrypoints/background.ts"],
    rules: { "no-restricted-syntax": ["error", ...windowsApi] },
  },
];
