import { defineConfig } from "wxt";

// Manifest permissions stay minimal — expand only with inventory/PRD notes.
// 権限は最小。増やす場合は settings-inventory / PRD に理由を残す。
export default defineConfig({
  srcDir: "src",
  modules: [],
  // Target MV3 for both stores / 両ストアとも MV3
  manifestVersion: 3,
  manifest: {
    name: "Fullscreen Chat Extension",
    description:
      "Read and write YouTube / Twitch chat in fullscreen without losing the video.",
    icons: {
      "16": "icon/16.png",
      "32": "icon/32.png",
      "48": "icon/48.png",
      "128": "icon/128.png",
    },
    action: {
      default_title: "Fullscreen Chat",
      default_icon: {
        "16": "icon/16.png",
        "32": "icon/32.png",
        "48": "icon/48.png",
        "128": "icon/128.png",
      },
    },
    // storage: settings; windows: official chat popout (required on Firefox too)
    // storage: 設定。windows: 公式チャット別窓（Firefox でも必須）
    permissions: ["storage", "windows"],
    host_permissions: [
      "*://www.youtube.com/*",
      "*://youtube.com/*",
      "*://www.twitch.tv/*",
      "*://twitch.tv/*",
      // Third-party Twitch emote catalogs (BTTV / FFZ / 7TV)
      // Twitch 第三者エモートカタログ
      "*://api.betterttv.net/*",
      "*://cdn.betterttv.net/*",
      "*://api.frankerfacez.com/*",
      "*://cdn.frankerfacez.com/*",
      "*://7tv.io/*",
      "*://cdn.7tv.app/*",
    ],
    browser_specific_settings: {
      gecko: {
        // Production AMO id — not @local.dev / 本番用。ローカル開発 ID ではない
        id: "fullscreen-chat-extension@niboshi.dev",
        strict_min_version: "121.0",
        // No developer analytics / outbound PII — declare none for AMO.
        // 開発者への解析・外部送信なし。AMO 向けに none を宣言。
        data_collection_permissions: {
          required: ["none"],
        },
      },
    },
    // Chrome allows at most 4 commands with suggested_key.
    // Chrome は suggested_key 付き command が最大 4 つ。
    commands: {
      "toggle-enabled": {
        suggested_key: { default: "Alt+Shift+C" },
        description: "Toggle overlay visibility",
      },
      "cycle-display-mode": {
        suggested_key: { default: "Alt+Shift+M" },
        description: "Cycle display mode (panel / popout / danmaku)",
      },
      "toggle-danmaku": {
        suggested_key: { default: "Alt+Shift+D" },
        description: "Toggle danmaku (live chat only)",
      },
      "open-popout": {
        suggested_key: { default: "Alt+Shift+P" },
        description: "Open or focus popout window",
      },
      // No default shortcut — bind in chrome://extensions/shortcuts if needed.
      // デフォルト無し。必要なら chrome://extensions/shortcuts で割当。
      "toggle-compose-focus": {
        description: "Focus compose input",
      },
    },
  },
});
