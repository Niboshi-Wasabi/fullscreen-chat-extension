import { afterEach, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { getFeatureFlags } from "../../src/shared/feature-flags";
import { resolveLocale } from "../../src/shared/i18n";
import { bindNativeComposeFocus } from "../../src/shared/native-compose-focus";
import { buildBridgePopoutUrl } from "../../src/shared/runtime-messages";
import { watchSettings } from "../../src/shared/settings";
import { isTrustedExtensionSender } from "../../src/shared/trusted-sender";

const resources = vi.hoisted(() => ({
  observe: vi.fn(),
  ng: vi.fn(),
  focus: vi.fn(),
}));
vi.mock("../../src/adapters/youtube-live", () => ({
  isYouTubeLiveChatContext: () => true,
  observeYouTubeLiveChatIframe: resources.observe,
}));
vi.mock("../../src/app/native-chat-ng", () => ({
  startNativeChatNgHider: resources.ng,
}));
vi.mock("../../src/shared/native-compose-focus", () => ({
  bindNativeComposeFocus: resources.focus,
}));
// This test exercises iframe invalidation, not top-frame UI startup. Keep those
// branches isolated rather than importing their unrelated view dependency graph.
// iframe の破棄が対象なので、トップフレームの表示開始処理は単体テストの対象から外す。
vi.mock("../../src/app/twitch-runtime", () => ({
  startTwitchRuntime: vi.fn(),
}));
vi.mock("../../src/app/youtube-live-runtime", () => ({
  startYouTubeLiveRuntime: vi.fn(),
}));
vi.mock("../../src/views/player-chrome", () => ({
  startPlayerChrome: vi.fn(),
}));
afterEach(() => vi.unstubAllGlobals());

it("permanently stops an invalidated content instance before reinjection", async () => {
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  vi.stubGlobal("defineContentScript", (definition: unknown) => definition);
  const stops = [vi.fn(), vi.fn(), vi.fn()];
  resources.observe.mockReturnValue(stops[0]);
  resources.ng.mockReturnValue(stops[1]);
  resources.focus.mockReturnValue(stops[2]);
  const definition = (await import("../../src/entrypoints/content"))
    .default as unknown as {
    main: (context: { onInvalidated: (dispose: () => void) => void }) => void;
  };
  const callbacks: (() => void)[] = [];
  const context = {
    onInvalidated: (dispose: () => void) => callbacks.push(dispose),
  };
  definition.main(context);
  expect(callbacks).toHaveLength(1);
  target.dispatchEvent(
    Object.assign(new Event("pagehide"), { persisted: true }),
  );
  callbacks[0]!();
  target.dispatchEvent(
    Object.assign(new Event("pageshow"), { persisted: true }),
  );
  expect(resources.observe).toHaveBeenCalledTimes(1);
  for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1);
  definition.main(context);
  expect(resources.observe).toHaveBeenCalledTimes(2);
  callbacks[1]!();
  for (const stop of stops) expect(stop).toHaveBeenCalledTimes(2);
});

it("guards synchronous Extension context invalidated throws across runtime, i18n, storage, and listeners", () => {
  fakeBrowser.reset();
  vi.stubGlobal("navigator", { language: "ja" });
  const invalidated = (): never => {
    throw new Error("Extension context invalidated.");
  };
  const getUrlSpy = vi
    .spyOn(fakeBrowser.runtime, "getURL")
    .mockImplementation(invalidated);
  const getUiLangSpy = vi
    .spyOn(fakeBrowser.i18n, "getUILanguage")
    .mockImplementation(invalidated);
  const removeMsgSpy = vi
    .spyOn(fakeBrowser.runtime.onMessage, "removeListener")
    .mockImplementation(invalidated);
  const removeStorageSpy = vi
    .spyOn(fakeBrowser.storage.onChanged, "removeListener")
    .mockImplementation(invalidated);

  try {
    expect(buildBridgePopoutUrl("youtube")).toBeNull();
    expect(resolveLocale("auto")).toBe("ja");
    const stopWatch = watchSettings(() => {});
    const stopFocus = bindNativeComposeFocus();
    expect(() => stopWatch()).not.toThrow();
    expect(() => stopFocus()).not.toThrow();

    const addMsgSpy = vi
      .spyOn(fakeBrowser.runtime.onMessage, "addListener")
      .mockImplementation(invalidated);
    const addStorageSpy = vi
      .spyOn(fakeBrowser.storage.onChanged, "addListener")
      .mockImplementation(invalidated);
    try {
      expect(() => watchSettings(() => {})()).not.toThrow();
      expect(() => bindNativeComposeFocus()()).not.toThrow();
    } finally {
      addMsgSpy.mockRestore();
      addStorageSpy.mockRestore();
    }
  } finally {
    getUrlSpy.mockRestore();
    getUiLangSpy.mockRestore();
    removeMsgSpy.mockRestore();
    removeStorageSpy.mockRestore();
  }
});

it("guards throwing storage and runtime getters in feature flags and sender checks", () => {
  fakeBrowser.reset();
  const originalStorage = Object.getOwnPropertyDescriptor(
    fakeBrowser,
    "storage",
  );
  const originalRuntime = Object.getOwnPropertyDescriptor(
    fakeBrowser,
    "runtime",
  );
  const invalidated = (): never => {
    throw new Error("Extension context invalidated.");
  };

  Object.defineProperty(fakeBrowser, "storage", {
    configurable: true,
    enumerable: true,
    get: invalidated,
  });
  Object.defineProperty(fakeBrowser, "runtime", {
    configurable: true,
    enumerable: true,
    get: invalidated,
  });

  try {
    expect(() => getFeatureFlags()).not.toThrow();
    expect(getFeatureFlags().sessionStorage).toBe(false);
    expect(isTrustedExtensionSender({ id: "ext" })).toBe(false);
  } finally {
    if (originalStorage) {
      Object.defineProperty(fakeBrowser, "storage", originalStorage);
    }
    if (originalRuntime) {
      Object.defineProperty(fakeBrowser, "runtime", originalRuntime);
    }
  }
});
