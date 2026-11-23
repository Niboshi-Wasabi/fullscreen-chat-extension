import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  POPOUT_CLOSE_TYPE,
  POPOUT_OPEN_TYPE,
} from "../../src/shared/runtime-messages";
import { createPopoutController } from "../../src/views/popout";

const target = {
  url: "https://www.twitch.tv/popout/fixture/chat",
  siteKey: "twitch" as const,
};
let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeBrowser.reset();
  sendMessage = vi.fn(async () => ({ accepted: true }));
  vi.spyOn(fakeBrowser.runtime, "sendMessage").mockImplementation(
    sendMessage as unknown as typeof fakeBrowser.runtime.sendMessage,
  );
});

function openRequests(): Array<{ focus?: boolean }> {
  return sendMessage.mock.calls
    .map(([message]) => message as { type: string; focus?: boolean })
    .filter((message) => message.type === POPOUT_OPEN_TYPE);
}

describe("popout controller focus", () => {
  it("asks for focus on open but not on claim", async () => {
    const popout = createPopoutController({ resolveTarget: () => target });
    await popout.open();
    await popout.claim();
    expect(openRequests().map((request) => request.focus)).toEqual([
      true,
      false,
    ]);
  });

  it("joins a pending request unless that would drop a wanted focus", async () => {
    const popout = createPopoutController({ resolveTarget: () => target });
    await Promise.all([popout.open(), popout.open(), popout.claim()]);
    expect(openRequests()).toHaveLength(1);

    sendMessage.mockClear();
    await Promise.all([popout.claim(), popout.open()]);
    expect(openRequests().map((request) => request.focus)).toEqual([
      false,
      true,
    ]);
  });

  it("counts a pending open as open, and a close during it stays closed", async () => {
    let reply!: (value: unknown) => void;
    sendMessage.mockImplementation(async (message: { type: string }) =>
      message.type === POPOUT_OPEN_TYPE
        ? new Promise((resolve) => (reply = resolve))
        : undefined,
    );
    const popout = createPopoutController({ resolveTarget: () => target });
    const pending = popout.open();
    expect(popout.isOpen()).toBe(true);
    popout.close();
    expect(popout.isOpen()).toBe(false);
    expect(sendMessage).toHaveBeenCalledWith({ type: POPOUT_CLOSE_TYPE });
    reply({ accepted: true });
    expect(await pending).toBe(false);
    expect(popout.isOpen()).toBe(false);

    // A later open does not join the request that close() abandoned.
    sendMessage.mockResolvedValue({ accepted: true });
    expect(await popout.open()).toBe(true);
    expect(openRequests()).toHaveLength(2);
  });

  it("does not let an older reply hide a newer request for another URL", async () => {
    const other = { ...target, url: "https://www.twitch.tv/popout/other/chat" };
    let current = target;
    const replies: Array<(reply: unknown) => void> = [];
    sendMessage.mockImplementation(
      () => new Promise((resolve) => replies.push(resolve)),
    );
    const popout = createPopoutController({ resolveTarget: () => current });
    const first = popout.claim();
    current = other;
    const second = popout.claim();
    replies[0]?.({ accepted: true });
    await first;
    current = target;
    const third = popout.claim();
    expect(openRequests()).toHaveLength(3);
    for (const reply of replies.slice(1)) reply({ accepted: true });
    await Promise.all([second, third]);
  });

  it("handles synchronous Extension context invalidated throws cleanly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const popout = createPopoutController({ resolveTarget: () => target });
    try {
      sendMessage.mockImplementation(() => {
        throw new Error("Extension context invalidated.");
      });
      await expect(popout.open()).resolves.toBe(false);
      expect(warn).not.toHaveBeenCalled();
      expect(() => popout.close()).not.toThrow();
      expect(() => popout.focus()).not.toThrow();
    } finally {
      warn.mockRestore();
    }
  });
});
