import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  BRIDGE_DELIVER_BATCH_TYPE,
  BRIDGE_LIST_SOURCES_TYPE,
  BRIDGE_POPOUT_SUBSCRIBE_TYPE,
  BRIDGE_POPOUT_SYNC_TYPE,
  BRIDGE_POPOUT_UPDATE_TYPE,
  BRIDGE_PUSH_BATCH_TYPE,
  BRIDGE_REGISTER_TYPE,
  BRIDGE_SUBSCRIBE_TYPE,
  isBridgeContentEvent,
  isBridgePopoutSubscribeRequest,
  isBridgePopoutSyncRequest,
  isBridgePopoutUpdateEvent,
  isBridgeRuntimeRequest,
  isTrustedBridgePopoutSender,
  isTrustedBridgeSender,
  MAX_BRIDGE_BATCH_SIZE,
  resolveTrustedBridgeSenderSite,
  sanitizeBridgeMessage,
  sanitizeBridgePopoutSnapshot,
} from "../../src/shared/bridge-messages";
import { message } from "../helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cross-tab bridge message boundaries", () => {
  it("accepts valid Twitch batches and strips raw/unknown fields on sanitize", () => {
    const twitchMessage = {
      ...message({
        id: "tw-1",
        site: "twitch",
        authorName: "Fan",
        authorColor: "#9147ff",
        text: "GG :Pog:",
        segments: [
          { type: "text", text: "GG " },
          {
            type: "emoji",
            alt: "Pog",
            src: "https://static-cdn.jtvnw.net/emoticons/v2/1/default/dark/1.0",
          },
        ],
        badgeIcons: [
          {
            alt: "Subscriber",
            src: "https://static-cdn.jtvnw.net/badges/v1/sub/1",
          },
        ],
      }),
      raw: { secretInternalDomRef: true },
      extraUntrustedField: "drop-me",
    };

    expect(
      isBridgeRuntimeRequest({
        type: BRIDGE_PUSH_BATCH_TYPE,
        site: "twitch",
        channelLogin: "shroud",
        items: [{ receivedAtMs: 12345, message: twitchMessage }],
      }),
    ).toBe(true);

    const sanitized = sanitizeBridgeMessage(twitchMessage);
    expect(sanitized).not.toHaveProperty("raw");
    expect(sanitized).not.toHaveProperty("extraUntrustedField");
    expect(sanitized.segments).toHaveLength(2);
    expect(sanitized.badgeIcons).toHaveLength(1);
  });

  it("accepts youtube-live sources/batches and rejects cross-site payload mismatches", () => {
    const ytMessage = message({
      id: "yt-1",
      site: "youtube-live",
      authorName: "YT Viewer",
      text: "Hello from YT",
    });
    const twMessage = message({
      id: "tw-1",
      site: "twitch",
      authorName: "TW Viewer",
      text: "Hello from TW",
    });

    expect(
      isBridgeRuntimeRequest({
        type: BRIDGE_REGISTER_TYPE,
        site: "youtube-live",
        channelLogin: "dQw4w9WgXcQ-1",
        label: "YouTube Stream Title",
      }),
    ).toBe(true);
    expect(
      isBridgeRuntimeRequest({
        type: BRIDGE_PUSH_BATCH_TYPE,
        site: "youtube-live",
        channelLogin: "dQw4w9WgXcQ-1",
        items: [{ receivedAtMs: 12345, message: ytMessage }],
      }),
    ).toBe(true);
    expect(
      isBridgeContentEvent({
        type: BRIDGE_DELIVER_BATCH_TYPE,
        sourceTabId: 20,
        site: "youtube-live",
        channelLogin: "dQw4w9WgXcQ-1",
        items: [{ receivedAtMs: 12345, message: ytMessage }],
      }),
    ).toBe(true);

    // Mismatched site inside batch must fail.
    expect(
      isBridgeRuntimeRequest({
        type: BRIDGE_PUSH_BATCH_TYPE,
        site: "youtube-live",
        channelLogin: "dQw4w9WgXcQ-1",
        items: [{ receivedAtMs: 12345, message: twMessage }],
      }),
    ).toBe(false);
    expect(
      isBridgeRuntimeRequest({
        type: BRIDGE_PUSH_BATCH_TYPE,
        site: "twitch",
        channelLogin: "shroud",
        items: [{ receivedAtMs: 12345, message: ytMessage }],
      }),
    ).toBe(false);
    expect(
      isBridgeRuntimeRequest({
        type: BRIDGE_REGISTER_TYPE,
        site: "youtube-live",
        channelLogin: "bad/video?id",
      }),
    ).toBe(false);
  });

  it("validates bridge popout sync/subscribe contracts and trusted senders", () => {
    fakeBrowser.reset();
    const extId = fakeBrowser.runtime.id;
    vi.spyOn(fakeBrowser.runtime, "getURL").mockImplementation(
      (path) => `chrome-extension://${extId}${path}`,
    );

    expect(
      resolveTrustedBridgeSenderSite({
        id: extId,
        url: "https://www.twitch.tv/shroud",
        frameId: 0,
        tab: { id: 10 },
      }),
    ).toBe("twitch");
    expect(
      resolveTrustedBridgeSenderSite({
        id: extId,
        url: "https://www.youtube.com/watch?v=abc",
        frameId: 0,
        tab: { id: 20 },
      }),
    ).toBe("youtube-live");
    expect(
      resolveTrustedBridgeSenderSite({
        id: extId,
        url: "https://example.test/watch",
        frameId: 0,
        tab: { id: 30 },
      }),
    ).toBeNull();

    const snapshot = {
      localSite: "twitch" as const,
      peerSite: "youtube-live" as const,
      peerLabel: "YT Stream",
      delaySec: 4,
      suspendedReason: null,
      messages: [
        message({ id: "tw-1", site: "twitch", text: "local" }),
        message({ id: "yt-1", site: "youtube-live", text: "remote" }),
      ],
    };
    expect(
      isBridgePopoutSyncRequest({
        type: BRIDGE_POPOUT_SYNC_TYPE,
        snapshot,
      }),
    ).toBe(true);
    expect(
      isBridgePopoutSubscribeRequest({
        type: BRIDGE_POPOUT_SUBSCRIBE_TYPE,
        site: "twitch",
      }),
    ).toBe(true);
    expect(
      isBridgePopoutUpdateEvent({
        type: BRIDGE_POPOUT_UPDATE_TYPE,
        snapshot,
      }),
    ).toBe(true);

    const sanitized = sanitizeBridgePopoutSnapshot({
      ...snapshot,
      delaySec: 999,
      messages: [
        {
          ...message({ id: "tw-1", site: "twitch", text: "local" }),
          raw: { leak: true },
        },
      ],
    });
    expect(sanitized.delaySec).toBe(120);
    expect(sanitized.messages[0]).not.toHaveProperty("raw");

    expect(
      isTrustedBridgePopoutSender({
        id: extId,
        url: `chrome-extension://${extId}/bridge-popout.html?site=twitch`,
        frameId: 0,
        tab: { id: 99 },
      }),
    ).toBe(true);
    expect(
      isTrustedBridgePopoutSender({
        id: extId,
        url: `chrome-extension://${extId}/options.html`,
        frameId: 0,
        tab: { id: 99 },
      }),
    ).toBe(false);
    expect(
      isTrustedBridgePopoutSender({
        id: "evil-ext",
        url: `chrome-extension://${extId}/bridge-popout.html?site=twitch`,
        frameId: 0,
        tab: { id: 99 },
      }),
    ).toBe(false);
  });

  it("rejects non-bridge messages, oversized batches, unsafe URLs, and invalid channel logins", () => {
    const valid = message({ id: "tw-1", site: "twitch" });

    expect(
      isBridgeRuntimeRequest({
        type: BRIDGE_REGISTER_TYPE,
        site: "twitch",
        channelLogin: "bad channel!",
      }),
    ).toBe(false);

    expect(
      isBridgeRuntimeRequest({
        type: BRIDGE_PUSH_BATCH_TYPE,
        site: "twitch",
        channelLogin: "shroud",
        items: [],
      }),
    ).toBe(false);

    expect(
      isBridgeRuntimeRequest({
        type: BRIDGE_PUSH_BATCH_TYPE,
        site: "twitch",
        channelLogin: "shroud",
        items: Array.from({ length: MAX_BRIDGE_BATCH_SIZE + 1 }, (_, i) => ({
          receivedAtMs: i,
          message: { ...valid, id: `id-${i}` },
        })),
      }),
    ).toBe(false);

    for (const badMessage of [
      { ...valid, site: "invalid-site" },
      { ...valid, id: "" },
      { ...valid, text: "a".repeat(20001) },
      { ...valid, authorColor: "expression(alert(1))" },
      {
        ...valid,
        segments: [{ type: "emoji", alt: "x", src: "javascript:alert(1)" }],
      },
      {
        ...valid,
        badgeIcons: [{ alt: "b", src: "http://insecure.example/badge.png" }],
      },
    ]) {
      expect(
        isBridgeRuntimeRequest({
          type: BRIDGE_PUSH_BATCH_TYPE,
          site: "twitch",
          channelLogin: "shroud",
          items: [{ receivedAtMs: 1000, message: badMessage }],
        }),
      ).toBe(false);

      expect(
        isBridgeContentEvent({
          type: BRIDGE_DELIVER_BATCH_TYPE,
          sourceTabId: 1,
          site: "twitch",
          channelLogin: "shroud",
          items: [{ receivedAtMs: 1000, message: badMessage }],
        }),
      ).toBe(false);
    }

    expect(
      isBridgeRuntimeRequest({
        type: BRIDGE_SUBSCRIBE_TYPE,
        sourceTabId: -1,
      }),
    ).toBe(false);
    expect(
      isBridgeRuntimeRequest({
        type: BRIDGE_LIST_SOURCES_TYPE,
      }),
    ).toBe(true);
  });

  it("verifies extension id, top frameId, integer tab id, and expected https host", () => {
    fakeBrowser.reset();
    const extId = fakeBrowser.runtime.id;

    expect(
      isTrustedBridgeSender(
        {
          id: extId,
          url: "https://www.twitch.tv/shroud",
          frameId: 0,
          tab: { id: 10 },
        },
        "twitch",
      ),
    ).toBe(true);

    expect(
      isTrustedBridgeSender(
        {
          id: extId,
          url: "https://www.youtube.com/watch?v=abc",
          frameId: 0,
          tab: { id: 20 },
        },
        "youtube",
      ),
    ).toBe(true);

    // Wrong extension id
    expect(
      isTrustedBridgeSender(
        {
          id: "evil-ext",
          url: "https://www.twitch.tv/shroud",
          frameId: 0,
          tab: { id: 10 },
        },
        "twitch",
      ),
    ).toBe(false);

    // Wrong host (YouTube pretending to register Twitch source)
    expect(
      isTrustedBridgeSender(
        {
          id: extId,
          url: "https://www.youtube.com/watch?v=abc",
          frameId: 0,
          tab: { id: 10 },
        },
        "twitch",
      ),
    ).toBe(false);

    // Non-top frame
    expect(
      isTrustedBridgeSender(
        {
          id: extId,
          url: "https://www.twitch.tv/embed/shroud/chat",
          frameId: 3,
          tab: { id: 10 },
        },
        "twitch",
      ),
    ).toBe(false);

    // Missing tab / insecure scheme
    expect(
      isTrustedBridgeSender(
        {
          id: extId,
          url: "http://www.twitch.tv/shroud",
          frameId: 0,
          tab: { id: 10 },
        },
        "twitch",
      ),
    ).toBe(false);
    expect(
      isTrustedBridgeSender(
        {
          id: extId,
          url: "https://www.twitch.tv/shroud",
          frameId: 0,
        },
        "twitch",
      ),
    ).toBe(false);
  });
});
