import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  createBridgePublisher,
  createBridgeSubscriber,
} from "../../src/app/bridge-client";
import {
  BRIDGE_DELIVER_BATCH_TYPE,
  BRIDGE_DEMAND_TYPE,
  BRIDGE_LIST_SOURCES_TYPE,
  BRIDGE_POPOUT_SUBSCRIBE_TYPE,
  BRIDGE_POPOUT_SYNC_TYPE,
  BRIDGE_POPOUT_UPDATE_TYPE,
  BRIDGE_PUSH_BATCH_TYPE,
  BRIDGE_REGISTER_TYPE,
  BRIDGE_SOURCE_STATUS_TYPE,
  BRIDGE_SUBSCRIBE_TYPE,
  BRIDGE_UNREGISTER_TYPE,
  BRIDGE_UNSUBSCRIBE_TYPE,
} from "../../src/shared/bridge-messages";
import { message } from "../helpers";

describe("background cross-tab bridge hub", () => {
  let stopBackground: (() => void) | null = null;
  let tabsSendMessage: ReturnType<typeof vi.fn>;
  let tabsOnRemovedListeners: Array<(tabId: number) => void> = [];
  let runtimeListener:
    | ((
        msg: unknown,
        sender: unknown,
        sendResponse: (reply?: unknown) => void,
      ) => unknown)
    | null = null;

  beforeEach(async () => {
    vi.resetModules();
    fakeBrowser.reset();
    tabsOnRemovedListeners = [];
    tabsSendMessage = vi.fn(async () => ({ ok: true }));
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
    vi.spyOn(fakeBrowser.tabs, "sendMessage").mockImplementation(
      tabsSendMessage as unknown as typeof fakeBrowser.tabs.sendMessage,
    );
    vi.spyOn(fakeBrowser.tabs.onRemoved, "addListener").mockImplementation(
      (cb) => {
        tabsOnRemovedListeners.push(cb as (tabId: number) => void);
      },
    );
    vi.spyOn(fakeBrowser.tabs.onRemoved, "removeListener").mockImplementation(
      () => {},
    );
    vi.spyOn(fakeBrowser.windows.onRemoved, "addListener").mockImplementation(
      () => {},
    );
    vi.spyOn(
      fakeBrowser.windows.onRemoved,
      "removeListener",
    ).mockImplementation(() => {});
    vi.spyOn(
      fakeBrowser.windows.onBoundsChanged,
      "addListener",
    ).mockImplementation(() => {});
    vi.spyOn(
      fakeBrowser.windows.onBoundsChanged,
      "removeListener",
    ).mockImplementation(() => {});
    vi.spyOn(fakeBrowser.commands.onCommand, "addListener").mockImplementation(
      () => {},
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
    payload: unknown,
    sender: Record<string, unknown>,
  ): Promise<{ handled: boolean; reply: unknown }> {
    let reply: unknown;
    let resolved = false;
    const ret = runtimeListener?.(payload, sender, (value) => {
      reply = value;
      resolved = true;
    });
    if (ret === true) {
      await vi.waitFor(() => expect(resolved).toBe(true));
    }
    return { handled: ret === true, reply };
  }

  function twitchSender(tabId: number, path = "/shroud") {
    return {
      id: fakeBrowser.runtime.id,
      url: `https://www.twitch.tv${path}`,
      frameId: 0,
      tab: { id: tabId },
    };
  }

  function youtubeSender(tabId: number) {
    return {
      id: fakeBrowser.runtime.id,
      url: "https://www.youtube.com/watch?v=live123",
      frameId: 0,
      tab: { id: tabId },
    };
  }

  it("registers Twitch sources, manages demand, relays sanitized batches, and handles unsubscribe", async () => {
    await dispatch(
      {
        type: BRIDGE_REGISTER_TYPE,
        site: "twitch",
        channelLogin: "shroud",
        label: "#shroud",
      },
      twitchSender(10),
    );
    expect(tabsSendMessage).toHaveBeenCalledWith(10, {
      type: BRIDGE_DEMAND_TYPE,
      activeSubscribers: 0,
    });

    const listed = await dispatch(
      { type: BRIDGE_LIST_SOURCES_TYPE },
      youtubeSender(20),
    );
    expect(listed.reply).toEqual({
      sources: [
        {
          tabId: 10,
          site: "twitch",
          channelLogin: "shroud",
          label: "#shroud",
        },
      ],
    });

    const sub = await dispatch(
      { type: BRIDGE_SUBSCRIBE_TYPE, sourceTabId: 10 },
      youtubeSender(20),
    );
    expect(sub.reply).toEqual({
      source: {
        tabId: 10,
        site: "twitch",
        channelLogin: "shroud",
        label: "#shroud",
      },
    });
    expect(tabsSendMessage).toHaveBeenCalledWith(10, {
      type: BRIDGE_DEMAND_TYPE,
      activeSubscribers: 1,
    });

    tabsSendMessage.mockClear();
    await dispatch(
      {
        type: BRIDGE_PUSH_BATCH_TYPE,
        site: "twitch",
        channelLogin: "shroud",
        items: [
          {
            receivedAtMs: 5000,
            message: {
              ...message({ id: "tw-1", site: "twitch", text: "GG!" }),
              raw: { domNode: "strip" },
            },
          },
        ],
      },
      twitchSender(10),
    );
    expect(tabsSendMessage).toHaveBeenCalledTimes(1);
    const [destTabId, delivered] = tabsSendMessage.mock.calls[0]!;
    expect(destTabId).toBe(20);
    expect(delivered.type).toBe(BRIDGE_DELIVER_BATCH_TYPE);
    expect(delivered.items[0].message).not.toHaveProperty("raw");

    tabsSendMessage.mockClear();
    await dispatch({ type: BRIDGE_UNSUBSCRIBE_TYPE }, youtubeSender(20));
    expect(tabsSendMessage).toHaveBeenCalledWith(10, {
      type: BRIDGE_DEMAND_TYPE,
      activeSubscribers: 0,
    });
  });

  it("notifies subscriber on channel change and tab closure", async () => {
    await dispatch(
      { type: BRIDGE_REGISTER_TYPE, site: "twitch", channelLogin: "shroud" },
      twitchSender(10, "/shroud"),
    );
    await dispatch(
      { type: BRIDGE_SUBSCRIBE_TYPE, sourceTabId: 10 },
      youtubeSender(20),
    );

    tabsSendMessage.mockClear();
    await dispatch(
      { type: BRIDGE_REGISTER_TYPE, site: "twitch", channelLogin: "tarik" },
      twitchSender(10, "/tarik"),
    );
    expect(tabsSendMessage).toHaveBeenCalledWith(20, {
      type: BRIDGE_SOURCE_STATUS_TYPE,
      sourceTabId: 10,
      status: "channel-changed",
      channelLogin: "tarik",
    });

    await dispatch(
      { type: BRIDGE_SUBSCRIBE_TYPE, sourceTabId: 10 },
      youtubeSender(20),
    );
    tabsSendMessage.mockClear();
    for (const cb of tabsOnRemovedListeners) {
      await cb(10);
    }
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(20, {
        type: BRIDGE_SOURCE_STATUS_TYPE,
        sourceTabId: 10,
        status: "closed",
      }),
    );
  });

  it("restores routing state from storage.session across background restart", async () => {
    await dispatch(
      { type: BRIDGE_REGISTER_TYPE, site: "twitch", channelLogin: "shroud" },
      twitchSender(10),
    );
    await dispatch(
      { type: BRIDGE_SUBSCRIBE_TYPE, sourceTabId: 10 },
      youtubeSender(20),
    );

    // Simulate MV3 service worker restart with persisted session storage.
    stopBackground?.();
    tabsSendMessage.mockClear();
    const mod = await import("../../src/entrypoints/background");
    stopBackground = mod.registerBackgroundHandlers();

    await dispatch(
      {
        type: BRIDGE_PUSH_BATCH_TYPE,
        site: "twitch",
        channelLogin: "shroud",
        items: [
          {
            receivedAtMs: 9000,
            message: message({ id: "tw-2", site: "twitch", text: "After SW" }),
          },
        ],
      },
      twitchSender(10),
    );
    expect(tabsSendMessage).toHaveBeenCalledWith(
      20,
      expect.objectContaining({
        type: BRIDGE_DELIVER_BATCH_TYPE,
        channelLogin: "shroud",
      }),
    );
  });

  it("rejects untrusted senders, wrong hosts, and non-top frames", async () => {
    const evilExt = await dispatch(
      { type: BRIDGE_REGISTER_TYPE, site: "twitch", channelLogin: "shroud" },
      { ...twitchSender(10), id: "evil-ext" },
    );
    expect(evilExt.handled).toBe(false);

    const wrongHostReg = await dispatch(
      { type: BRIDGE_REGISTER_TYPE, site: "twitch", channelLogin: "shroud" },
      youtubeSender(20),
    );
    expect(wrongHostReg.handled).toBe(false);

    const wrongSiteOnTwitch = await dispatch(
      {
        type: BRIDGE_REGISTER_TYPE,
        site: "youtube-live",
        channelLogin: "ytLive1",
      },
      twitchSender(10),
    );
    expect(wrongSiteOnTwitch.handled).toBe(false);

    const unknownHostSub = await dispatch(
      { type: BRIDGE_SUBSCRIBE_TYPE, sourceTabId: 10 },
      {
        id: fakeBrowser.runtime.id,
        url: "https://example.test/watch",
        frameId: 0,
        tab: { id: 99 },
      },
    );
    expect(unknownHostSub.handled).toBe(false);

    // Same-site or self subscribe is refused with source: null.
    await dispatch(
      { type: BRIDGE_REGISTER_TYPE, site: "twitch", channelLogin: "shroud" },
      twitchSender(10),
    );
    const sameSiteSub = await dispatch(
      { type: BRIDGE_SUBSCRIBE_TYPE, sourceTabId: 10 },
      twitchSender(11, "/tarik"),
    );
    expect(sameSiteSub.handled).toBe(true);
    expect(sameSiteSub.reply).toEqual({ source: null });

    const subframeReg = await dispatch(
      { type: BRIDGE_REGISTER_TYPE, site: "twitch", channelLogin: "shroud" },
      { ...twitchSender(10), frameId: 2 },
    );
    expect(subframeReg.handled).toBe(false);
  });

  it("supports simultaneous bidirectional discovery, delivery, popout sync, and clean teardown when one tab closes", async () => {
    vi.spyOn(fakeBrowser.runtime, "getURL").mockImplementation(
      (path) => `chrome-extension://${fakeBrowser.runtime.id}${path}`,
    );

    await dispatch(
      {
        type: BRIDGE_REGISTER_TYPE,
        site: "twitch",
        channelLogin: "shroud",
        label: "#shroud",
      },
      twitchSender(10, "/shroud"),
    );
    await dispatch(
      {
        type: BRIDGE_REGISTER_TYPE,
        site: "youtube-live",
        channelLogin: "ytLive1",
        label: "YT Live Stream",
      },
      youtubeSender(20),
    );

    // Each site lists only opposite-site sources.
    const ytListed = await dispatch(
      { type: BRIDGE_LIST_SOURCES_TYPE },
      youtubeSender(20),
    );
    expect(ytListed.reply).toEqual({
      sources: [
        {
          tabId: 10,
          site: "twitch",
          channelLogin: "shroud",
          label: "#shroud",
        },
      ],
    });
    const twListed = await dispatch(
      { type: BRIDGE_LIST_SOURCES_TYPE },
      twitchSender(10, "/shroud"),
    );
    expect(twListed.reply).toEqual({
      sources: [
        {
          tabId: 20,
          site: "youtube-live",
          channelLogin: "ytLive1",
          label: "YT Live Stream",
        },
      ],
    });

    // Subscribe in both directions simultaneously.
    const ytSub = await dispatch(
      { type: BRIDGE_SUBSCRIBE_TYPE, sourceTabId: 10 },
      youtubeSender(20),
    );
    const twSub = await dispatch(
      { type: BRIDGE_SUBSCRIBE_TYPE, sourceTabId: 20 },
      twitchSender(10, "/shroud"),
    );
    expect(ytSub.reply).toEqual({
      source: {
        tabId: 10,
        site: "twitch",
        channelLogin: "shroud",
        label: "#shroud",
      },
    });
    expect(twSub.reply).toEqual({
      source: {
        tabId: 20,
        site: "youtube-live",
        channelLogin: "ytLive1",
        label: "YT Live Stream",
      },
    });

    // Batches deliver strictly to the opposite subscribed tab.
    tabsSendMessage.mockClear();
    await dispatch(
      {
        type: BRIDGE_PUSH_BATCH_TYPE,
        site: "twitch",
        channelLogin: "shroud",
        items: [
          {
            receivedAtMs: 5000,
            message: message({ id: "tw-1", site: "twitch", text: "from tw" }),
          },
        ],
      },
      twitchSender(10, "/shroud"),
    );
    await dispatch(
      {
        type: BRIDGE_PUSH_BATCH_TYPE,
        site: "youtube-live",
        channelLogin: "ytLive1",
        items: [
          {
            receivedAtMs: 6000,
            message: message({
              id: "yt-1",
              site: "youtube-live",
              text: "from yt",
            }),
          },
        ],
      },
      youtubeSender(20),
    );

    expect(tabsSendMessage).toHaveBeenCalledWith(
      20,
      expect.objectContaining({
        type: BRIDGE_DELIVER_BATCH_TYPE,
        sourceTabId: 10,
        site: "twitch",
      }),
    );
    expect(tabsSendMessage).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        type: BRIDGE_DELIVER_BATCH_TYPE,
        sourceTabId: 20,
        site: "youtube-live",
      }),
    );

    // Popout sync and subscriber relay work for mixed OS popout tabs.
    const snapshot = {
      localSite: "twitch" as const,
      peerSite: "youtube-live" as const,
      peerLabel: "YT Live Stream",
      delaySec: 0,
      suspendedReason: null,
      messages: [message({ id: "tw-1", site: "twitch", text: "from tw" })],
    };
    await dispatch(
      { type: BRIDGE_POPOUT_SYNC_TYPE, snapshot },
      twitchSender(10, "/shroud"),
    );
    const popoutSub = await dispatch(
      { type: BRIDGE_POPOUT_SUBSCRIBE_TYPE, site: "twitch" },
      {
        id: fakeBrowser.runtime.id,
        url: `chrome-extension://${fakeBrowser.runtime.id}/bridge-popout.html?site=twitch`,
        frameId: 0,
        tab: { id: 300 },
      },
    );
    expect(popoutSub.reply).toEqual({ snapshot });

    tabsSendMessage.mockClear();
    const updatedSnapshot = { ...snapshot, delaySec: 5 };
    await dispatch(
      { type: BRIDGE_POPOUT_SYNC_TYPE, snapshot: updatedSnapshot },
      twitchSender(10, "/shroud"),
    );
    expect(tabsSendMessage).toHaveBeenCalledWith(300, {
      type: BRIDGE_POPOUT_UPDATE_TYPE,
      snapshot: updatedSnapshot,
    });

    // Closing Twitch tab notifies YouTube "closed" AND drops demand on YouTube tab to 0.
    tabsSendMessage.mockClear();
    for (const cb of tabsOnRemovedListeners) {
      await cb(10);
    }
    await vi.waitFor(() =>
      expect(tabsSendMessage).toHaveBeenCalledWith(20, {
        type: BRIDGE_SOURCE_STATUS_TYPE,
        sourceTabId: 10,
        status: "closed",
      }),
    );
    expect(tabsSendMessage).toHaveBeenCalledWith(20, {
      type: BRIDGE_DEMAND_TYPE,
      activeSubscribers: 0,
    });
  });

  it("persists popout viewer subscriptions across background restart without storing message bodies", async () => {
    vi.spyOn(fakeBrowser.runtime, "getURL").mockImplementation(
      (path) => `chrome-extension://${fakeBrowser.runtime.id}${path}`,
    );
    const popoutSender = (tabId: number, site: "twitch" | "youtube") => ({
      id: fakeBrowser.runtime.id,
      url: `chrome-extension://${fakeBrowser.runtime.id}/bridge-popout.html?site=${site}`,
      frameId: 0,
      tab: { id: tabId },
    });

    const initialSnapshot = {
      localSite: "twitch" as const,
      peerSite: "youtube-live" as const,
      peerLabel: "YT Live Stream",
      delaySec: 0,
      suspendedReason: null,
      messages: [
        message({
          id: "tw-before",
          site: "twitch",
          text: "chat body before restart",
        }),
      ],
    };
    await dispatch(
      { type: BRIDGE_POPOUT_SYNC_TYPE, snapshot: initialSnapshot },
      twitchSender(10, "/shroud"),
    );

    const subReply = await dispatch(
      { type: BRIDGE_POPOUT_SUBSCRIBE_TYPE, site: "twitch" },
      popoutSender(300, "twitch"),
    );
    expect(subReply.reply).toEqual({ snapshot: initialSnapshot });

    const preRestartSnapshot = {
      ...initialSnapshot,
      messages: [
        ...initialSnapshot.messages,
        message({ id: "tw-live-1", site: "twitch", text: "before sw restart" }),
      ],
    };
    tabsSendMessage.mockClear();
    await dispatch(
      { type: BRIDGE_POPOUT_SYNC_TYPE, snapshot: preRestartSnapshot },
      twitchSender(10, "/shroud"),
    );
    expect(tabsSendMessage).toHaveBeenCalledWith(300, {
      type: BRIDGE_POPOUT_UPDATE_TYPE,
      snapshot: preRestartSnapshot,
    });

    // Only viewer tab metadata is stored in storage.session — no chat text or snapshots.
    const storedBeforeRestart = (
      await fakeBrowser.storage.session.get("fceBridgeHubState")
    ).fceBridgeHubState as {
      popoutViewers?: Array<[number, string]>;
    };
    expect(storedBeforeRestart?.popoutViewers).toEqual([[300, "twitch"]]);
    const serialized = JSON.stringify(storedBeforeRestart);
    expect(serialized).not.toContain("chat body before restart");
    expect(serialized).not.toContain("before sw restart");
    expect(serialized).not.toContain("messages");

    // Restart background with the popout tab still open and WITHOUT re-subscribing.
    stopBackground?.();
    tabsSendMessage.mockClear();
    const restartedMod = await import("../../src/entrypoints/background");
    stopBackground = restartedMod.registerBackgroundHandlers();

    const afterRestartSnapshot = {
      localSite: "twitch" as const,
      peerSite: "youtube-live" as const,
      peerLabel: "YT Live Stream",
      delaySec: 4,
      suspendedReason: null,
      messages: [
        message({
          id: "tw-after",
          site: "twitch",
          text: "arrived after sw restart",
        }),
      ],
    };
    await dispatch(
      { type: BRIDGE_POPOUT_SYNC_TYPE, snapshot: afterRestartSnapshot },
      twitchSender(10, "/shroud"),
    );
    expect(tabsSendMessage).toHaveBeenCalledWith(300, {
      type: BRIDGE_POPOUT_UPDATE_TYPE,
      snapshot: afterRestartSnapshot,
    });

    // Closing the popout tab removes it persistently across subsequent restarts.
    for (const cb of tabsOnRemovedListeners) {
      await cb(300);
    }
    await vi.waitFor(async () => {
      const storedAfterClose = (
        await fakeBrowser.storage.session.get("fceBridgeHubState")
      ).fceBridgeHubState as {
        popoutViewers?: Array<[number, string]>;
      };
      expect(storedAfterClose?.popoutViewers).toEqual([]);
    });
    stopBackground?.();
    tabsSendMessage.mockClear();
    const restartedAgain = await import("../../src/entrypoints/background");
    stopBackground = restartedAgain.registerBackgroundHandlers();

    await dispatch(
      {
        type: BRIDGE_POPOUT_SYNC_TYPE,
        snapshot: { ...afterRestartSnapshot, delaySec: 5 },
      },
      twitchSender(10, "/shroud"),
    );
    expect(tabsSendMessage).not.toHaveBeenCalled();

    // Unreachable viewer tabs are pruned cleanly on failed sendMessage.
    await dispatch(
      { type: BRIDGE_POPOUT_SUBSCRIBE_TYPE, site: "twitch" },
      popoutSender(301, "twitch"),
    );
    tabsSendMessage.mockRejectedValueOnce(new Error("Receiving end gone"));
    await dispatch(
      {
        type: BRIDGE_POPOUT_SYNC_TYPE,
        snapshot: { ...afterRestartSnapshot, delaySec: 6 },
      },
      twitchSender(10, "/shroud"),
    );
    const storedAfterPrune = (
      await fakeBrowser.storage.session.get("fceBridgeHubState")
    ).fceBridgeHubState as {
      popoutViewers?: Array<[number, string]>;
    };
    expect(storedAfterPrune?.popoutViewers).toEqual([]);
  });

  it("retries failed or unanswered registration without locking out the same source key and cancels on stop", async () => {
    vi.useFakeTimers();
    try {
      const registerCalls: Array<Record<string, unknown>> = [];
      const unregisterCalls: Array<Record<string, unknown>> = [];
      let mode: "no-response" | "reject" | "accept" = "no-response";

      vi.spyOn(fakeBrowser.runtime, "sendMessage").mockImplementation(
        async (payload: unknown) => {
          const rec = payload as Record<string, unknown>;
          if (rec?.type === BRIDGE_REGISTER_TYPE) {
            registerCalls.push(rec);
            if (mode === "no-response") {
              return undefined;
            }
            if (mode === "reject") {
              throw new Error("Receiving end does not exist.");
            }
            return { ok: true };
          }
          if (rec?.type === BRIDGE_UNREGISTER_TYPE) {
            unregisterCalls.push(rec);
            return { ok: true };
          }
          return undefined;
        },
      );

      const publisher = createBridgePublisher({
        site: "youtube-live",
        attachListener: false,
        getChannelLogin: () => "ytLiveKey1",
        getLabel: () => "YT Live Stream",
      });

      // Attempt #1 gets undefined (no-response); enqueue while backoff pending does not flood.
      publisher.start();
      await Promise.resolve();
      await Promise.resolve();
      expect(registerCalls).toHaveLength(1);
      publisher.enqueue(
        message({ id: "yt-early", site: "youtube-live", text: "early" }),
      );
      expect(registerCalls).toHaveLength(1);

      // 500ms backoff -> attempt #2 rejects; 1500ms backoff -> attempt #3 succeeds.
      mode = "reject";
      await vi.advanceTimersByTimeAsync(500);
      expect(registerCalls).toHaveLength(2);

      mode = "accept";
      await vi.advanceTimersByTimeAsync(1500);
      expect(registerCalls).toHaveLength(3);
      expect(registerCalls[2]).toEqual({
        type: BRIDGE_REGISTER_TYPE,
        site: "youtube-live",
        channelLogin: "ytLiveKey1",
        label: "YT Live Stream",
      });

      // After acceptance, syncChannel and enqueue must not re-send duplicate register.
      publisher.syncChannel();
      publisher.enqueue(
        message({ id: "yt-after", site: "youtube-live", text: "after" }),
      );
      await vi.advanceTimersByTimeAsync(5000);
      expect(registerCalls).toHaveLength(3);

      // Exhaust all automatic retries, then verify subsequent enqueue recovers once hub responds.
      publisher.stop();
      expect(unregisterCalls).toHaveLength(1);
      registerCalls.length = 0;
      mode = "no-response";

      publisher.start();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(500 + 1500 + 3000 + 100);
      expect(registerCalls).toHaveLength(4);

      mode = "accept";
      publisher.enqueue(
        message({ id: "yt-recover", site: "youtube-live", text: "recover" }),
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(registerCalls).toHaveLength(5);

      // Stop during retry backoff cancels pending timers without sending unregister when never registered.
      publisher.stop();
      registerCalls.length = 0;
      unregisterCalls.length = 0;
      mode = "no-response";
      publisher.start();
      await Promise.resolve();
      await Promise.resolve();
      expect(registerCalls).toHaveLength(1);
      publisher.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(registerCalls).toHaveLength(1);
      expect(unregisterCalls).toHaveLength(0);

      // Stop while an initial register is still in flight sends unregister and ignores the late reply.
      let resolveInFlight!: (value: { ok: boolean }) => void;
      vi.spyOn(fakeBrowser.runtime, "sendMessage").mockImplementation(
        async (payload: unknown) => {
          const rec = payload as Record<string, unknown>;
          if (rec?.type === BRIDGE_REGISTER_TYPE) {
            registerCalls.push(rec);
            return await new Promise<{ ok: boolean }>((resolve) => {
              resolveInFlight = resolve;
            });
          }
          if (rec?.type === BRIDGE_UNREGISTER_TYPE) {
            unregisterCalls.push(rec);
            return { ok: true };
          }
          return undefined;
        },
      );
      registerCalls.length = 0;
      unregisterCalls.length = 0;
      publisher.start();
      expect(registerCalls).toHaveLength(1);
      publisher.stop();
      expect(unregisterCalls).toHaveLength(1);
      resolveInFlight({ ok: true });
      await Promise.resolve();
      await Promise.resolve();
      expect(unregisterCalls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the latest source subscribed when switching during an in-flight subscribe regardless of reply order", async () => {
    const unsubscribeCalls: unknown[] = [];
    const deferredByTab = new Map<
      number,
      { promise: Promise<unknown>; resolve: (val: unknown) => void }
    >();
    const makeDeferred = (tabId: number) => {
      let resolve!: (val: unknown) => void;
      const promise = new Promise<unknown>((res) => {
        resolve = res;
      });
      deferredByTab.set(tabId, { promise, resolve });
      return promise;
    };

    vi.spyOn(fakeBrowser.runtime, "sendMessage").mockImplementation(
      async (payload: unknown) => {
        const rec = payload as { type?: string; sourceTabId?: number };
        if (rec?.type === BRIDGE_UNSUBSCRIBE_TYPE) {
          unsubscribeCalls.push(rec);
        }
        const { reply } = await dispatch(payload, youtubeSender(30));
        if (
          rec?.type === BRIDGE_SUBSCRIBE_TYPE &&
          typeof rec.sourceTabId === "number"
        ) {
          const d = deferredByTab.get(rec.sourceTabId);
          if (d) {
            await d.promise;
          }
        }
        return reply;
      },
    );

    await dispatch(
      {
        type: BRIDGE_REGISTER_TYPE,
        site: "twitch",
        channelLogin: "alpha",
        label: "#alpha",
      },
      twitchSender(10, "/alpha"),
    );
    await dispatch(
      {
        type: BRIDGE_REGISTER_TYPE,
        site: "twitch",
        channelLogin: "beta",
        label: "#beta",
      },
      twitchSender(20, "/beta"),
    );

    const batches: Array<{
      sourceTabId: number;
      site: string;
      items: Array<{ message: { id: string; text: string } }>;
    }> = [];
    const subscriber = createBridgeSubscriber({
      localSite: "youtube-live",
      attachListener: false,
      onBatch: (payload) => batches.push(payload),
      onSourceStatus: () => {},
    });
    subscriber.start();

    // Case 1: reply order A then B while switching A -> B in flight
    const pA1 = makeDeferred(10);
    const pB1 = makeDeferred(20);
    void pA1;
    void pB1;
    const subA1 = subscriber.subscribe(10);
    const subB1 = subscriber.subscribe(20);
    deferredByTab.get(10)!.resolve(undefined);
    expect(await subA1).toBeNull();
    deferredByTab.get(20)!.resolve(undefined);
    const resolvedB1 = await subB1;
    expect(resolvedB1?.tabId).toBe(20);
    expect(subscriber.getActiveSource()?.tabId).toBe(20);
    expect(unsubscribeCalls).toHaveLength(0);

    tabsSendMessage.mockClear();
    await dispatch(
      {
        type: BRIDGE_PUSH_BATCH_TYPE,
        site: "twitch",
        channelLogin: "beta",
        items: [
          {
            receivedAtMs: 1000,
            message: message({ id: "b-1", site: "twitch", text: "from beta" }),
          },
        ],
      },
      twitchSender(20, "/beta"),
    );
    expect(tabsSendMessage).toHaveBeenCalledWith(
      30,
      expect.objectContaining({
        type: BRIDGE_DELIVER_BATCH_TYPE,
        sourceTabId: 20,
      }),
    );
    const deliverCall1 = tabsSendMessage.mock.calls.find(
      ([tabId, msg]) =>
        tabId === 30 &&
        (msg as { type?: string }).type === BRIDGE_DELIVER_BATCH_TYPE,
    );
    expect(
      subscriber.handleMessage(deliverCall1?.[1], {
        id: fakeBrowser.runtime.id,
      }),
    ).toBe(true);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.sourceTabId).toBe(20);

    // Case 2: reply order B then A while switching A -> B in flight
    deferredByTab.clear();
    makeDeferred(10);
    makeDeferred(20);
    const subA2 = subscriber.subscribe(10);
    const subB2 = subscriber.subscribe(20);
    deferredByTab.get(20)!.resolve(undefined);
    const resolvedB2 = await subB2;
    expect(resolvedB2?.tabId).toBe(20);
    deferredByTab.get(10)!.resolve(undefined);
    expect(await subA2).toBeNull();
    expect(subscriber.getActiveSource()?.tabId).toBe(20);
    expect(unsubscribeCalls).toHaveLength(0);

    // Case 3: unsubscribe() while subscribe(10) is in-flight sends BRIDGE_UNSUBSCRIBE_TYPE
    deferredByTab.clear();
    makeDeferred(10);
    const subInFlight = subscriber.subscribe(10);
    await subscriber.unsubscribe();
    expect(unsubscribeCalls).toHaveLength(1);
    deferredByTab.get(10)!.resolve(undefined);
    expect(await subInFlight).toBeNull();
    expect(subscriber.getActiveSource()).toBeNull();

    tabsSendMessage.mockClear();
    await dispatch(
      {
        type: BRIDGE_PUSH_BATCH_TYPE,
        site: "twitch",
        channelLogin: "alpha",
        items: [
          {
            receivedAtMs: 2000,
            message: message({ id: "a-2", site: "twitch", text: "from alpha" }),
          },
        ],
      },
      twitchSender(10, "/alpha"),
    );
    expect(
      tabsSendMessage.mock.calls.some(
        ([tabId, msg]) =>
          tabId === 30 &&
          (msg as { type?: string }).type === BRIDGE_DELIVER_BATCH_TYPE,
      ),
    ).toBe(false);

    subscriber.stop();
  });
});
