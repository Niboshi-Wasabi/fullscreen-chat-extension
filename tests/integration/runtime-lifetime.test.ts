import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionSettings } from "../../src/shared/settings";
import { settings } from "../helpers";
import { createRuntimeController } from "../../src/app/runtime-controller";
import {
  startSiteRuntime,
  type SiteRuntimeOptions,
} from "../../src/app/site-runtime";

const harness = vi.hoisted(() => ({
  load: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  openPip: vi.fn(),
  closePip: vi.fn(),
  view: () => ({
    mount() {},
    unmount() {},
    applySettings() {},
    setMessages() {},
    setNativeChatUrl() {},
    reparentForFullscreen() {},
  }),
}));
vi.mock("../../src/shared/settings", async (original) => ({
  ...(await original<typeof import("../../src/shared/settings")>()),
  loadSettings: harness.load,
  watchSettings: () => () => {},
}));
vi.mock("../../src/shared/site-ids", () => ({
  resolveNativePanelChatUrl: () => null,
  resolvePopoutTargetForPolicy: () => ({
    url: "https://www.twitch.tv/popout/fixture/chat",
    siteKey: "twitch",
  }),
}));
vi.mock("../../src/shared/video-clock", () => ({
  getPageMediaTimeSec: () => null,
  watchMediaClock: () => () => {},
}));
vi.mock("../../src/shared/feature-flags", () => ({
  getFeatureFlags: () => ({ popoutWindowApi: true }),
}));
vi.mock("../../src/views/overlay-panel", () => ({
  createOverlayPanel: harness.view,
}));
vi.mock("../../src/views/danmaku", () => ({ createDanmakuView: harness.view }));
vi.mock("../../src/views/popout", () => ({
  createPopoutController: () => ({
    open: harness.open,
    close: harness.close,
    isOpen: () => false,
  }),
}));
vi.mock("../../src/views/pip-chat", () => ({
  isDocumentPipAvailable: () => true,
  createPipChatController: () => ({
    open: harness.openPip,
    close: harness.closePip,
    isOpen: () => false,
    setMessages() {},
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("location", {
    hostname: "www.twitch.tv",
    pathname: "/fixture",
  });
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { documentElement: {}, body: {} }),
  );
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("browser", {
    runtime: { onMessage: { addListener() {}, removeListener() {} } },
  });
});
afterEach(() => vi.unstubAllGlobals());

function options(): SiteRuntimeOptions {
  return {
    site: "twitch",
    createAdapter: () => ({ site: "twitch", start() {}, stop() {} }),
    isSiteActive: () => true,
    isSiteEnabled: () => true,
    resolveMountParent: () => document.body,
  };
}

describe("page runtime ownership", () => {
  it("never opens or closes a restored runtime's window after an old storage read", async () => {
    const initial = settings();
    initial.displayMode = "popout";
    let release!: (value: ExtensionSettings) => void;
    harness.load
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(initial);
    const old = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    const pending = old.restart();
    await Promise.resolve();
    old.stop();
    const current = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await current.restart();
    expect(harness.open).toHaveBeenCalledTimes(1);
    release(initial);
    await pending;
    expect(harness.open).toHaveBeenCalledTimes(1);
    expect(harness.close).not.toHaveBeenCalled();
    current.stop();
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to a new OS window when PiP fails after stop", async () => {
    const initial = settings();
    initial.displayMode = "popout";
    initial.popout.alwaysOnTop = true;
    harness.load.mockResolvedValue(initial);
    let release!: (opened: boolean) => void;
    const request = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    harness.openPip.mockReturnValue(request);
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    runtime.stop();
    expect(harness.closePip).toHaveBeenCalledTimes(1);
    release(false);
    await request;
    await Promise.resolve();
    expect(harness.open).not.toHaveBeenCalled();
  });
});
