import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  POPOUT_CLOSE_TYPE,
  POPOUT_OPEN_TYPE,
  POPOUT_QUERY_TYPE,
} from "../../src/shared/runtime-messages";

describe("background popout management and command forwarding", () => {
  let stopBackground: (() => void) | null = null;
  let windowsOnRemoved: ((windowId: number) => void)[] = [];
  let onBoundsChanged: ((win: Record<string, unknown>) => void)[] = [];
  let onCommandListeners: ((command: string) => Promise<void> | void)[] = [];
  let createdWindows: Array<Record<string, unknown>> = [];
  let tabsSendMessage: ReturnType<typeof vi.fn>;
  let tabsQuery: ReturnType<typeof vi.fn>;
  let tabsUpdate: ReturnType<typeof vi.fn>;
  let focusedTabId: number;
  let runtimeListener:
    | ((
        message: unknown,
        sender: unknown,
        sendResponse: (reply?: unknown) => void,
      ) => unknown)
    | null = null;
  const popoutUrl = "https://www.youtube.com/live_chat?v=abc&is_popout=1";

  beforeEach(async () => {
    vi.resetModules();
    fakeBrowser.reset();
    windowsOnRemoved = [];
    onBoundsChanged = [];
    onCommandListeners = [];
    createdWindows = [];
    tabsSendMessage = vi.fn(async () => ({ ok: true }));
    tabsQuery = vi.fn(async () => []);
    tabsUpdate = vi.fn(async () => ({}));
    focusedTabId = 42;
    runtimeListener = null;

    vi.stubGlobal("defineBackground", (fn: () => void) => fn);

    vi.spyOn(fakeBrowser.runtime.onMessage, "addListener").mockImplementation(
      (cb) => {
        runtimeListener = cb as typeof runtimeListener;
      },
    );
    vi.spyOn(
      fakeBrowser.runtime.onMessage,
      "removeListener",
    ).mockImplementation(() => {});

    vi.spyOn(fakeBrowser.windows, "create").mockImplementation((async (
      opts?: Record<string, unknown>,
    ) => {
      createdWindows.push(opts ?? {});
      return { id: 99, tabs: [{ id: 199, url: opts?.url }] };
    }) as unknown as typeof fakeBrowser.windows.create);
    vi.spyOn(fakeBrowser.windows, "get").mockImplementation((async (
      windowId: number,
    ) => ({
      id: windowId,
      tabs: [{ id: 199, url: popoutUrl }],
    })) as unknown as typeof fakeBrowser.windows.get);
    vi.spyOn(fakeBrowser.windows, "getAll").mockImplementation(
      (async () => []) as unknown as typeof fakeBrowser.windows.getAll,
    );
    vi.spyOn(fakeBrowser.windows, "update").mockImplementation(
      (async () => ({})) as unknown as typeof fakeBrowser.windows.update,
    );
    vi.spyOn(fakeBrowser.windows, "remove").mockImplementation(
      (async () => undefined) as unknown as typeof fakeBrowser.windows.remove,
    );
    fakeBrowser.windows.getLastFocused = (async () => ({
      id: 1,
      type: "normal",
      tabs: [{ id: focusedTabId, active: true }],
    })) as unknown as typeof fakeBrowser.windows.getLastFocused;
    vi.spyOn(fakeBrowser.windows.onRemoved, "addListener").mockImplementation(
      (cb) => {
        windowsOnRemoved.push(cb);
      },
    );
    vi.spyOn(
      fakeBrowser.windows.onRemoved,
      "removeListener",
    ).mockImplementation(() => {});
    vi.spyOn(
      fakeBrowser.windows.onBoundsChanged,
      "addListener",
    ).mockImplementation((cb) => {
      onBoundsChanged.push(
        cb as unknown as (win: Record<string, unknown>) => void,
      );
    });
    vi.spyOn(
      fakeBrowser.windows.onBoundsChanged,
      "removeListener",
    ).mockImplementation(() => {});

    vi.spyOn(fakeBrowser.tabs, "sendMessage").mockImplementation(
      tabsSendMessage as unknown as typeof fakeBrowser.tabs.sendMessage,
    );
    vi.spyOn(fakeBrowser.tabs, "query").mockImplementation(
      tabsQuery as unknown as typeof fakeBrowser.tabs.query,
    );
    vi.spyOn(fakeBrowser.tabs, "update").mockImplementation(
      tabsUpdate as unknown as typeof fakeBrowser.tabs.update,
    );

    vi.spyOn(fakeBrowser.commands.onCommand, "addListener").mockImplementation(
      (cb) => {
        onCommandListeners.push(cb);
      },
    );
    vi.spyOn(
      fakeBrowser.commands.onCommand,
      "removeListener",
    ).mockImplementation(() => {});

    const mod = await import("../../src/entrypoints/background");
    stopBackground = mod.registerBackgroundHandlers();
  });

  afterEach(() => {
    stopBackground?.();
    stopBackground = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function dispatch(
    message: unknown,
    sender: Record<string, unknown>,
  ): Promise<{ handled: boolean; reply: unknown }> {
    let reply: unknown;
    let resolved = false;
    const ret = runtimeListener?.(message, sender, (value) => {
      reply = value;
      resolved = true;
    });
    if (ret === true) {
      await vi.waitFor(() => expect(resolved).toBe(true));
    }
    return { handled: ret === true, reply };
  }

  it("rejects untrusted senders and disallowed popout URLs", async () => {
    const untrusted = await dispatch(
      {
        type: POPOUT_OPEN_TYPE,
        url: popoutUrl,
        siteKey: "youtube",
      },
      { id: "evil-ext", tab: { id: 10 } },
    );
    expect(untrusted.handled).toBe(false);

    for (const url of [
      "https://evil.example/live_chat",
      "https://www.youtube.com/watch?v=abc",
      `chrome-extension://${fakeBrowser.runtime.id}/popout-chat.html`,
    ]) {
      const badUrl = await dispatch(
        {
          type: POPOUT_OPEN_TYPE,
          url,
          siteKey: "youtube",
        },
        { id: fakeBrowser.runtime.id, tab: { id: 10 } },
      );
      expect(badUrl.handled).toBe(false);
    }
    expect(createdWindows).toHaveLength(0);
  });

  it("tracks owner tab, routes page commands from focused popout, and ignores offscreen bounds", async () => {
    const extId = fakeBrowser.runtime.id;
    await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    expect(createdWindows).toHaveLength(1);

    const queryRes = await dispatch(
      { type: POPOUT_QUERY_TYPE },
      { id: extId, tab: { id: 42 } },
    );
    expect(queryRes.reply).toEqual({
      open: true,
      windowId: 99,
      siteKey: "youtube",
    });

    // When the managed popout is focused, page-level commands route back to owner tab 42
    tabsQuery.mockResolvedValue([{ id: 199, windowId: 99 }]);
    for (const cb of onCommandListeners) {
      await cb("cycle-display-mode");
    }
    expect(tabsSendMessage).toHaveBeenCalledWith(42, {
      type: "fce:command",
      command: "cycle-display-mode",
    });

    // Compose focus stays on the focused popout tab
    tabsSendMessage.mockClear();
    for (const cb of onCommandListeners) {
      await cb("toggle-compose-focus");
    }
    expect(tabsSendMessage).toHaveBeenCalledWith(199, {
      type: "fce:command",
      command: "toggle-compose-focus",
    });

    // Minimized offscreen bounds (-32000) are not persisted
    for (const cb of onBoundsChanged) {
      cb({ id: 99, left: -32000, top: -32000, width: 400, height: 700 });
    }
    await Promise.resolve();
    const stored = await fakeBrowser.storage.local.get("settings");
    expect(stored.settings).toBeUndefined();

    // Removing the managed window clears state
    for (const cb of windowsOnRemoved) {
      cb(99);
    }
    const afterClose = await dispatch(
      { type: POPOUT_QUERY_TYPE },
      { id: extId, tab: { id: 42 } },
    );
    expect(afterClose.reply).toEqual({
      open: false,
      windowId: null,
      siteKey: null,
    });
  });

  it("returns to the panel only when the user closes the popout", async () => {
    const extId = fakeBrowser.runtime.id;
    const { loadSettings, saveSettings } =
      await import("../../src/shared/settings");
    const closeByUser = async () => {
      for (const cb of windowsOnRemoved) {
        cb(99);
      }
      // Let the queued removal task finish before asserting a non-change.
      await new Promise((resolve) => setTimeout(resolve, 20));
    };

    await saveSettings({ displayMode: "popout" });
    await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    await dispatch({ type: POPOUT_CLOSE_TYPE }, { id: extId, tab: { id: 42 } });
    expect(fakeBrowser.windows.remove).toHaveBeenCalledWith(99);
    await closeByUser();
    expect((await loadSettings()).displayMode).toBe("popout");

    await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    await closeByUser();
    expect((await loadSettings()).displayMode).toBe("panel");
  });

  it("returns to the panel when a page request notices the closed popout first", async () => {
    const extId = fakeBrowser.runtime.id;
    const { loadSettings, saveSettings } =
      await import("../../src/shared/settings");
    await saveSettings({ displayMode: "popout" });
    await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    vi.spyOn(fakeBrowser.windows, "get").mockRejectedValue(
      new Error("No window with id: 99."),
    );
    // The page regains focus and asks again before windows.onRemoved arrives.
    const reopen = await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    expect(reopen.reply).toEqual({ accepted: false });
    expect(createdWindows).toHaveLength(1);
    for (const cb of windowsOnRemoved) {
      cb(99);
    }
    await vi.waitFor(async () =>
      expect((await loadSettings()).displayMode).toBe("panel"),
    );
  });

  it("recognizes the closed popout from session storage after a restart", async () => {
    const extId = fakeBrowser.runtime.id;
    const { loadSettings, saveSettings } =
      await import("../../src/shared/settings");
    await saveSettings({ displayMode: "popout" });
    await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    stopBackground?.();
    windowsOnRemoved = [];
    // Keep the startup restore pending so only the session record knows 99.
    vi.spyOn(fakeBrowser.windows, "get").mockImplementation(
      (() =>
        new Promise(() => {})) as unknown as typeof fakeBrowser.windows.get,
    );
    const mod = await import("../../src/entrypoints/background");
    stopBackground = mod.registerBackgroundHandlers();

    for (const cb of windowsOnRemoved) {
      cb(99);
    }
    await vi.waitFor(async () =>
      expect((await loadSettings()).displayMode).toBe("panel"),
    );
  });

  it("distinguishes replay popout windows by continuation token", async () => {
    const extId = fakeBrowser.runtime.id;
    const replayA =
      "https://www.youtube.com/live_chat_replay?continuation=contA&is_popout=1";
    const replayB =
      "https://www.youtube.com/live_chat_replay?continuation=contB&is_popout=1";
    vi.spyOn(fakeBrowser.windows, "getAll").mockImplementation((async () => [
      {
        id: 77,
        tabs: [{ id: 177, url: replayA }],
      },
    ]) as unknown as typeof fakeBrowser.windows.getAll);

    const openB = await dispatch(
      { type: POPOUT_OPEN_TYPE, url: replayB, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    expect(openB.handled).toBe(true);
    expect(createdWindows).toHaveLength(1);
    expect(createdWindows[0]?.url).toBe(replayB);

    const openA = await dispatch(
      { type: POPOUT_OPEN_TYPE, url: replayA, siteKey: "youtube", focus: true },
      { id: extId, tab: { id: 42 } },
    );
    expect(openA.handled).toBe(true);
    expect(fakeBrowser.windows.update).toHaveBeenCalledWith(77, {
      focused: true,
    });
  });

  it("focuses the reused window only for explicit requests", async () => {
    const extId = fakeBrowser.runtime.id;
    const twitchUrl = "https://www.twitch.tv/popout/k4sen/chat?popout=";
    await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    // Returning to the watch tab reclaims it without stealing focus.
    const reclaim = await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    expect(reclaim.reply).toEqual({ accepted: true });
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(fakeBrowser.windows.update).not.toHaveBeenCalled();

    focusedTabId = 7;
    await dispatch(
      { type: POPOUT_OPEN_TYPE, url: twitchUrl, siteKey: "twitch" },
      { id: extId, tab: { id: 7 } },
    );
    expect(tabsUpdate).toHaveBeenCalledWith(199, { url: twitchUrl });
    expect(fakeBrowser.windows.update).not.toHaveBeenCalled();

    await dispatch(
      {
        type: POPOUT_OPEN_TYPE,
        url: twitchUrl,
        siteKey: "twitch",
        focus: true,
      },
      { id: extId, tab: { id: 7 } },
    );
    expect(fakeBrowser.windows.update).toHaveBeenCalledWith(99, {
      focused: true,
    });
    expect(createdWindows).toHaveLength(1);
  });

  it("creates the window in the background unless focus was asked for", async () => {
    const extId = fakeBrowser.runtime.id;
    await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    expect(createdWindows[0]?.focused).toBe(false);
    await dispatch({ type: POPOUT_CLOSE_TYPE }, { id: extId, tab: { id: 42 } });
    await dispatch(
      {
        type: POPOUT_OPEN_TYPE,
        url: popoutUrl,
        siteKey: "youtube",
        focus: true,
      },
      { id: extId, tab: { id: 42 } },
    );
    expect(createdWindows[1]?.focused).toBe(true);
  });

  it("closes the window when the close arrives while it is still being created", async () => {
    const extId = fakeBrowser.runtime.id;
    let release!: (created: unknown) => void;
    vi.mocked(fakeBrowser.windows.create).mockImplementationOnce(((
      opts?: Record<string, unknown>,
    ) => {
      createdWindows.push(opts ?? {});
      return new Promise((resolve) => {
        release = resolve;
      });
    }) as unknown as typeof fakeBrowser.windows.create);
    const sender = { id: extId, tab: { id: 42 } };
    const open = dispatch(
      {
        type: POPOUT_OPEN_TYPE,
        url: popoutUrl,
        siteKey: "youtube",
        focus: true,
      },
      sender,
    );
    const close = dispatch({ type: POPOUT_CLOSE_TYPE }, sender);
    await vi.waitFor(() => expect(release).toEqual(expect.any(Function)));
    release({ id: 99, tabs: [{ id: 199, url: popoutUrl }] });
    expect((await open).reply).toEqual({ accepted: true });
    await close;
    expect(fakeBrowser.windows.remove).toHaveBeenCalledWith(99);
  });

  it("retries a background create once without focused, but not a focused one", async () => {
    const extId = fakeBrowser.runtime.id;
    const create = vi.mocked(fakeBrowser.windows.create);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    create.mockRejectedValueOnce(new Error("focused: false unsupported"));
    const unfocused = await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    expect(unfocused.reply).toEqual({ accepted: true });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[0]).not.toHaveProperty("focused");

    await dispatch({ type: POPOUT_CLOSE_TYPE }, { id: extId, tab: { id: 42 } });
    create.mockClear();
    create.mockRejectedValueOnce(new Error("window creation failed"));
    const focused = await dispatch(
      {
        type: POPOUT_OPEN_TYPE,
        url: popoutUrl,
        siteKey: "youtube",
        focus: true,
      },
      { id: extId, tab: { id: 42 } },
    );
    expect(focused.reply).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      "[fce] popout request failed",
      expect.any(Error),
    );
    const query = await dispatch(
      { type: POPOUT_QUERY_TYPE },
      { id: extId, tab: { id: 42 } },
    );
    expect(query.reply).toEqual({ open: false, windowId: null, siteKey: null });
  });

  it("keeps managing a window that is still open when retargeting it fails", async () => {
    const extId = fakeBrowser.runtime.id;
    const { loadSettings, saveSettings } =
      await import("../../src/shared/settings");
    const twitchUrl = "https://www.twitch.tv/popout/k4sen/chat?popout=";
    await saveSettings({ displayMode: "popout" });
    await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    tabsUpdate.mockRejectedValueOnce(new Error("Cannot update tab"));
    const failed = await dispatch(
      { type: POPOUT_OPEN_TYPE, url: twitchUrl, siteKey: "twitch" },
      { id: extId, tab: { id: 42 } },
    );
    expect(failed.reply).toEqual({ accepted: false });
    expect((await loadSettings()).displayMode).toBe("popout");
    await dispatch({ type: POPOUT_CLOSE_TYPE }, { id: extId, tab: { id: 42 } });
    expect(fakeBrowser.windows.remove).toHaveBeenCalledWith(99);
  });

  it("routes a command from the popout to its owner right after a restart", async () => {
    const extId = fakeBrowser.runtime.id;
    await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    stopBackground?.();
    onCommandListeners = [];
    // Startup restore is still waiting on windows.get when the command lands.
    vi.spyOn(fakeBrowser.windows, "get").mockImplementation((async (
      windowId: number,
    ) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { id: windowId, tabs: [{ id: 199, url: popoutUrl }] };
    }) as unknown as typeof fakeBrowser.windows.get);
    const mod = await import("../../src/entrypoints/background");
    stopBackground = mod.registerBackgroundHandlers();
    tabsQuery.mockResolvedValue([{ id: 199, windowId: 99 }]);
    for (const cb of onCommandListeners) {
      await cb("cycle-display-mode");
    }
    expect(tabsSendMessage).toHaveBeenCalledWith(42, {
      type: "fce:command",
      command: "cycle-display-mode",
    });
  });

  it("rejects close from a background non-owner tab and open from the popout itself", async () => {
    const extId = fakeBrowser.runtime.id;
    await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    await dispatch({ type: POPOUT_CLOSE_TYPE }, { id: extId, tab: { id: 7 } });
    expect(fakeBrowser.windows.remove).not.toHaveBeenCalled();

    // The popup window's own tab is never the active tab of a normal window.
    const fromPopup = await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 199, windowId: 99 } },
    );
    expect(fromPopup.reply).toEqual({ accepted: false });

    await dispatch({ type: POPOUT_CLOSE_TYPE }, { id: extId, tab: { id: 42 } });
    expect(fakeBrowser.windows.remove).toHaveBeenCalledWith(99);
  });

  it("ignores a background tab so it cannot replace the watched chat", async () => {
    const extId = fakeBrowser.runtime.id;
    const twitchUrl = "https://www.twitch.tv/popout/k4sen/chat?popout=";
    const opened = await dispatch(
      { type: POPOUT_OPEN_TYPE, url: popoutUrl, siteKey: "youtube" },
      { id: extId, tab: { id: 42 } },
    );
    expect(opened.reply).toEqual({ accepted: true });
    expect(createdWindows).toHaveLength(1);

    const background = await dispatch(
      { type: POPOUT_OPEN_TYPE, url: twitchUrl, siteKey: "twitch" },
      { id: extId, tab: { id: 7 } },
    );
    expect(background.reply).toEqual({ accepted: false });
    expect(tabsUpdate).not.toHaveBeenCalled();
    expect(createdWindows).toHaveLength(1);

    focusedTabId = 7;
    const watched = await dispatch(
      { type: POPOUT_OPEN_TYPE, url: twitchUrl, siteKey: "twitch" },
      { id: extId, tab: { id: 7 } },
    );
    expect(watched.reply).toEqual({ accepted: true });
    expect(tabsUpdate).toHaveBeenCalledWith(199, { url: twitchUrl });
  });

  it("does not reopen from a focus:false claim after the user closed the popout", async () => {
    const extId = fakeBrowser.runtime.id;
    const { loadSettings, saveSettings } =
      await import("../../src/shared/settings");
    await saveSettings({ displayMode: "popout" });
    await dispatch(
      {
        type: POPOUT_OPEN_TYPE,
        url: popoutUrl,
        siteKey: "youtube",
        focus: true,
      },
      { id: extId, tab: { id: 42 } },
    );
    for (const cb of windowsOnRemoved) {
      cb(99);
    }
    const reclaim = await dispatch(
      {
        type: POPOUT_OPEN_TYPE,
        url: popoutUrl,
        siteKey: "youtube",
        focus: false,
      },
      { id: extId, tab: { id: 42 } },
    );
    expect(reclaim.reply).toEqual({ accepted: false });
    expect(createdWindows).toHaveLength(1);
    expect((await loadSettings()).displayMode).toBe("panel");
  });

  it("serializes POPOUT_QUERY behind an in-flight extension close", async () => {
    const extId = fakeBrowser.runtime.id;
    const { loadSettings, saveSettings } =
      await import("../../src/shared/settings");
    await saveSettings({ displayMode: "popout" });
    await dispatch(
      {
        type: POPOUT_OPEN_TYPE,
        url: popoutUrl,
        siteKey: "youtube",
        focus: true,
      },
      { id: extId, tab: { id: 42 } },
    );
    let releaseRemove!: () => void;
    vi.mocked(fakeBrowser.windows.remove).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseRemove = resolve;
        }),
    );
    const closeReq = dispatch(
      { type: POPOUT_CLOSE_TYPE },
      { id: extId, tab: { id: 42 } },
    );
    const queryReq = dispatch(
      { type: POPOUT_QUERY_TYPE },
      { id: extId, tab: { id: 42 } },
    );
    await vi.waitFor(() => expect(releaseRemove).toEqual(expect.any(Function)));
    releaseRemove();
    await closeReq;
    const queryRes = await queryReq;
    expect(queryRes.reply).toEqual({
      open: false,
      windowId: null,
      siteKey: null,
    });
    expect((await loadSettings()).displayMode).toBe("popout");
  });
});
