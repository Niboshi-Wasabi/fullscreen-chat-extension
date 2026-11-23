import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  BRIDGE_POPOUT_SUBSCRIBE_TYPE,
  BRIDGE_POPOUT_UPDATE_TYPE,
  type BridgePopoutSnapshot,
} from "../../src/shared/bridge-messages";
import type { ExtensionSettings } from "../../src/shared/settings";
import { message, settings } from "../helpers";

const harness = vi.hoisted(() => ({
  load: vi.fn(),
  watchListeners: new Set<(next: ExtensionSettings) => void>(),
}));

vi.mock("../../src/shared/settings", async (original) => ({
  ...(await original<typeof import("../../src/shared/settings")>()),
  loadSettings: harness.load,
  watchSettings: (listener: (next: ExtensionSettings) => void) => {
    harness.watchListeners.add(listener);
    return () => harness.watchListeners.delete(listener);
  },
}));

class FakePopoutElement extends EventTarget {
  tagName: string;
  className = "";
  hidden = false;
  title = "";
  src = "";
  alt = "";
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  childNodes: FakePopoutElement[] = [];
  children: FakePopoutElement[] = [];
  private ownText = "";

  constructor(tagName = "div") {
    super();
    this.tagName = tagName;
  }

  get textContent(): string {
    if (this.childNodes.length === 0) {
      return this.ownText;
    }
    return (
      this.ownText + this.childNodes.map((child) => child.textContent).join("")
    );
  }

