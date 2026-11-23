import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  BRIDGE_DELIVER_BATCH_TYPE,
  BRIDGE_DEMAND_TYPE,
  BRIDGE_LIST_SOURCES_TYPE,
  BRIDGE_POPOUT_SYNC_TYPE,
  BRIDGE_PUSH_BATCH_TYPE,
  BRIDGE_REGISTER_TYPE,
  BRIDGE_SOURCE_STATUS_TYPE,
  BRIDGE_SUBSCRIBE_TYPE,
  BRIDGE_UNREGISTER_TYPE,
  BRIDGE_UNSUBSCRIBE_TYPE,
} from "../../src/shared/bridge-messages";
import type { NormalizedMessage, SiteKind } from "../../src/core/message";
import type { ExtensionSettings } from "../../src/shared/settings";
import type {
  OverlayBridgeHooks,
  OverlayBridgeState,
} from "../../src/views/overlay-panel";
import { createBridgeHub } from "../../src/app/bridge-hub";
import { message, settings } from "../helpers";
import { createRuntimeController } from "../../src/app/runtime-controller";
import {
  startSiteRuntime,
  type SiteRuntimeOptions,
} from "../../src/app/site-runtime";

const harness = vi.hoisted(() => ({
  load: vi.fn(),
  open: vi.fn(),
  claim: vi.fn(),
  close: vi.fn(),
  openPip: vi.fn(),
  closePip: vi.fn(),
  setPipNativeUrl: vi.fn(),
  nativeUrl: null as string | null,
  danmakuPush: vi.fn(),
  danmakuSetMixedMode: vi.fn(),
  danmakuClear: vi.fn(),
  danmakuClearSite: vi.fn(),
  panelMount: vi.fn(),
  panelUnmount: vi.fn(),
  panelApplySettings: vi.fn(),
  panelSetMessages: vi.fn(),
  panelSetNativeUrl: vi.fn(),
  panelSetBridgeState: vi.fn(),
  panelReparent: vi.fn(),
  pipSetMessages: vi.fn(),
  pipSetBridgeMode: vi.fn(),
  panelOptionsBySite: new Map<
    SiteKind,
    { onPinOnTop?: () => void; bridge?: OverlayBridgeHooks }
  >(),
  panelMessagesBySite: new Map<SiteKind, NormalizedMessage[]>(),
  panelBridgeStateBySite: new Map<SiteKind, OverlayBridgeState>(),
  panelNativeUrlBySite: new Map<SiteKind, string | null>(),
  pageChatOpen: false,
  ensureChatFrameSrc: vi.fn(),
  popoutIsOpen: false,
  popoutTarget: null as { url: string; siteKey: string } | null,
  runtimeSend: vi.fn(async () => undefined),
  panelOptions: null as {
    onPinOnTop?: () => void;
    bridge?: OverlayBridgeHooks;
  } | null,
  pipOptions: null as {
    onClosedExternally?: () => void;
    onNativeChatRejected?: () => void;
  } | null,
  pipOpening: false,
  settingsListeners: new Set<
    (next: ExtensionSettings, previous?: ExtensionSettings) => void
  >(),
  onMediaTick: null as
    ((timeSec: number, meta: { seeked: boolean }) => void) | null,
  onPlaybackInterrupt: null as
    ((reason: "pause" | "seek" | "ad") => void) | null,
  useRealInterruptWatch: false,
  playbackInterruption: null as "pause" | "seek" | "ad" | null,
  onRuntimeMessage: null as
    | ((
        message: unknown,
        sender: unknown,
        sendResponse: (reply?: unknown) => void,
      ) => unknown)
    | null,
  view: () => ({
    mount() {},
    unmount() {},
    applySettings() {},
    setMessages() {},
    setNativeChatUrl() {},
    setBridgeState() {},
    reparentForFullscreen() {},
    push: harness.danmakuPush,
    setMixedMode: harness.danmakuSetMixedMode,
    update() {},
    flush() {},
    clear: harness.danmakuClear,
    clearSite: harness.danmakuClearSite,
  }),
}));
vi.mock("../../src/shared/settings", async (original) => ({
  ...(await original<typeof import("../../src/shared/settings")>()),
  loadSettings: harness.load,
  watchSettings: (
    listener: (next: ExtensionSettings, previous?: ExtensionSettings) => void,
  ) => {
    harness.settingsListeners.add(listener);
    return () => {
      harness.settingsListeners.delete(listener);
    };
  },
}));
vi.mock("../../src/shared/site-ids", async (original) => ({
  ...(await original<typeof import("../../src/shared/site-ids")>()),
  ensureYouTubeChatFrameSrc: harness.ensureChatFrameSrc,
  resolveNativePanelChatUrl: () => harness.nativeUrl,
  resolvePopoutTargetForPolicy: () => harness.popoutTarget,
}));
vi.mock("../../src/shared/video-clock", async (original) => {
  const actual =
    await original<typeof import("../../src/shared/video-clock")>();
  return {
    getPageMediaTimeSec: () => null,
    getLivePlaybackInterruption: () =>
      harness.useRealInterruptWatch
        ? actual.getLivePlaybackInterruption()
        : harness.playbackInterruption,
    watchMediaClock: (
      onTick: (timeSec: number, meta: { seeked: boolean }) => void,
    ) => {
      harness.onMediaTick = onTick;
      return () => {
        harness.onMediaTick = null;
      };
    },
    watchLivePlaybackInterruptions: (
      onInterrupt: (reason: "pause" | "seek" | "ad") => void,
    ) => {
      harness.onPlaybackInterrupt = onInterrupt;
      const stopReal = harness.useRealInterruptWatch
        ? actual.watchLivePlaybackInterruptions(onInterrupt)
        : null;
      return () => {
        stopReal?.();
        harness.onPlaybackInterrupt = null;
      };
    },
  };
});
vi.mock("../../src/views/overlay-panel", () => ({
  createOverlayPanel: (panelOptions: {
    site?: SiteKind;
    onPinOnTop?: () => void;
    bridge?: OverlayBridgeHooks;
  }) => {
    harness.panelOptions = panelOptions;
    if (panelOptions.site) {
      harness.panelOptionsBySite.set(panelOptions.site, panelOptions);
    }
    return {
      ...harness.view(),
      mount: harness.panelMount,
      unmount: harness.panelUnmount,
      applySettings: harness.panelApplySettings,
      setMessages: (msgs: NormalizedMessage[]) => {
        harness.panelSetMessages(msgs);
        if (panelOptions.site) {
          harness.panelMessagesBySite.set(panelOptions.site, msgs);
        }
      },
      setNativeChatUrl: (url: string | null) => {
        harness.panelSetNativeUrl(url);
        if (panelOptions.site) {
          harness.panelNativeUrlBySite.set(panelOptions.site, url);
        }
      },
      setBridgeState: (state: OverlayBridgeState) => {
        harness.panelSetBridgeState(state);
        if (panelOptions.site) {
          harness.panelBridgeStateBySite.set(panelOptions.site, state);
        }
      },
      reparentForFullscreen: harness.panelReparent,
    };
  },
}));
vi.mock("../../src/shared/page-chat-column", async (original) => ({
  ...(await original<typeof import("../../src/shared/page-chat-column")>()),
  isPageChatColumnOpen: () => harness.pageChatOpen,
}));
vi.mock("../../src/views/danmaku", () => ({ createDanmakuView: harness.view }));
vi.mock("../../src/views/popout", () => ({
  createPopoutController: () => ({
    open: harness.open,
    claim: harness.claim,
    close: harness.close,
    isOpen: () => harness.popoutIsOpen,
    sync() {},
  }),
}));
vi.mock("../../src/views/pip-chat", () => ({
  isDocumentPipAvailable: () => true,
  createPipChatController: (pipOptions: {
    onClosedExternally?: () => void;
    onNativeChatRejected?: () => void;
  }) => {
    harness.pipOptions = pipOptions;
    return {
      open: harness.openPip,
      close: harness.closePip,
      isOpen: () => false,
      isOpening: () => harness.pipOpening,
      setMessages: harness.pipSetMessages,
      setNativeChatUrl: harness.setPipNativeUrl,
      setBridgeMode: harness.pipSetBridgeMode,
      focusCompose() {},
    };
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  fakeBrowser.reset();
  harness.nativeUrl = null;
  harness.claim.mockResolvedValue(true);
  harness.pageChatOpen = false;
  harness.popoutIsOpen = false;
  harness.pipOpening = false;
  harness.settingsListeners.clear();
  harness.ensureChatFrameSrc.mockResolvedValue(null);
  harness.popoutTarget = {
    url: "https://www.twitch.tv/popout/fixture/chat",
    siteKey: "twitch",
  };
  harness.onMediaTick = null;
  harness.onPlaybackInterrupt = null;
  harness.useRealInterruptWatch = false;
  harness.playbackInterruption = null;
  harness.onRuntimeMessage = null;
  harness.panelOptionsBySite.clear();
  harness.panelMessagesBySite.clear();
  harness.panelBridgeStateBySite.clear();
  harness.panelNativeUrlBySite.clear();
  vi.spyOn(fakeBrowser.runtime, "sendMessage").mockImplementation(
    harness.runtimeSend as unknown as typeof fakeBrowser.runtime.sendMessage,
  );
  vi.spyOn(fakeBrowser.runtime.onMessage, "addListener").mockImplementation(
    (fn) => {
      harness.onRuntimeMessage = fn as unknown as (
        message: unknown,
        sender: unknown,
        sendResponse: (reply?: unknown) => void,
      ) => unknown;
    },
  );
  vi.spyOn(fakeBrowser.runtime.onMessage, "removeListener").mockImplementation(
    () => {
      harness.onRuntimeMessage = null;
    },
  );
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("location", {
    hostname: "www.twitch.tv",
    pathname: "/fixture",
  });
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), {
      documentElement: {},
      body: {},
      getElementById: () => null,
      querySelector: () => null,
    }),
  );
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Content pages save through background; answer like registerSettingsPersistence.
 * content は background 経由で保存するため、保存側と同じ形で応答する。 */
function acceptSettingsWrites(): void {
  harness.runtimeSend.mockImplementation((async (message: {
    settings?: unknown;
  }) =>
    message.settings
      ? { ok: true, settings: message.settings }
      : undefined) as unknown as () => Promise<undefined>);
}

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
  it("keeps rejected PiP chat on the list until the candidate URL changes", async () => {
    const initial = settings();
    initial.displayMode = "popout";
    initial.popout.alwaysOnTop = true;
    initial.panel.useNativeChat = true;
    harness.nativeUrl = "https://www.youtube.com/live_chat?v=first";
    harness.load.mockResolvedValue(initial);
    harness.openPip.mockResolvedValue(true);
    const dispose = await startSiteRuntime(options());
    expect(harness.setPipNativeUrl).toHaveBeenLastCalledWith(harness.nativeUrl);
    expect(harness.pipOptions?.onNativeChatRejected).toBeTypeOf("function");
    harness.pipOptions!.onNativeChatRejected!();
    expect(harness.setPipNativeUrl).toHaveBeenLastCalledWith(null);
    window.dispatchEvent(new Event("focus"));
    expect(harness.setPipNativeUrl).toHaveBeenLastCalledWith(null);
    harness.nativeUrl = "https://www.youtube.com/live_chat?v=second";
    window.dispatchEvent(new Event("focus"));
    expect(harness.setPipNativeUrl).toHaveBeenLastCalledWith(harness.nativeUrl);
    dispose();
  });
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

  it("keeps the OS fallback window when the page regains focus", async () => {
    const initial = settings();
    initial.displayMode = "popout";
    initial.popout.alwaysOnTop = true;
    harness.load.mockResolvedValue(initial);
    harness.openPip.mockResolvedValue(false);
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    await vi.waitFor(() => expect(harness.open).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    expect(harness.close).not.toHaveBeenCalled();
    expect(harness.openPip).toHaveBeenCalledTimes(1);
    runtime.stop();
  });

  it("closes a popout whose first open is still pending when the runtime stops", async () => {
    const initial = settings();
    initial.displayMode = "popout";
    harness.load.mockResolvedValue(initial);
    harness.open.mockReturnValue(new Promise(() => {}));
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    expect(harness.open).toHaveBeenCalledTimes(1);
    // The controller reports the pending request as open.
    harness.popoutIsOpen = true;
    runtime.stop();
    expect(harness.close).toHaveBeenCalledTimes(1);
  });

  it("reclaims the shared window on focus without bringing it forward", async () => {
    const initial = settings();
    initial.displayMode = "popout";
    harness.load.mockResolvedValue(initial);
    harness.open.mockResolvedValue(true);
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    expect(harness.open).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    // Another watch window may have retargeted it while this one stayed visible.
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    expect(harness.claim).toHaveBeenCalledTimes(2);
    expect(harness.open).toHaveBeenCalledTimes(1);
    expect(harness.close).not.toHaveBeenCalled();
    runtime.stop();
  });

  it("stops retrying the YouTube popout when the chat frame resolves but no target does", async () => {
    const initial = settings();
    initial.displayMode = "popout";
    harness.load.mockResolvedValue(initial);
    harness.popoutTarget = null;
    // A cached frame URL resolves immediately, as on a page whose live check
    // turned false while the chat frame stays.
    harness.ensureChatFrameSrc.mockResolvedValue(
      "https://www.youtube.com/live_chat?v=fixture",
    );
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime({ ...options(), site: "youtube-live" }, signal),
    );
    await runtime.restart();
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.ensureChatFrameSrc.mock.calls.length).toBeLessThan(5);
    expect(harness.open).not.toHaveBeenCalled();
    expect(harness.claim).not.toHaveBeenCalled();
    runtime.stop();
  });

  it("opens the YouTube popout once the chat frame URL yields a target", async () => {
    const initial = settings();
    initial.displayMode = "popout";
    harness.load.mockResolvedValue(initial);
    harness.popoutTarget = null;
    harness.ensureChatFrameSrc.mockImplementation(async () => {
      harness.popoutTarget = {
        url: "https://www.youtube.com/live_chat?v=fixture&is_popout=1",
        siteKey: "youtube",
      };
      return "https://www.youtube.com/live_chat?v=fixture";
    });
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime({ ...options(), site: "youtube-live" }, signal),
    );
    await runtime.restart();
    await vi.waitFor(() => expect(harness.open).toHaveBeenCalled());
    runtime.stop();
  });

  it("opens the PiP fallback without focus when a tab only came to the front", async () => {
    const initial = settings();
    initial.displayMode = "popout";
    initial.popout.alwaysOnTop = true;
    harness.load.mockResolvedValue(initial);
    harness.openPip.mockResolvedValue(false);
    Object.assign(document, { visibilityState: "hidden" });
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    expect(harness.openPip).not.toHaveBeenCalled();
    Object.assign(document, { visibilityState: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(harness.claim).toHaveBeenCalledTimes(1));
    expect(harness.openPip).toHaveBeenCalledTimes(1);
    expect(harness.open).not.toHaveBeenCalled();
    runtime.stop();
  });

  it("does not ask for PiP or the OS fallback again after the user closed PiP", async () => {
    const initial = settings();
    initial.displayMode = "popout";
    initial.popout.alwaysOnTop = true;
    harness.load.mockResolvedValue(initial);
    harness.openPip.mockResolvedValue(true);
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    expect(harness.openPip).toHaveBeenCalledTimes(1);
    acceptSettingsWrites();
    // The switch back to the panel has not landed yet when focus returns.
    harness.pipOptions?.onClosedExternally?.();
    harness.openPip.mockResolvedValue(false);
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.openPip).toHaveBeenCalledTimes(1);
    expect(harness.open).not.toHaveBeenCalled();
    expect(harness.claim).not.toHaveBeenCalled();
    runtime.stop();
  });

  it("keeps popout mode when PiP closes because the page is leaving", async () => {
    const initial = settings();
    initial.displayMode = "popout";
    initial.popout.alwaysOnTop = true;
    harness.load.mockResolvedValue(initial);
    harness.openPip.mockResolvedValue(true);
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    acceptSettingsWrites();
    window.dispatchEvent(new Event("pagehide"));
    harness.pipOptions?.onClosedExternally?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.runtimeSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ settings: { displayMode: "panel" } }),
    );
    runtime.stop();
  });

  it("keeps popout mode when PiP closes because the runtime stopped", async () => {
    const initial = settings();
    initial.displayMode = "popout";
    initial.popout.alwaysOnTop = true;
    harness.load.mockResolvedValue(initial);
    harness.openPip.mockResolvedValue(true);
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    acceptSettingsWrites();
    runtime.stop();
    expect(harness.closePip).toHaveBeenCalledTimes(1);
    harness.pipOptions?.onClosedExternally?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.runtimeSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ settings: { displayMode: "panel" } }),
    );
  });

  it("requests PiP inside the pin click, then switches to popout mode", async () => {
    harness.load.mockResolvedValue(settings());
    harness.openPip.mockResolvedValue(true);
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    acceptSettingsWrites();
    harness.panelOptions?.onPinOnTop?.();
    // Synchronous: a later call would lose the click's user activation.
    expect(harness.openPip).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(harness.runtimeSend).toHaveBeenCalledWith(
        expect.objectContaining({ settings: { displayMode: "popout" } }),
      ),
    );
    runtime.stop();
  });

  it("shows the official live chat in PiP but keeps the list for replays", async () => {
    const initial = settings();
    initial.panel.useNativeChat = true;
    harness.load.mockResolvedValue(initial);
    harness.openPip.mockResolvedValue(true);
    harness.nativeUrl =
      "https://www.twitch.tv/embed/fixture/chat?parent=www.twitch.tv";
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    harness.panelOptions?.onPinOnTop?.();
    expect(harness.setPipNativeUrl).toHaveBeenLastCalledWith(harness.nativeUrl);

    harness.nativeUrl =
      "https://www.youtube.com/live_chat_replay?continuation=fixture";
    harness.panelOptions?.onPinOnTop?.();
    expect(harness.setPipNativeUrl).toHaveBeenLastCalledWith(null);
    runtime.stop();
  });

  it("returns to the panel when the user closes the PiP window", async () => {
    const initial = settings();
    initial.displayMode = "popout";
    initial.popout.alwaysOnTop = true;
    harness.load.mockResolvedValue(initial);
    harness.openPip.mockResolvedValue(true);
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    acceptSettingsWrites();
    harness.pipOptions?.onClosedExternally?.();
    await vi.waitFor(() =>
      expect(harness.runtimeSend).toHaveBeenCalledWith(
        expect.objectContaining({ settings: { displayMode: "panel" } }),
      ),
    );
    runtime.stop();
  });

  it("moves the official chat overlay off the video while the page column is open, except in fullscreen", async () => {
    const initial = settings();
    initial.displayMode = "panel";
    initial.panel.useNativeChat = true;
    harness.load.mockResolvedValue(initial);
    harness.pageChatOpen = true;
    harness.nativeUrl =
      "https://www.twitch.tv/embed/fixture/chat?parent=www.twitch.tv";
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    expect(harness.panelMount).not.toHaveBeenCalled();

    harness.pageChatOpen = false;
    window.dispatchEvent(new Event("resize"));
    expect(harness.panelMount).toHaveBeenCalledTimes(1);

    harness.pageChatOpen = true;
    window.dispatchEvent(new Event("resize"));
    expect(harness.panelUnmount).toHaveBeenCalledTimes(1);

    Object.assign(document, { fullscreenElement: {} });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(harness.panelMount).toHaveBeenCalledTimes(2);
    runtime.stop();
  });

  it("keeps the extension list on the video when no official chat URL is available", async () => {
    const initial = settings();
    initial.displayMode = "panel";
    initial.panel.useNativeChat = true;
    harness.load.mockResolvedValue(initial);
    harness.pageChatOpen = true;
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    expect(harness.panelMount).toHaveBeenCalledTimes(1);
    runtime.stop();
  });

  it("re-pushes rewound archive/VOD messages to danmaku even when total messages exceed maxVisible", async () => {
    const initial = settings();
    initial.displayMode = "danmaku";
    initial.danmaku.enabled = true;
    initial.filter.maxVisible = 2;
    harness.load.mockResolvedValue(initial);
    let emit!: (
      line: import("../../src/core/message").NormalizedMessage,
    ) => void;
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(
        {
          ...options(),
          createAdapter: () => ({
            site: "twitch",
            start(cb) {
              emit = cb;
            },
            stop() {},
          }),
        },
        signal,
      ),
    );
    await runtime.restart();
    for (const sec of [10, 20, 30, 40]) {
      emit({
        id: `vod-${sec}`,
        site: "twitch",
        authorName: "Viewer",
        text: `Line ${sec}`,
        videoOffsetSec: sec,
        timestampMs: 0,
        role: "viewer",
        badges: [],
        isCommand: false,
      });
    }
    harness.onMediaTick?.(10.5, { seeked: false });
    harness.onMediaTick?.(20.5, { seeked: false });
    harness.onMediaTick?.(30.5, { seeked: false });
    harness.onMediaTick?.(40.5, { seeked: false });
    harness.danmakuPush.mockClear();

    // Rewind back to 10.5s — vod-10 is outside the tail maxVisible=2 slice
    harness.onMediaTick?.(10.5, { seeked: true });
    expect(harness.danmakuPush).toHaveBeenCalledWith(
      expect.objectContaining({ id: "vod-10" }),
    );
    runtime.stop();
  });

  it("returns to panel if PiP opened via Pin on top is closed before settings land", async () => {
    harness.load.mockResolvedValue(settings());
    harness.openPip.mockResolvedValue(true);
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    acceptSettingsWrites();

    harness.panelOptions?.onPinOnTop?.();
    await Promise.resolve();
    harness.pipOptions?.onClosedExternally?.();

    await vi.waitFor(() =>
      expect(harness.runtimeSend).toHaveBeenLastCalledWith(
        expect.objectContaining({ settings: { displayMode: "panel" } }),
      ),
    );
    runtime.stop();
  });

  it("skips onBecomeForeground claim when master enabled is false", async () => {
    const initial = settings();
    initial.enabled = false;
    initial.displayMode = "popout";
    harness.load.mockResolvedValue(initial);
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    harness.claim.mockClear();

    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    expect(harness.claim).not.toHaveBeenCalled();
    runtime.stop();
  });

  it("reports needsDomMessages false for native panel-only mode and does not reapply panel settings per message", async () => {
    const initial = settings();
    initial.displayMode = "panel";
    initial.panel.useNativeChat = true;
    harness.nativeUrl =
      "https://www.twitch.tv/embed/fixture/chat?parent=www.twitch.tv";
    harness.load.mockResolvedValue(initial);
    let capturedNeedsDom: (() => boolean) | undefined;
    let emit!: (
      line: import("../../src/core/message").NormalizedMessage,
    ) => void;
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(
        {
          ...options(),
          createAdapter: (ctx) => {
            capturedNeedsDom = ctx?.needsDomMessages;
            return {
              site: "twitch",
              start(cb) {
                emit = cb;
              },
              stop() {},
            };
          },
        },
        signal,
      ),
    );
    await runtime.restart();
    expect(capturedNeedsDom?.()).toBe(false);
    runtime.stop();

    const custom = settings();
    custom.displayMode = "panel";
    custom.panel.useNativeChat = false;
    harness.nativeUrl = null;
    harness.load.mockResolvedValue(custom);
    const customRuntime = createRuntimeController((signal) =>
      startSiteRuntime(
        {
          ...options(),
          createAdapter: (ctx) => {
            capturedNeedsDom = ctx?.needsDomMessages;
            return {
              site: "twitch",
              start(cb) {
                emit = cb;
              },
              stop() {},
            };
          },
        },
        signal,
      ),
    );
    await customRuntime.restart();
    expect(capturedNeedsDom?.()).toBe(true);

    harness.panelApplySettings.mockClear();
    harness.panelSetMessages.mockClear();
    harness.panelReparent.mockClear();
    emit({
      id: "msg-1",
      site: "twitch",
      authorName: "Viewer",
      text: "Hello",
      timestampMs: 0,
      role: "viewer",
      badges: [],
      isCommand: false,
    });
    expect(harness.panelApplySettings).not.toHaveBeenCalled();
    expect(harness.panelReparent).not.toHaveBeenCalled();
    expect(harness.panelSetMessages).toHaveBeenCalledTimes(1);
    customRuntime.stop();
  });

  it("returns to panel if Pin on top fails PiP on a page without an OS popout target", async () => {
    harness.load.mockResolvedValue(settings());
    harness.popoutTarget = null;
    harness.openPip.mockResolvedValue(false);
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    acceptSettingsWrites();

    harness.panelOptions?.onPinOnTop?.();
    await vi.waitFor(() =>
      expect(harness.runtimeSend).toHaveBeenLastCalledWith(
        expect.objectContaining({ settings: { displayMode: "panel" } }),
      ),
    );
    runtime.stop();
  });

  it("falls back to OS popout without opening PiP when syncPopout has no user activation", async () => {
    const initial = settings();
    initial.displayMode = "popout";
    initial.popout.alwaysOnTop = true;
    harness.load.mockResolvedValue(initial);
    harness.open.mockResolvedValue(true);

    const originalNavigator = Object.getOwnPropertyDescriptor(
      globalThis,
      "navigator",
    );
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        ...(globalThis.navigator ?? {}),
        userActivation: { isActive: false },
      },
    });
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    try {
      await runtime.restart();
      expect(harness.openPip).not.toHaveBeenCalled();
      expect(harness.open).toHaveBeenCalledTimes(1);
    } finally {
      runtime.stop();
      if (originalNavigator) {
        Object.defineProperty(globalThis, "navigator", originalNavigator);
      } else {
        delete (globalThis as Record<string, unknown>).navigator;
      }
    }
  });

  it("preserves pinChatOnTop fallback when watchSettings arrives while PiP is opening", async () => {
    const initial = settings();
    initial.displayMode = "panel";
    initial.popout.alwaysOnTop = true;
    harness.load.mockResolvedValue(initial);
    harness.popoutTarget = null;

    let resolvePip!: (opened: boolean) => void;
    harness.openPip.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          harness.pipOpening = true;
          resolvePip = done;
        }),
    );

    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(options(), signal),
    );
    await runtime.restart();
    acceptSettingsWrites();

    harness.panelOptions?.onPinOnTop?.();
    expect(harness.openPip).toHaveBeenCalledTimes(1);

    const nextSettings = settings();
    nextSettings.displayMode = "popout";
    nextSettings.popout.alwaysOnTop = true;
    for (const listener of harness.settingsListeners) {
      listener(nextSettings, initial);
    }
    expect(harness.openPip).toHaveBeenCalledTimes(1);

    harness.pipOpening = false;
    resolvePip(false);
    await vi.waitFor(() =>
      expect(harness.runtimeSend).toHaveBeenLastCalledWith(
        expect.objectContaining({ settings: { displayMode: "panel" } }),
      ),
    );
    runtime.stop();
  });

  it("bridges delayed Twitch chat into YouTube read-only panel, suspends on interruption, and restores official chat on disconnect", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const initial = settings();
    initial.displayMode = "panel";
    initial.panel.useNativeChat = true;
    initial.danmakuOverlayOnPanel = true;
    initial.danmaku.enabled = true;
    initial.filter.ngWords = ["spoiler"];
    harness.nativeUrl = "https://www.youtube.com/live_chat?v=abc";
    harness.load.mockResolvedValue(initial);
    vi.stubGlobal("location", {
      hostname: "www.youtube.com",
      pathname: "/watch",
      search: "?v=abc",
      href: "https://www.youtube.com/watch?v=abc",
    });

    const source = {
      tabId: 77,
      site: "twitch" as const,
      channelLogin: "shroud",
      label: "#shroud",
    };
    harness.runtimeSend.mockImplementation((async (req: { type?: string }) => {
      if (req.type === BRIDGE_LIST_SOURCES_TYPE) {
        return { sources: [source] };
      }
      if (req.type === BRIDGE_SUBSCRIBE_TYPE) {
        return { source };
      }
      return { ok: true };
    }) as unknown as () => Promise<undefined>);

    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(
        {
          site: "youtube-live",
          createAdapter: () => ({
            site: "youtube-live",
            start() {},
            stop() {},
          }),
          isSiteActive: () => true,
          isSiteEnabled: () => true,
          resolveMountParent: () => document.body,
          isCrossSiteBridgeEligible: () => true,
        },
        signal,
      ),
    );
    await runtime.restart();
    expect(harness.panelSetNativeUrl).toHaveBeenLastCalledWith(
      harness.nativeUrl,
    );

    harness.panelOptions?.bridge?.onRefreshSources();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        supported: true,
        sources: [
          {
            tabId: 77,
            site: "twitch",
            channelLogin: "shroud",
            label: "#shroud",
          },
        ],
        activeSource: null,
      }),
    );

    harness.panelOptions?.bridge?.onSelectSource(77);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeSource: {
          tabId: 77,
          site: "twitch",
          channelLogin: "shroud",
          label: "#shroud",
        },
        delaySec: 0,
      }),
    );
    expect(harness.panelSetNativeUrl).toHaveBeenLastCalledWith(null);

    harness.panelOptions?.bridge?.onAdjustDelay(8);
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ delaySec: 8 }),
    );

    harness.panelSetMessages.mockClear();
    harness.danmakuPush.mockClear();
    harness.onRuntimeMessage?.(
      {
        type: BRIDGE_DELIVER_BATCH_TYPE,
        sourceTabId: 77,
        site: "twitch",
        channelLogin: "shroud",
        items: [
          {
            receivedAtMs: 10_000,
            message: message({ id: "tw-ok", site: "twitch", text: "GG!" }),
          },
          {
            receivedAtMs: 10_000,
            message: message({
              id: "tw-ng",
              site: "twitch",
              text: "spoiler alert",
            }),
          },
        ],
      },
      { id: fakeBrowser.runtime.id },
      () => {},
    );
    expect(harness.panelSetMessages).not.toHaveBeenCalled();

    vi.advanceTimersByTime(8_000);
    expect(harness.panelSetMessages).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "tw-ok", site: "twitch", text: "GG!" }),
    ]);
    expect(harness.danmakuPush).toHaveBeenCalledTimes(1);
    expect(harness.danmakuPush).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tw-ok", site: "twitch", text: "GG!" }),
    );

    // Pause hides chat immediately; resume clears suspension and waits for manual resume.
    harness.panelSetMessages.mockClear();
    harness.onPlaybackInterrupt?.("pause");
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ suspendedReason: "pause" }),
    );
    expect(harness.panelSetMessages).toHaveBeenLastCalledWith([]);

    harness.panelOptions?.bridge?.onResume();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ suspendedReason: null }),
    );

    // Channel switch or disconnect restores official YouTube chat.
    harness.onRuntimeMessage?.(
      {
        type: BRIDGE_SOURCE_STATUS_TYPE,
        sourceTabId: 77,
        status: "closed",
      },
      { id: fakeBrowser.runtime.id },
      () => {},
    );
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ activeSource: null }),
    );
    expect(harness.panelSetNativeUrl).toHaveBeenLastCalledWith(
      harness.nativeUrl,
    );

    runtime.stop();
  });

  it("enables Twitch needsDomMessages while bridge subscribers are active", async () => {
    const initial = settings();
    initial.displayMode = "panel";
    initial.panel.useNativeChat = true;
    harness.nativeUrl =
      "https://www.twitch.tv/embed/fixture/chat?parent=www.twitch.tv";
    harness.load.mockResolvedValue(initial);
    let capturedNeedsDom: (() => boolean) | undefined;

    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(
        {
          ...options(),
          isCrossSiteBridgeEligible: () => true,
          resolveBridgeChannelLogin: () => "fixture",
          createAdapter: (ctx) => {
            capturedNeedsDom = ctx?.needsDomMessages;
            return { site: "twitch", start() {}, stop() {} };
          },
        },
        signal,
      ),
    );
    await runtime.restart();
    expect(capturedNeedsDom?.()).toBe(false);

    harness.onRuntimeMessage?.(
      { type: BRIDGE_DEMAND_TYPE, activeSubscribers: 1 },
      { id: fakeBrowser.runtime.id },
      () => {},
    );
    expect(capturedNeedsDom?.()).toBe(true);

    harness.onRuntimeMessage?.(
      { type: BRIDGE_DEMAND_TYPE, activeSubscribers: 0 },
      { id: fakeBrowser.runtime.id },
      () => {},
    );
    expect(capturedNeedsDom?.()).toBe(false);

    runtime.stop();
  });

  it("calibrates delay from visible and late-arriving reactions under non-zero delay and preserves +/- fine-tuning", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const initial = settings();
    initial.displayMode = "panel";
    initial.panel.useNativeChat = true;
    initial.filter.ngWords = ["spoiler"];
    harness.nativeUrl = "https://www.youtube.com/live_chat?v=abc";
    harness.load.mockResolvedValue(initial);
    vi.stubGlobal("location", {
      hostname: "www.youtube.com",
      pathname: "/watch",
      search: "?v=abc",
      href: "https://www.youtube.com/watch?v=abc",
    });
    const source = {
      tabId: 77,
      site: "twitch" as const,
      channelLogin: "shroud",
      label: "#shroud",
    };
    harness.runtimeSend.mockImplementation((async (req: { type?: string }) => {
      if (req.type === BRIDGE_LIST_SOURCES_TYPE) {
        return { sources: [source] };
      }
      if (req.type === BRIDGE_SUBSCRIBE_TYPE) {
        return { source };
      }
      return { ok: true };
    }) as unknown as () => Promise<undefined>);

    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(
        {
          site: "youtube-live",
          createAdapter: () => ({
            site: "youtube-live",
            start() {},
            stop() {},
          }),
          isSiteActive: () => true,
          isSiteEnabled: () => true,
          resolveMountParent: () => document.body,
          isCrossSiteBridgeEligible: () => true,
        },
        signal,
      ),
    );
    await runtime.restart();
    harness.panelOptions?.bridge?.onSelectSource(77);
    await vi.advanceTimersByTimeAsync(0);
    harness.panelOptions?.bridge?.onAdjustDelay(10);

    // Deliver one already-due row at 10s, one NG-filtered row at 10s, and one late row at 18s.
    harness.onRuntimeMessage?.(
      {
        type: BRIDGE_DELIVER_BATCH_TYPE,
        sourceTabId: 77,
        site: "twitch",
        channelLogin: "shroud",
        items: [
          {
            receivedAtMs: 10_000,
            message: message({ id: "tw-early", site: "twitch", text: "GG!" }),
          },
          {
            receivedAtMs: 10_000,
            message: message({
              id: "tw-ng",
              site: "twitch",
              text: "spoiler alert",
            }),
          },
          {
            receivedAtMs: 18_000,
            message: message({
              id: "tw-late",
              site: "twitch",
              text: "CLUTCH",
            }),
          },
        ],
      },
      { id: fakeBrowser.runtime.id },
      () => {},
    );

    // Advance from 10_000 to 22_000 (+12s from tw-early, +4s from tw-late which is still pending under +10s delay).
    vi.advanceTimersByTime(12_000);
    expect(harness.panelSetMessages).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "tw-early" }),
    ]);

    harness.panelOptions?.bridge?.onMarkScene();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        delaySec: 10,
        calibration: {
          status: "picking",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );

    // NG-filtered and pending rows cannot be selected.
    harness.panelSetBridgeState.mockClear();
    harness.panelOptions?.bridge?.onSelectReaction("tw-ng");
    harness.panelOptions?.bridge?.onSelectReaction("tw-late");
    expect(harness.panelSetBridgeState).not.toHaveBeenCalled();

    // Selecting already-visible row suggests +12s without altering active +10s delay.
    harness.panelOptions?.bridge?.onSelectReaction("tw-early");
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        delaySec: 10,
        calibration: {
          status: "suggested",
          selectedMessageId: "tw-early",
          suggestedDelaySec: 12,
        },
      }),
    );

    // Advance from 22_000 to 28_000 (18_000 + 10_000): tw-late is released at its normal timing and becomes selectable.
    vi.advanceTimersByTime(6_000);
    expect(harness.panelSetMessages).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "tw-early" }),
      expect.objectContaining({ id: "tw-late" }),
    ]);

    harness.panelOptions?.bridge?.onSelectReaction("tw-late");
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        delaySec: 10,
        calibration: {
          status: "suggested",
          selectedMessageId: "tw-late",
          suggestedDelaySec: 4,
        },
      }),
    );

    // Applying updates delay to +4s, clears calibration, and fine-tuning +1 / -5 continues working.
    harness.panelOptions?.bridge?.onApplySuggestedDelay();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        delaySec: 4,
        calibration: {
          status: "idle",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );

    harness.panelOptions?.bridge?.onAdjustDelay(1);
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ delaySec: 5 }),
    );
    harness.panelOptions?.bridge?.onAdjustDelay(-5);
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ delaySec: 0 }),
    );

    runtime.stop();
  });

  it("keeps current delay on calibration cancel and rejects stale candidates after interruptions, disconnect, or source switch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const initial = settings();
    initial.displayMode = "panel";
    initial.panel.useNativeChat = true;
    harness.nativeUrl = "https://www.youtube.com/live_chat?v=abc";
    harness.load.mockResolvedValue(initial);
    vi.stubGlobal("location", {
      hostname: "www.youtube.com",
      pathname: "/watch",
      search: "?v=abc",
      href: "https://www.youtube.com/watch?v=abc",
    });
    const sourceA = {
      tabId: 77,
      site: "twitch" as const,
      channelLogin: "shroud",
      label: "#shroud",
    };
    const sourceB = {
      tabId: 88,
      site: "twitch" as const,
      channelLogin: "tarik",
      label: "#tarik",
    };
    let resolvePendingSubscribe:
      ((value: { source: typeof sourceB }) => void) | null = null;
    harness.runtimeSend.mockImplementation((async (req: {
      type?: string;
      sourceTabId?: number;
    }) => {
      if (req.type === BRIDGE_LIST_SOURCES_TYPE) {
        return { sources: [sourceA, sourceB] };
      }
      if (req.type === BRIDGE_SUBSCRIBE_TYPE) {
        if (req.sourceTabId === 88) {
          return await new Promise((resolve) => {
            resolvePendingSubscribe = resolve;
          });
        }
        return { source: sourceA };
      }
      return { ok: true };
    }) as unknown as () => Promise<undefined>);

    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(
        {
          site: "youtube-live",
          createAdapter: () => ({
            site: "youtube-live",
            start() {},
            stop() {},
          }),
          isSiteActive: () => true,
          isSiteEnabled: () => true,
          resolveMountParent: () => document.body,
          isCrossSiteBridgeEligible: () => true,
        },
        signal,
      ),
    );
    await runtime.restart();
    harness.panelOptions?.bridge?.onSelectSource(77);
    await vi.advanceTimersByTimeAsync(0);
    harness.panelOptions?.bridge?.onAdjustDelay(10);

    const deliverRow = (id: string, receivedAtMs: number) => {
      harness.onRuntimeMessage?.(
        {
          type: BRIDGE_DELIVER_BATCH_TYPE,
          sourceTabId: 77,
          site: "twitch",
          channelLogin: "shroud",
          items: [
            {
              receivedAtMs,
              message: message({ id, site: "twitch", text: id }),
            },
          ],
        },
        { id: fakeBrowser.runtime.id },
        () => {},
      );
    };

    // 1. Cancel before apply keeps delay at +10s and clears suggestion.
    deliverRow("row-cancel", Date.now());
    vi.advanceTimersByTime(12_000);
    harness.panelOptions?.bridge?.onMarkScene();
    harness.panelOptions?.bridge?.onSelectReaction("row-cancel");
    harness.panelOptions?.bridge?.onCancelCalibration();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        delaySec: 10,
        calibration: {
          status: "idle",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );
    harness.panelOptions?.bridge?.onApplySuggestedDelay();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ delaySec: 10 }),
    );

    // 2. Pause, seek, and ad clear calibration immediately and block stale apply even after resume.
    for (const reason of ["pause", "seek", "ad"] as const) {
      deliverRow(`row-${reason}`, Date.now());
      vi.advanceTimersByTime(12_000);
      harness.panelOptions?.bridge?.onMarkScene();
      harness.panelOptions?.bridge?.onSelectReaction(`row-${reason}`);
      harness.onPlaybackInterrupt?.(reason);
      expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          suspendedReason: reason,
          calibration: {
            status: "idle",
            selectedMessageId: null,
            suggestedDelaySec: null,
          },
        }),
      );
      harness.panelOptions?.bridge?.onApplySuggestedDelay();
      expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
        expect.objectContaining({ delaySec: 10 }),
      );
      harness.panelOptions?.bridge?.onResume();
      harness.panelOptions?.bridge?.onApplySuggestedDelay();
      expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          delaySec: 10,
          suspendedReason: null,
          calibration: {
            status: "idle",
            selectedMessageId: null,
            suggestedDelaySec: null,
          },
        }),
      );
    }

    // 3. Switching source clears calibration immediately (even while subscribe is in-flight) and after resolve.
    deliverRow("row-switch", Date.now());
    vi.advanceTimersByTime(12_000);
    harness.panelOptions?.bridge?.onMarkScene();
    harness.panelOptions?.bridge?.onSelectReaction("row-switch");
    harness.panelOptions?.bridge?.onSelectSource(88);
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        calibration: {
          status: "idle",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );
    harness.panelOptions?.bridge?.onApplySuggestedDelay();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ delaySec: 10 }),
    );
    resolvePendingSubscribe!({ source: sourceB });
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeSource: {
          tabId: 88,
          site: "twitch",
          channelLogin: "tarik",
          label: "#tarik",
        },
        delaySec: 0,
        calibration: {
          status: "idle",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );

    // 4. Channel change / disconnect also clears calibration and blocks stale apply.
    harness.onRuntimeMessage?.(
      {
        type: BRIDGE_DELIVER_BATCH_TYPE,
        sourceTabId: 88,
        site: "twitch",
        channelLogin: "tarik",
        items: [
          {
            receivedAtMs: Date.now(),
            message: message({ id: "row-b", site: "twitch", text: "b" }),
          },
        ],
      },
      { id: fakeBrowser.runtime.id },
      () => {},
    );
    vi.advanceTimersByTime(6_000);
    harness.panelOptions?.bridge?.onMarkScene();
    harness.panelOptions?.bridge?.onSelectReaction("row-b");
    harness.onRuntimeMessage?.(
      {
        type: BRIDGE_SOURCE_STATUS_TYPE,
        sourceTabId: 88,
        status: "channel-changed",
      },
      { id: fakeBrowser.runtime.id },
      () => {},
    );
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeSource: null,
        calibration: {
          status: "idle",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );
    harness.panelOptions?.bridge?.onApplySuggestedDelay();

    // Reconnect and check manual onDisconnect clears calibration too.
    harness.panelOptions?.bridge?.onSelectSource(77);
    await vi.advanceTimersByTimeAsync(0);
    deliverRow("row-disc", Date.now());
    vi.advanceTimersByTime(8_000);
    harness.panelOptions?.bridge?.onMarkScene();
    harness.panelOptions?.bridge?.onSelectReaction("row-disc");
    harness.panelOptions?.bridge?.onDisconnect();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeSource: null,
        calibration: {
          status: "idle",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );
    harness.panelOptions?.bridge?.onApplySuggestedDelay();

    runtime.stop();
  });

  it("suspends immediately when connecting to an already-paused video and blocks calibration until playing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    harness.useRealInterruptWatch = true;

    class FakeVideoElement extends EventTarget {
      paused = true;
      ended = false;
      seeking = false;
      error: { code: number } | null = null;
      currentTime = 0;
      getBoundingClientRect() {
        return { width: 640, height: 360 };
      }
    }
    const video = new FakeVideoElement();
    vi.stubGlobal("HTMLVideoElement", FakeVideoElement);
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), {
        documentElement: {},
        body: {},
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: (selector: string) =>
          selector === "video" ? [video] : [],
      }),
    );

    const initial = settings();
    initial.displayMode = "panel";
    initial.panel.useNativeChat = true;
    harness.nativeUrl = "https://www.youtube.com/live_chat?v=abc";
    harness.load.mockResolvedValue(initial);
    vi.stubGlobal("location", {
      hostname: "www.youtube.com",
      pathname: "/watch",
      search: "?v=abc",
      href: "https://www.youtube.com/watch?v=abc",
    });
    const source = {
      tabId: 77,
      site: "twitch" as const,
      channelLogin: "shroud",
      label: "#shroud",
    };
    harness.runtimeSend.mockImplementation((async (req: { type?: string }) => {
      if (req.type === BRIDGE_LIST_SOURCES_TYPE) {
        return { sources: [source] };
      }
      if (req.type === BRIDGE_SUBSCRIBE_TYPE) {
        return { source };
      }
      return { ok: true };
    }) as unknown as () => Promise<undefined>);

    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(
        {
          site: "youtube-live",
          createAdapter: () => ({
            site: "youtube-live",
            start() {},
            stop() {},
          }),
          isSiteActive: () => true,
          isSiteEnabled: () => true,
          resolveMountParent: () => document.body,
          isCrossSiteBridgeEligible: () => true,
        },
        signal,
      ),
    );
    await runtime.restart();

    harness.panelOptions?.bridge?.onSelectSource(77);
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeSource: {
          tabId: 77,
          site: "twitch",
          channelLogin: "shroud",
          label: "#shroud",
        },
        suspendedReason: "pause",
        calibration: {
          status: "idle",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );

    harness.onRuntimeMessage?.(
      {
        type: BRIDGE_DELIVER_BATCH_TYPE,
        sourceTabId: 77,
        site: "twitch",
        channelLogin: "shroud",
        items: [
          {
            receivedAtMs: Date.now(),
            message: message({ id: "row-paused", site: "twitch", text: "hi" }),
          },
        ],
      },
      { id: fakeBrowser.runtime.id },
      () => {},
    );
    vi.advanceTimersByTime(1_000);
    harness.panelOptions?.bridge?.onMarkScene();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        suspendedReason: "pause",
        calibration: {
          status: "idle",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );

    // Even if resume is clicked while video remains paused, trying to mark scene re-suspends and refuses calibration.
    harness.panelOptions?.bridge?.onResume();
    harness.panelOptions?.bridge?.onMarkScene();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        delaySec: 0,
        suspendedReason: "pause",
        calibration: {
          status: "idle",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );
    harness.panelOptions?.bridge?.onApplySuggestedDelay();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ delaySec: 0 }),
    );

    // Once video resumes playing and user clicks resume, calibration can start.
    video.paused = false;
    harness.panelOptions?.bridge?.onResume();
    harness.onRuntimeMessage?.(
      {
        type: BRIDGE_DELIVER_BATCH_TYPE,
        sourceTabId: 77,
        site: "twitch",
        channelLogin: "shroud",
        items: [
          {
            receivedAtMs: Date.now(),
            message: message({ id: "row-live", site: "twitch", text: "live" }),
          },
        ],
      },
      { id: fakeBrowser.runtime.id },
      () => {},
    );
    harness.panelOptions?.bridge?.onMarkScene();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        suspendedReason: null,
        calibration: {
          status: "picking",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );

    runtime.stop();
  });

  it("discards suggested candidate, keeps current delay, and blocks stale apply on real video error without pause and seeking events", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    harness.useRealInterruptWatch = true;

    class FakeVideoElement extends EventTarget {
      paused = false;
      ended = false;
      seeking = false;
      error: { code: number } | null = null;
      currentTime = 0;
      getBoundingClientRect() {
        return { width: 640, height: 360 };
      }
    }
    const video = new FakeVideoElement();
    vi.stubGlobal("HTMLVideoElement", FakeVideoElement);
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), {
        documentElement: {},
        body: {},
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: (selector: string) =>
          selector === "video" ? [video] : [],
      }),
    );

    const initial = settings();
    initial.displayMode = "panel";
    initial.panel.useNativeChat = true;
    harness.nativeUrl = "https://www.youtube.com/live_chat?v=abc";
    harness.load.mockResolvedValue(initial);
    vi.stubGlobal("location", {
      hostname: "www.youtube.com",
      pathname: "/watch",
      search: "?v=abc",
      href: "https://www.youtube.com/watch?v=abc",
    });
    const source = {
      tabId: 77,
      site: "twitch" as const,
      channelLogin: "shroud",
      label: "#shroud",
    };
    harness.runtimeSend.mockImplementation((async (req: { type?: string }) => {
      if (req.type === BRIDGE_LIST_SOURCES_TYPE) {
        return { sources: [source] };
      }
      if (req.type === BRIDGE_SUBSCRIBE_TYPE) {
        return { source };
      }
      return { ok: true };
    }) as unknown as () => Promise<undefined>);

    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(
        {
          site: "youtube-live",
          createAdapter: () => ({
            site: "youtube-live",
            start() {},
            stop() {},
          }),
          isSiteActive: () => true,
          isSiteEnabled: () => true,
          resolveMountParent: () => document.body,
          isCrossSiteBridgeEligible: () => true,
        },
        signal,
      ),
    );
    await runtime.restart();
    harness.panelOptions?.bridge?.onSelectSource(77);
    await vi.advanceTimersByTimeAsync(0);
    harness.panelOptions?.bridge?.onAdjustDelay(10);

    const deliverRow = (id: string, receivedAtMs: number) => {
      harness.onRuntimeMessage?.(
        {
          type: BRIDGE_DELIVER_BATCH_TYPE,
          sourceTabId: 77,
          site: "twitch",
          channelLogin: "shroud",
          items: [
            {
              receivedAtMs,
              message: message({ id, site: "twitch", text: id }),
            },
          ],
        },
        { id: fakeBrowser.runtime.id },
        () => {},
      );
    };

    deliverRow("row-err", Date.now());
    vi.advanceTimersByTime(12_000);
    harness.panelOptions?.bridge?.onMarkScene();
    harness.panelOptions?.bridge?.onSelectReaction("row-err");
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        delaySec: 10,
        suspendedReason: null,
        calibration: {
          status: "suggested",
          selectedMessageId: "row-err",
          suggestedDelaySec: 12,
        },
      }),
    );

    // Fire `error` on the video element without changing `paused` or emitting `pause`.
    harness.panelSetMessages.mockClear();
    video.dispatchEvent(new Event("error"));
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        delaySec: 10,
        suspendedReason: "pause",
        calibration: {
          status: "idle",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );
    expect(harness.panelSetMessages).toHaveBeenLastCalledWith([]);

    harness.panelOptions?.bridge?.onApplySuggestedDelay();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ delaySec: 10 }),
    );
    harness.panelOptions?.bridge?.onResume();
    harness.panelOptions?.bridge?.onApplySuggestedDelay();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        delaySec: 10,
        suspendedReason: null,
        calibration: {
          status: "idle",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );

    // Repeat with `seeking` emitted directly from the video element.
    deliverRow("row-seek", Date.now());
    vi.advanceTimersByTime(12_000);
    harness.panelOptions?.bridge?.onMarkScene();
    harness.panelOptions?.bridge?.onSelectReaction("row-seek");
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        delaySec: 10,
        calibration: {
          status: "suggested",
          selectedMessageId: "row-seek",
          suggestedDelaySec: 12,
        },
      }),
    );

    video.dispatchEvent(new Event("seeking"));
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        delaySec: 10,
        suspendedReason: "seek",
        calibration: {
          status: "idle",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );

    harness.panelOptions?.bridge?.onApplySuggestedDelay();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ delaySec: 10 }),
    );
    harness.panelOptions?.bridge?.onResume();
    harness.panelOptions?.bridge?.onApplySuggestedDelay();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        delaySec: 10,
        suspendedReason: null,
        calibration: {
          status: "idle",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );

    runtime.stop();
  });

  it("supports simultaneous bidirectional mixed panels across YouTube and Twitch without echo loops and restores local-only chat when peer closes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const initial = settings();
    initial.displayMode = "panel";
    initial.panel.useNativeChat = true;
    harness.nativeUrl = "https://www.youtube.com/live_chat?v=ytLive1";
    harness.load.mockResolvedValue(initial);
    vi.stubGlobal("location", {
      hostname: "www.youtube.com",
      pathname: "/watch",
      search: "?v=ytLive1",
      href: "https://www.youtube.com/watch?v=ytLive1",
    });

    // Wire real background BridgeHub between YouTube (tab 20) and Twitch (tab 10).
    vi.stubGlobal("defineBackground", (fn: () => void) => fn);
    const tabListeners = new Map<
      number,
      (
        msg: unknown,
        sender: unknown,
        sendResponse: (reply?: unknown) => void,
      ) => unknown
    >();
    let currentAddTargetTab = 20;
    let activeActionTab: number | null = null;
    const pushedBatches: Array<{
      tabId: number;
      site: SiteKind;
      ids: string[];
    }> = [];

    vi.spyOn(fakeBrowser.runtime.onMessage, "addListener").mockImplementation(
      (fn) => {
        tabListeners.set(
          currentAddTargetTab,
          fn as unknown as (
            msg: unknown,
            sender: unknown,
            sendResponse: (reply?: unknown) => void,
          ) => unknown,
        );
      },
    );
    vi.spyOn(
      fakeBrowser.runtime.onMessage,
      "removeListener",
    ).mockImplementation((fn) => {
      for (const [tabId, listener] of tabListeners) {
        if (listener === (fn as unknown)) {
          tabListeners.delete(tabId);
        }
      }
    });
    vi.spyOn(fakeBrowser.tabs, "sendMessage").mockImplementation((async (
      tabId: number,
      payload: unknown,
    ) => {
      tabListeners.get(tabId)?.(
        payload,
        { id: fakeBrowser.runtime.id },
        () => {},
      );
      return { ok: true };
    }) as unknown as typeof fakeBrowser.tabs.sendMessage);

    const hub = createBridgeHub();
    const resolveSender = (req: {
      type?: string;
      site?: SiteKind;
      sourceTabId?: number;
    }) => {
      let tabId = activeActionTab ?? 20;
      if (
        req.type === BRIDGE_REGISTER_TYPE ||
        req.type === BRIDGE_PUSH_BATCH_TYPE
      ) {
        tabId = req.site === "twitch" ? 10 : 20;
      } else if (req.type === BRIDGE_SUBSCRIBE_TYPE) {
        tabId = req.sourceTabId === 10 ? 20 : 10;
      } else if (req.type === BRIDGE_UNREGISTER_TYPE) {
        tabId = activeActionTab ?? 20;
      }
      return tabId === 10
        ? {
            id: fakeBrowser.runtime.id,
            url: "https://www.twitch.tv/shroud",
            frameId: 0,
            tab: { id: 10 },
          }
        : {
            id: fakeBrowser.runtime.id,
            url: "https://www.youtube.com/watch?v=ytLive1",
            frameId: 0,
            tab: { id: 20 },
          };
    };

    harness.runtimeSend.mockImplementation((async (req: {
      type?: string;
      site?: SiteKind;
      sourceTabId?: number;
      items?: Array<{ message: NormalizedMessage }>;
    }) => {
      const sender = resolveSender(req);
      if (req.type === BRIDGE_PUSH_BATCH_TYPE && req.site && req.items) {
        pushedBatches.push({
          tabId: sender.tab.id,
          site: req.site,
          ids: req.items.map((item) => item.message.id),
        });
      }
      return await new Promise((resolve) => {
        const handled = hub.handleMessage(req, sender, (reply) =>
          resolve(reply),
        );
        if (!handled) {
          resolve(undefined);
        }
      });
    }) as unknown as () => Promise<undefined>);

    let emitYt!: (line: NormalizedMessage) => void;
    let emitTw!: (line: NormalizedMessage) => void;

    const flushHub = async () => {
      for (let i = 0; i < 12; i += 1) {
        await vi.advanceTimersByTimeAsync(0);
      }
    };

    currentAddTargetTab = 20;
    activeActionTab = 20;
    const ytRuntime = createRuntimeController((signal) =>
      startSiteRuntime(
        {
          site: "youtube-live",
          createAdapter: () => ({
            site: "youtube-live",
            start(cb) {
              emitYt = cb;
            },
            stop() {},
          }),
          isSiteActive: () => true,
          isSiteEnabled: () => true,
          resolveMountParent: () => document.body,
          isCrossSiteBridgeEligible: () => true,
          resolveBridgeChannelLogin: () => "ytLive1",
          resolveBridgeLabel: () => "YT Live Stream",
        },
        signal,
      ),
    );
    await ytRuntime.restart();
    await flushHub();

    currentAddTargetTab = 10;
    activeActionTab = 10;
    const twRuntime = createRuntimeController((signal) =>
      startSiteRuntime(
        {
          site: "twitch",
          createAdapter: () => ({
            site: "twitch",
            start(cb) {
              emitTw = cb;
            },
            stop() {},
          }),
          isSiteActive: () => true,
          isSiteEnabled: () => true,
          resolveMountParent: () => document.body,
          isCrossSiteBridgeEligible: () => true,
          resolveBridgeChannelLogin: () => "shroud",
        },
        signal,
      ),
    );
    await twRuntime.restart();
    await flushHub();

    const ytBridge = harness.panelOptionsBySite.get("youtube-live")?.bridge;
    const twBridge = harness.panelOptionsBySite.get("twitch")?.bridge;
    if (!ytBridge || !twBridge) {
      throw new Error("Missing bridge hooks");
    }

    activeActionTab = 20;
    ytBridge.onRefreshSources();
    await flushHub();
    expect(harness.panelBridgeStateBySite.get("youtube-live")?.sources).toEqual(
      [
        {
          tabId: 10,
          site: "twitch",
          channelLogin: "shroud",
          label: "#shroud",
        },
      ],
    );

    activeActionTab = 10;
    twBridge.onRefreshSources();
    await flushHub();
    expect(harness.panelBridgeStateBySite.get("twitch")?.sources).toEqual([
      {
        tabId: 20,
        site: "youtube-live",
        channelLogin: "ytLive1",
        label: "YT Live Stream",
      },
    ]);

    // Connect simultaneously: YouTube -> Twitch (+8s delay), Twitch -> YouTube (+0s delay).
    activeActionTab = 20;
    ytBridge.onSelectSource(10);
    await flushHub();
    ytBridge.onAdjustDelay(8);

    activeActionTab = 10;
    twBridge.onSelectSource(20);
    await flushHub();

    expect(harness.panelBridgeStateBySite.get("youtube-live")).toMatchObject({
      delaySec: 8,
      activeSource: { tabId: 10, site: "twitch", label: "#shroud" },
    });
    expect(harness.panelBridgeStateBySite.get("twitch")).toMatchObject({
      delaySec: 0,
      activeSource: {
        tabId: 20,
        site: "youtube-live",
        label: "YT Live Stream",
      },
    });
    expect(harness.panelNativeUrlBySite.get("youtube-live")).toBeNull();
    expect(harness.panelNativeUrlBySite.get("twitch")).toBeNull();

    // Emit one local comment on each tab.
    emitYt(
      message({ id: "yt-msg-1", site: "youtube-live", text: "YT original" }),
    );
    emitTw(message({ id: "tw-msg-1", site: "twitch", text: "TW original" }));

    // Immediately: each tab shows only its own local comment at normal timing.
    expect(
      harness.panelMessagesBySite
        .get("youtube-live")
        ?.map((m) => `${m.site}:${m.id}`),
    ).toEqual(["youtube-live:yt-msg-1"]);
    expect(
      harness.panelMessagesBySite
        .get("twitch")
        ?.map((m) => `${m.site}:${m.id}`),
    ).toEqual(["twitch:tw-msg-1"]);

    // After batch flush (200ms): Twitch (+0s) receives YT comment immediately; YouTube holds TW comment for +8s.
    await vi.advanceTimersByTimeAsync(200);
    await flushHub();
    expect(
      harness.panelMessagesBySite
        .get("twitch")
        ?.map((m) => `${m.site}:${m.id}`),
    ).toEqual(["twitch:tw-msg-1", "youtube-live:yt-msg-1"]);
    expect(
      harness.panelMessagesBySite
        .get("youtube-live")
        ?.map((m) => `${m.site}:${m.id}`),
    ).toEqual(["youtube-live:yt-msg-1"]);

    // After +8s: YouTube displays both YT local + delayed TW comment, with zero echo loops.
    await vi.advanceTimersByTimeAsync(8_000);
    expect(
      harness.panelMessagesBySite
        .get("youtube-live")
        ?.map((m) => `${m.site}:${m.id}`),
    ).toEqual(["youtube-live:yt-msg-1", "twitch:tw-msg-1"]);

    // Wait further to confirm no message is re-published back to its origin.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(
      harness.panelMessagesBySite
        .get("twitch")
        ?.map((m) => `${m.site}:${m.id}`),
    ).toEqual(["twitch:tw-msg-1", "youtube-live:yt-msg-1"]);
    expect(
      harness.panelMessagesBySite
        .get("youtube-live")
        ?.map((m) => `${m.site}:${m.id}`),
    ).toEqual(["youtube-live:yt-msg-1", "twitch:tw-msg-1"]);
    expect(pushedBatches).toEqual([
      { tabId: 20, site: "youtube-live", ids: ["yt-msg-1"] },
      { tabId: 10, site: "twitch", ids: ["tw-msg-1"] },
    ]);

    // Closing Twitch tab restores YouTube tab to local-only official chat.
    activeActionTab = 10;
    twRuntime.stop();
    await flushHub();
    await hub.handleTabRemoved(10);
    await flushHub();
    expect(
      harness.panelBridgeStateBySite.get("youtube-live")?.activeSource,
    ).toBeNull();
    expect(harness.panelNativeUrlBySite.get("youtube-live")).toBe(
      harness.nativeUrl,
    );

    activeActionTab = 20;
    ytRuntime.stop();
    hub.dispose();
  });

  it("extends mixed chat to danmaku, Document PiP, and OS bridge popout across both sites", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    vi.spyOn(fakeBrowser.runtime, "getURL").mockImplementation(
      (path) => `chrome-extension://${fakeBrowser.runtime.id}${path}`,
    );

    for (const hostSite of ["youtube-live", "twitch"] as const) {
      const peerSite: SiteKind =
        hostSite === "youtube-live" ? "twitch" : "youtube-live";
      const peerSource =
        peerSite === "twitch"
          ? {
              tabId: 77,
              site: "twitch" as const,
              channelLogin: "shroud",
              label: "#shroud",
            }
          : {
              tabId: 88,
              site: "youtube-live" as const,
              channelLogin: "ytLive1",
              label: "YT Live",
            };

      const initial = settings();
      initial.displayMode = "panel";
      initial.panel.useNativeChat = true;
      initial.danmakuOverlayOnPanel = true;
      initial.danmaku.enabled = true;
      harness.nativeUrl =
        hostSite === "youtube-live"
          ? "https://www.youtube.com/live_chat?v=abc"
          : "https://www.twitch.tv/embed/shroud/chat?parent=www.twitch.tv";
      harness.popoutTarget =
        hostSite === "youtube-live"
          ? {
              url: "https://www.youtube.com/live_chat?v=abc&is_popout=1",
              siteKey: "youtube",
            }
          : {
              url: "https://www.twitch.tv/popout/shroud/chat?popout=",
              siteKey: "twitch",
            };
      harness.load.mockResolvedValue(initial);
      harness.openPip.mockResolvedValue(true);
      harness.open.mockResolvedValue(true);
      harness.runtimeSend.mockImplementation((async (req: {
        type?: string;
        settings?: unknown;
      }) => {
        if (req.type === BRIDGE_LIST_SOURCES_TYPE) {
          return { sources: [peerSource] };
        }
        if (req.type === BRIDGE_SUBSCRIBE_TYPE) {
          return { source: peerSource };
        }
        if (req.settings) {
          return { ok: true, settings: req.settings };
        }
        return { ok: true };
      }) as unknown as () => Promise<undefined>);

      let emitLocal!: (line: NormalizedMessage) => void;
      const runtime = createRuntimeController((signal) =>
        startSiteRuntime(
          {
            site: hostSite,
            createAdapter: () => ({
              site: hostSite,
              start(cb) {
                emitLocal = cb;
              },
              stop() {},
            }),
            isSiteActive: () => true,
            isSiteEnabled: () => true,
            resolveMountParent: () => document.body,
            isCrossSiteBridgeEligible: () => true,
            resolveBridgeChannelLogin: () =>
              hostSite === "twitch" ? "shroud" : "abc",
          },
          signal,
        ),
      );
      await runtime.restart();

      const hooks = harness.panelOptionsBySite.get(hostSite)?.bridge;
      if (!hooks) {
        throw new Error("Missing bridge hooks");
      }
      hooks.onSelectSource(peerSource.tabId);
      await vi.advanceTimersByTimeAsync(0);

      expect(harness.danmakuSetMixedMode).toHaveBeenLastCalledWith(true);

      // Emit local + remote messages and verify both reach mixed danmaku once each.
      harness.danmakuPush.mockClear();
      emitLocal(
        message({ id: `${hostSite}-1`, site: hostSite, text: "local line" }),
      );
      harness.onRuntimeMessage?.(
        {
          type: BRIDGE_DELIVER_BATCH_TYPE,
          sourceTabId: peerSource.tabId,
          site: peerSite,
          channelLogin: peerSource.channelLogin,
          items: [
            {
              receivedAtMs: Date.now(),
              message: message({
                id: `${peerSite}-1`,
                site: peerSite,
                text: "peer line",
              }),
            },
          ],
        },
        { id: fakeBrowser.runtime.id },
        () => {},
      );
      expect(harness.danmakuPush).toHaveBeenCalledTimes(2);
      expect(harness.danmakuPush).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ id: `${hostSite}-1`, site: hostSite }),
      );
      expect(harness.danmakuPush).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ id: `${peerSite}-1`, site: peerSite }),
      );

      // Document PiP mode configures read-only mixed mode and passes both sites.
      harness.pipSetMessages.mockClear();
      harness.panelOptionsBySite.get(hostSite)?.onPinOnTop?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.pipSetBridgeMode).toHaveBeenLastCalledWith({
        active: true,
        headerLabel: peerSource.label,
        readOnly: true,
      });
      expect(harness.setPipNativeUrl).toHaveBeenLastCalledWith(null);
      expect(harness.pipSetMessages).toHaveBeenLastCalledWith([
        expect.objectContaining({ site: hostSite }),
        expect.objectContaining({ site: peerSite }),
      ]);

      // OS popout fallback syncs mixed snapshot via BRIDGE_POPOUT_SYNC_TYPE.
      harness.openPip.mockResolvedValue(false);
      harness.runtimeSend.mockClear();
      const osPopoutSettings = settings();
      osPopoutSettings.displayMode = "popout";
      osPopoutSettings.popout.alwaysOnTop = false;
      harness.load.mockResolvedValue(osPopoutSettings);
      await runtime.restart();

      const hooksPop = harness.panelOptionsBySite.get(hostSite)?.bridge;
      if (!hooksPop) {
        throw new Error("Missing bridge hooks");
      }
      hooksPop.onSelectSource(peerSource.tabId);
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.runtimeSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: BRIDGE_POPOUT_SYNC_TYPE,
          snapshot: expect.objectContaining({
            localSite: hostSite,
            peerSite,
            peerLabel: peerSource.label,
          }),
        }),
      );

      hooksPop.onDisconnect();
      expect(harness.danmakuSetMixedMode).toHaveBeenLastCalledWith(false);
      runtime.stop();
    }
  });

  it("keeps the latest peer subscribed in site-runtime when switching A -> B while subscribe(A) is in flight", async () => {
    const hub = createBridgeHub();
    await hub.restore();
    let deliverToYt: ((msg: unknown) => void) | null = null;
    vi.spyOn(fakeBrowser.tabs, "sendMessage").mockImplementation((async (
      tabId: number,
      payload: unknown,
    ) => {
      if (tabId === 30) {
        deliverToYt?.(payload);
      }
      return { ok: true };
    }) as unknown as typeof fakeBrowser.tabs.sendMessage);

    const hubDispatch = (payload: unknown, sender: Record<string, unknown>) =>
      new Promise<unknown>((resolve) => {
        const handled = hub.handleMessage(payload, sender as never, resolve);
        if (!handled) resolve(undefined);
      });

    await hubDispatch(
      {
        type: BRIDGE_REGISTER_TYPE,
        site: "twitch",
        channelLogin: "alpha",
        label: "#alpha",
      },
      {
        id: fakeBrowser.runtime.id,
        url: "https://www.twitch.tv/alpha",
        frameId: 0,
        tab: { id: 10 },
      },
    );
    await hubDispatch(
      {
        type: BRIDGE_REGISTER_TYPE,
        site: "twitch",
        channelLogin: "beta",
        label: "#beta",
      },
      {
        id: fakeBrowser.runtime.id,
        url: "https://www.twitch.tv/beta",
        frameId: 0,
        tab: { id: 20 },
      },
    );

    const gates = new Map<number, () => void>();
    const unsubscribeSent: unknown[] = [];
    harness.runtimeSend.mockImplementation((async (req: {
      type?: string;
      sourceTabId?: number;
    }) => {
      if (req.type === BRIDGE_UNSUBSCRIBE_TYPE) {
        unsubscribeSent.push(req);
      }
      const reply = await hubDispatch(req, {
        id: fakeBrowser.runtime.id,
        url: "https://www.youtube.com/watch?v=abc",
        frameId: 0,
        tab: { id: 30 },
      });
      if (
        req.type === BRIDGE_SUBSCRIBE_TYPE &&
        typeof req.sourceTabId === "number"
      ) {
        await new Promise<void>((resolve) => {
          gates.set(req.sourceTabId!, resolve);
        });
      }
      return reply;
    }) as unknown as () => Promise<undefined>);

    const initial = settings();
    initial.displayMode = "panel";
    initial.panel.useNativeChat = true;
    harness.nativeUrl = "https://www.youtube.com/live_chat?v=abc";
    harness.load.mockResolvedValue(initial);
    vi.stubGlobal("location", {
      hostname: "www.youtube.com",
      pathname: "/watch",
      search: "?v=abc",
      href: "https://www.youtube.com/watch?v=abc",
    });

    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(
        {
          site: "youtube-live",
          createAdapter: () => ({
            site: "youtube-live",
            start() {},
            stop() {},
          }),
          isSiteActive: () => true,
          isSiteEnabled: () => true,
          resolveMountParent: () => document.body,
          isCrossSiteBridgeEligible: () => true,
        },
        signal,
      ),
    );
    await runtime.restart();
    deliverToYt = (msg) =>
      harness.onRuntimeMessage?.(msg, { id: fakeBrowser.runtime.id }, () => {});

    const hooks = harness.panelOptions?.bridge;
    if (!hooks) throw new Error("Missing bridge hooks");

    hooks.onSelectSource(10);
    await vi.waitFor(() => expect(gates.has(10)).toBe(true));
    hooks.onSelectSource(20);
    await vi.waitFor(() => expect(gates.has(20)).toBe(true));

    // Resolve A before B.
    gates.get(10)!();
    await Promise.resolve();
    await Promise.resolve();
    gates.get(20)!();
    await vi.waitFor(() =>
      expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          activeSource: expect.objectContaining({ tabId: 20, label: "#beta" }),
        }),
      ),
    );
    expect(unsubscribeSent).toHaveLength(0);

    await hubDispatch(
      {
        type: BRIDGE_PUSH_BATCH_TYPE,
        site: "twitch",
        channelLogin: "beta",
        items: [
          {
            receivedAtMs: Date.now(),
            message: message({ id: "beta-1", site: "twitch", text: "beta ok" }),
          },
        ],
      },
      {
        id: fakeBrowser.runtime.id,
        url: "https://www.twitch.tv/beta",
        frameId: 0,
        tab: { id: 20 },
      },
    );
    expect(harness.panelSetMessages).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: "beta-1",
        site: "twitch",
        text: "beta ok",
      }),
    ]);

    runtime.stop();
    hub.dispose();
  });

  it("clears only remote danmaku on live pause while keeping local danmaku and delay intact, then resumes delayed delivery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const initial = settings();
    initial.displayMode = "panel";
    initial.panel.useNativeChat = false;
    initial.danmakuOverlayOnPanel = true;
    initial.danmaku.enabled = true;
    harness.nativeUrl = null;
    harness.load.mockResolvedValue(initial);
    vi.stubGlobal("location", {
      hostname: "www.youtube.com",
      pathname: "/watch",
      search: "?v=abc",
      href: "https://www.youtube.com/watch?v=abc",
    });

    const source = {
      tabId: 77,
      site: "twitch" as const,
      channelLogin: "shroud",
      label: "#shroud",
    };
    harness.runtimeSend.mockImplementation((async (req: { type?: string }) => {
      if (req.type === BRIDGE_LIST_SOURCES_TYPE) return { sources: [source] };
      if (req.type === BRIDGE_SUBSCRIBE_TYPE) return { source };
      return { ok: true };
    }) as unknown as () => Promise<undefined>);

    let emitYt!: (line: NormalizedMessage) => void;
    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(
        {
          site: "youtube-live",
          createAdapter: () => ({
            site: "youtube-live",
            start(cb) {
              emitYt = cb;
            },
            stop() {},
          }),
          isSiteActive: () => true,
          isSiteEnabled: () => true,
          resolveMountParent: () => document.body,
          isCrossSiteBridgeEligible: () => true,
        },
        signal,
      ),
    );
    await runtime.restart();

    harness.panelOptions?.bridge?.onSelectSource(77);
    await vi.advanceTimersByTimeAsync(0);
    harness.panelOptions?.bridge?.onAdjustDelay(8);

    emitYt(message({ id: "yt-keep", site: "youtube-live", text: "YT stays" }));
    harness.onRuntimeMessage?.(
      {
        type: BRIDGE_DELIVER_BATCH_TYPE,
        sourceTabId: 77,
        site: "twitch",
        channelLogin: "shroud",
        items: [
          {
            receivedAtMs: 10_000,
            message: message({ id: "tw-1", site: "twitch", text: "TW before" }),
          },
        ],
      },
      { id: fakeBrowser.runtime.id },
      () => {},
    );
    vi.advanceTimersByTime(8_000);
    expect(harness.danmakuPush).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tw-1", site: "twitch" }),
    );

    harness.danmakuClear.mockClear();
    harness.danmakuClearSite.mockClear();
    harness.danmakuPush.mockClear();
    harness.onPlaybackInterrupt?.("pause");

    expect(harness.danmakuClearSite).toHaveBeenCalledTimes(1);
    expect(harness.danmakuClearSite).toHaveBeenCalledWith("twitch");
    expect(harness.danmakuClear).not.toHaveBeenCalled();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ suspendedReason: "pause", delaySec: 8 }),
    );
    expect(harness.panelSetMessages).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "yt-keep", site: "youtube-live" }),
    ]);

    harness.panelOptions?.bridge?.onResume();
    const resumedAtMs = Date.now();
    harness.onRuntimeMessage?.(
      {
        type: BRIDGE_DELIVER_BATCH_TYPE,
        sourceTabId: 77,
        site: "twitch",
        channelLogin: "shroud",
        items: [
          {
            receivedAtMs: resumedAtMs,
            message: message({
              id: "tw-2",
              site: "twitch",
              text: "TW resumed",
            }),
          },
        ],
      },
      { id: fakeBrowser.runtime.id },
      () => {},
    );
    // Resumed +8s delay holds tw-2 until 8_000ms elapse.
    vi.advanceTimersByTime(7_500);
    expect(harness.danmakuPush).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "tw-2" }),
    );
    vi.advanceTimersByTime(500);
    expect(harness.danmakuPush).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tw-2",
        site: "twitch",
        text: "TW resumed",
      }),
    );
    expect(harness.panelSetMessages).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "yt-keep", site: "youtube-live" }),
      expect.objectContaining({ id: "tw-2", site: "twitch" }),
    ]);

    runtime.stop();
  });

  it("ignores Twitch ad markers inside hidden ancestors, blocks resume during an active ad, and resumes with delay intact after the ad ends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    harness.useRealInterruptWatch = true;

    class FakeVideoElement extends EventTarget {
      paused = false;
      ended = false;
      seeking = false;
      error: { code: number } | null = null;
      currentTime = 0;
      getBoundingClientRect() {
        return { width: 640, height: 360 };
      }
    }
    const video = new FakeVideoElement();
    const playerContainer = {
      hidden: false,
      style: { display: "" },
    };
    const adParent = {
      hidden: false,
      style: { display: "none" },
      parentElement: playerContainer,
      getAttribute: () => null,
    };
    const adMarker = {
      hidden: false,
      style: { display: "" },
      parentElement: adParent,
      getAttribute: () => null,
    };
    vi.stubGlobal("HTMLVideoElement", FakeVideoElement);
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), {
        documentElement: {},
        body: {},
        getElementById: () => null,
        querySelector: (selector: string) =>
          selector.includes("video-player__container") ? playerContainer : null,
        querySelectorAll: (selector: string) => {
          if (selector === "video") return [video];
          if (selector.includes("video-ad-label")) return [adMarker];
          return [];
        },
      }),
    );
    vi.stubGlobal("location", {
      hostname: "www.twitch.tv",
      pathname: "/shroud",
      search: "",
      href: "https://www.twitch.tv/shroud",
    });

    const initial = settings();
    initial.displayMode = "panel";
    initial.panel.useNativeChat = false;
    initial.danmakuOverlayOnPanel = true;
    initial.danmaku.enabled = true;
    harness.nativeUrl = null;
    harness.load.mockResolvedValue(initial);

    const source = {
      tabId: 88,
      site: "youtube-live" as const,
      channelLogin: "ytch",
      label: "YT Bridge",
    };
    harness.runtimeSend.mockImplementation((async (req: { type?: string }) => {
      if (req.type === BRIDGE_LIST_SOURCES_TYPE) return { sources: [source] };
      if (req.type === BRIDGE_SUBSCRIBE_TYPE) return { source };
      return { ok: true };
    }) as unknown as () => Promise<undefined>);

    const runtime = createRuntimeController((signal) =>
      startSiteRuntime(
        {
          site: "twitch",
          createAdapter: () => ({ site: "twitch", start() {}, stop() {} }),
          isSiteActive: () => true,
          isSiteEnabled: () => true,
          resolveMountParent: () => document.body,
          isCrossSiteBridgeEligible: () => true,
        },
        signal,
      ),
    );
    await runtime.restart();

    harness.panelOptions?.bridge?.onSelectSource(88);
    await vi.advanceTimersByTimeAsync(0);
    harness.panelOptions?.bridge?.onAdjustDelay(8);

    // Hidden parent around Twitch ad marker must NOT interrupt delivery.
    harness.onRuntimeMessage?.(
      {
        type: BRIDGE_DELIVER_BATCH_TYPE,
        sourceTabId: 88,
        site: "youtube-live",
        channelLogin: "ytch",
        items: [
          {
            receivedAtMs: 10_000,
            message: message({
              id: "yt-1",
              site: "youtube-live",
              text: "YT passes hidden ad",
            }),
          },
        ],
      },
      { id: fakeBrowser.runtime.id },
      () => {},
    );
    vi.advanceTimersByTime(8_000);
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ suspendedReason: null, delaySec: 8 }),
    );
    expect(harness.panelSetMessages).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: "yt-1",
        site: "youtube-live",
        text: "YT passes hidden ad",
      }),
    ]);
    expect(harness.danmakuPush).toHaveBeenCalledWith(
      expect.objectContaining({ id: "yt-1", site: "youtube-live" }),
    );

    // Unhiding the parent triggers "ad" suspension while preserving +8s delay.
    harness.danmakuClearSite.mockClear();
    adParent.style.display = "";
    vi.advanceTimersByTime(500);
    expect(harness.danmakuClearSite).toHaveBeenCalledWith("youtube-live");
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ suspendedReason: "ad", delaySec: 8 }),
    );

    // Manual resume while ad is still visible remains blocked.
    harness.panelSetMessages.mockClear();
    harness.danmakuPush.mockClear();
    harness.panelOptions?.bridge?.onResume();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ suspendedReason: "ad", delaySec: 8 }),
    );
    harness.onRuntimeMessage?.(
      {
        type: BRIDGE_DELIVER_BATCH_TYPE,
        sourceTabId: 88,
        site: "youtube-live",
        channelLogin: "ytch",
        items: [
          {
            receivedAtMs: Date.now(),
            message: message({
              id: "yt-during-ad",
              site: "youtube-live",
              text: "YT during ad",
            }),
          },
        ],
      },
      { id: fakeBrowser.runtime.id },
      () => {},
    );
    vi.advanceTimersByTime(10_000);
    expect(harness.danmakuPush).not.toHaveBeenCalled();
    expect(harness.panelSetMessages).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "yt-during-ad" })]),
    );

    // Re-hiding the ad parent allows manual resume with +8s delay intact.
    adParent.style.display = "none";
    vi.advanceTimersByTime(500);
    harness.panelOptions?.bridge?.onResume();
    expect(harness.panelSetBridgeState).toHaveBeenLastCalledWith(
      expect.objectContaining({ suspendedReason: null, delaySec: 8 }),
    );

    const resumedAtMs = Date.now();
    harness.onRuntimeMessage?.(
      {
        type: BRIDGE_DELIVER_BATCH_TYPE,
        sourceTabId: 88,
        site: "youtube-live",
        channelLogin: "ytch",
        items: [
          {
            receivedAtMs: resumedAtMs,
            message: message({
              id: "yt-after-ad",
              site: "youtube-live",
              text: "YT after ad",
            }),
          },
        ],
      },
      { id: fakeBrowser.runtime.id },
      () => {},
    );
    vi.advanceTimersByTime(7_500);
    expect(harness.danmakuPush).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "yt-after-ad" }),
    );
    vi.advanceTimersByTime(500);
    expect(harness.danmakuPush).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "yt-after-ad",
        site: "youtube-live",
        text: "YT after ad",
      }),
    );
    expect(harness.panelSetMessages).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: "yt-after-ad",
        site: "youtube-live",
        text: "YT after ad",
      }),
    ]);

    runtime.stop();
  });
});