  set textContent(value: string) {
    this.ownText = value;
    this.childNodes.length = 0;
    this.children.length = 0;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(node: FakePopoutElement): FakePopoutElement {
    if (node instanceof FakeFragment) {
      this.childNodes.push(...node.childNodes);
      this.children.push(...node.children);
      node.childNodes.length = 0;
      node.children.length = 0;
      return node;
    }
    this.childNodes.push(node);
    if (!node.isTextNode) {
      this.children.push(node);
    }
    return node;
  }

  replaceChildren(...nodes: FakePopoutElement[]): void {
    this.ownText = "";
    this.childNodes.length = 0;
    this.children.length = 0;
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  isTextNode = false;
}

class FakeFragment extends FakePopoutElement {}

function setupPopoutDom() {
  const bySelector = new Map<string, FakePopoutElement>();
  for (const selector of [
    "#popoutTitle",
    "#popoutPeer",
    "#popoutReadOnly",
    "#popoutDelay",
    "#popoutBanner",
    "#popoutList",
  ]) {
    bySelector.set(selector, new FakePopoutElement());
  }

  const fakeWindow = new EventTarget();
  const fakeDocument = Object.assign(new EventTarget(), {
    title: "",
    visibilityState: "visible" as DocumentVisibilityState,
    querySelector: (selector: string) => bySelector.get(selector) ?? null,
    createElement: (tag = "div") => new FakePopoutElement(tag),
    createElementNS: (_ns: string, tag: string) => new FakePopoutElement(tag),
    createDocumentFragment: () => new FakeFragment(),
    createTextNode: (text: string) => {
      const node = new FakePopoutElement("#text");
      node.isTextNode = true;
      node.textContent = text;
      return node;
    },
  });

  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("location", { search: "?site=twitch" });

  return {
    fakeWindow,
    fakeDocument,
    bySelector,
  };
}

beforeEach(() => {
  vi.resetModules();
  fakeBrowser.reset();
  harness.watchListeners.clear();
  const initial = settings();
  initial.uiLocale = "en";
  harness.load.mockResolvedValue(initial);
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mixed bridge popout page", () => {
  it("subscribes on open, preserves current chat across null resubscribe replies, and applies subsequent updates", async () => {
    const { fakeWindow, fakeDocument, bySelector } = setupPopoutDom();
    const titleEl = bySelector.get("#popoutTitle")!;
    const peerEl = bySelector.get("#popoutPeer")!;
    const listEl = bySelector.get("#popoutList")!;
    const delayEl = bySelector.get("#popoutDelay")!;

    const runtimeListeners: Array<(msg: unknown, sender: unknown) => unknown> =
      [];
    vi.spyOn(fakeBrowser.runtime.onMessage, "addListener").mockImplementation(
      (cb) => {
        runtimeListeners.push(
          cb as unknown as (msg: unknown, sender: unknown) => unknown,
        );
      },
    );

    const firstSnapshot: BridgePopoutSnapshot = {
      localSite: "twitch",
      peerSite: "youtube-live",
      peerLabel: "YT Stream",
      delaySec: 0,
      suspendedReason: null,
      messages: [
        message({
          id: "tw-1",
          site: "twitch",
          authorName: "TWUser",
          text: "before restart line",
        }),
      ],
    };

    const sendSpy = vi
      .spyOn(fakeBrowser.runtime, "sendMessage")
      .mockResolvedValueOnce({ snapshot: firstSnapshot } as never);

    await import("../../src/entrypoints/bridge-popout/main");
    await vi.waitFor(() => expect(listEl.children).toHaveLength(1));
    expect(sendSpy).toHaveBeenCalledWith({
      type: BRIDGE_POPOUT_SUBSCRIBE_TYPE,
      site: "twitch",
    });
    expect(listEl.children[0]?.textContent).toContain("before restart line");
    expect(titleEl.title).toBe("Fullscreen Chat");
    expect(peerEl.hidden).toBe(false);
    expect(peerEl.title).toBe("YT Stream");

    // Simulate background restarted with empty in-memory snapshots -> reply returns null.
    sendSpy.mockResolvedValue({ snapshot: null } as never);

    fakeWindow.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(2));
    expect(listEl.children).toHaveLength(1);
    expect(listEl.children[0]?.textContent).toContain("before restart line");

    fakeDocument.visibilityState = "hidden";
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    expect(sendSpy).toHaveBeenCalledTimes(2);

    fakeDocument.visibilityState = "visible";
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(3));
    expect(listEl.children).toHaveLength(1);

    const bfcacheEvent = Object.assign(new Event("pageshow"), {
      persisted: true,
    });
    fakeWindow.dispatchEvent(bfcacheEvent);
    await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(4));
    expect(listEl.children).toHaveLength(1);

    // Subsequent background push after restart updates the same open popout cleanly.
    const nextSnapshot: BridgePopoutSnapshot = {
      localSite: "twitch",
      peerSite: "youtube-live",
      peerLabel: "YT Stream",
      delaySec: 2,
      suspendedReason: null,
      messages: [
        ...firstSnapshot.messages,
        message({
          id: "yt-2",
          site: "youtube-live",
          authorName: "YTUser",
          text: "after restart line",
        }),
      ],
    };
    expect(runtimeListeners).toHaveLength(1);
    for (const listener of runtimeListeners) {
      listener(
        { type: BRIDGE_POPOUT_UPDATE_TYPE, snapshot: nextSnapshot },
        { id: fakeBrowser.runtime.id },
      );
    }
    expect(listEl.children).toHaveLength(2);
    expect(listEl.children[1]?.textContent).toContain("after restart line");
    expect(delayEl.textContent).toBe("+2s");

    const twBadge = listEl.children[0]?.children[0];
    expect(twBadge?.className).toBe("fce-popout-site-badge");
    expect(twBadge?.dataset.site).toBe("twitch");
    expect(twBadge?.getAttribute("role")).toBe("img");
    expect(twBadge?.getAttribute("aria-label")).toBe("Twitch");
    expect(twBadge?.title).toBe("Twitch");
    expect(twBadge?.textContent).toBe("");
    const twSvg = twBadge?.children[0];
    expect(twSvg?.tagName.toLowerCase()).toBe("svg");
    expect(twSvg?.children.map((path) => path.getAttribute("fill"))).toEqual([
      "#9146ff",
      "#ffffff",
      "#9146ff",
    ]);

    const ytBadge = listEl.children[1]?.children[0];
    expect(ytBadge?.className).toBe("fce-popout-site-badge");
    expect(ytBadge?.dataset.site).toBe("youtube-live");
    expect(ytBadge?.getAttribute("role")).toBe("img");
    expect(ytBadge?.getAttribute("aria-label")).toBe("YouTube");
    expect(ytBadge?.title).toBe("YouTube");
    expect(ytBadge?.textContent).toBe("");
    const ytSvg = ytBadge?.children[0];
    expect(ytSvg?.tagName.toLowerCase()).toBe("svg");
    expect(ytSvg?.children.map((path) => path.getAttribute("fill"))).toEqual([
      "#ff0033",
      "#ffffff",
    ]);

    // Explicit null update from background (e.g., watch tab closed) clears list as expected.
    for (const listener of runtimeListeners) {
      listener(
        { type: BRIDGE_POPOUT_UPDATE_TYPE, snapshot: null },
        { id: fakeBrowser.runtime.id },
      );
    }
    expect(listEl.children).toHaveLength(0);
    expect(peerEl.hidden).toBe(true);
    expect(peerEl.title).toBe("");
  });
});
