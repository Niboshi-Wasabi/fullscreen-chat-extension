import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  createOverlayPanel,
  type OverlayBridgeHooks,
  type OverlayBridgeState,
} from "../../src/views/overlay-panel";
import { message, settings } from "../helpers";

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  type: string;
  key?: string;
  bubbles: boolean;
  target: FakeNode | null;
  currentTarget: FakeNode | null;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

class FakeNode {
  parentElement: FakeElement | null = null;
  textContent = "";
  constructor(readonly ownerDocument: FakeDocument) {}
  remove(): void {
    this.parentElement?.removeChildNode(this);
  }
}

class FakeTextNode extends FakeNode {
  readonly nodeType = 3;
  constructor(ownerDocument: FakeDocument, text: string) {
    super(ownerDocument);
    this.textContent = text;
  }
}

class FakeStyle {
  private readonly props = new Map<string, string>();
  pointerEvents = "";
  left = "";
  top = "";
  right = "";
  bottom = "";
  width = "";
  height = "";
  maxWidth = "";
  gridColumn = "";
  display = "";
  color = "";
  setProperty(name: string, value: string): void {
    this.props.set(name, value);
  }
  getPropertyValue(name: string): string {
    return this.props.get(name) ?? "";
  }
}

class FakeElement extends FakeNode {
  readonly nodeType = 1;
  id = "";
  className = "";
  hidden = false;
  value = "";
  disabled = false;
  type = "";
  title = "";
  allow = "";
  src = "";
  placeholder = "";
  rows = 0;
  maxLength = 0;
  tabIndex = -1;
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  dataset: Record<string, string> = {};
  readonly style = new FakeStyle();
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly childNodes: FakeNode[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    ownerDocument: FakeDocument,
    readonly tagName: string,
  ) {
    super(ownerDocument);
  }

  get isConnected(): boolean {
    if (this === this.ownerDocument.body) {
      return true;
    }
    let current = this.parentElement;
    while (current) {
      if (current === this.ownerDocument.body) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchFakeEvent(
    type: string,
    extra: { key?: string; bubbles?: boolean } = {},
  ): FakeEvent {
    const event: FakeEvent = {
      type,
      key: extra.key,
      bubbles: extra.bubbles ?? true,
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
      stopPropagation() {
        event.propagationStopped = true;
      },
    };
    const emitAt = (node: FakeElement): void => {
      event.currentTarget = node;
      const set = node.listeners.get(type);
      if (set) {
        for (const listener of Array.from(set)) {
          listener(event);
        }
      }
    };
    emitAt(this);
    let current = this.parentElement;
    while (current && event.bubbles && !event.propagationStopped) {
      emitAt(current);
      current = current.parentElement;
    }
    return event;
  }

  append(...nodes: Array<FakeNode | FakeDocumentFragment>): void {
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  appendChild<T extends FakeNode | FakeDocumentFragment>(node: T): T {
    if (node instanceof FakeDocumentFragment) {
      const items = [...node.childNodes];
      node.childNodes.length = 0;
      node.children.length = 0;
      for (const item of items) {
        this.appendChild(item);
      }
      return node;
    }
    node.remove();
    node.parentElement = this;
    this.childNodes.push(node);
    if (node instanceof FakeElement) {
      this.children.push(node);
    }
    return node;
  }

  insertBefore<T extends FakeNode>(newNode: T, refNode: FakeNode | null): T {
    if (!refNode) {
      return this.appendChild(newNode);
    }
    newNode.remove();
    newNode.parentElement = this;
    const nodeIdx = this.childNodes.indexOf(refNode);
    if (nodeIdx >= 0) {
      this.childNodes.splice(nodeIdx, 0, newNode);
    } else {
      this.childNodes.push(newNode);
    }
    if (newNode instanceof FakeElement) {
      const elIdx = this.children.indexOf(refNode as FakeElement);
      if (elIdx >= 0) {
        this.children.splice(elIdx, 0, newNode);
      } else {
        this.children.push(newNode);
      }
    }
    return newNode;
  }

  replaceChild<T extends FakeNode>(newNode: T, oldNode: FakeNode): FakeNode {
    newNode.remove();
    newNode.parentElement = this;
    const nodeIdx = this.childNodes.indexOf(oldNode);
    if (nodeIdx >= 0) {
      this.childNodes[nodeIdx] = newNode;
    }
    if (oldNode instanceof FakeElement && newNode instanceof FakeElement) {
      const elIdx = this.children.indexOf(oldNode);
      if (elIdx >= 0) {
        this.children[elIdx] = newNode;
      }
    }
    oldNode.parentElement = null;
    return oldNode;
  }

  replaceChildren(...nodes: Array<FakeNode | FakeDocumentFragment>): void {
    for (const child of [...this.childNodes]) {
      child.parentElement = null;
    }
    this.childNodes.length = 0;
    this.children.length = 0;
    this.append(...nodes);
  }

  removeChildNode(node: FakeNode): void {
    const nodeIdx = this.childNodes.indexOf(node);
    if (nodeIdx >= 0) {
      this.childNodes.splice(nodeIdx, 1);
    }
    if (node instanceof FakeElement) {
      const elIdx = this.children.indexOf(node);
      if (elIdx >= 0) {
        this.children.splice(elIdx, 1);
      }
    }
    node.parentElement = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "tabindex") {
      this.tabIndex = Number(value);
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getAttributeNames(): string[] {
    return Array.from(this.attributes.keys());
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === "tabindex") {
      this.tabIndex = -1;
    }
  }

  matches(selector: string): boolean {
    if (selector === ".fce-panel-row[data-message-id]") {
      return (
        this.className.split(/\s+/).includes("fce-panel-row") &&
        Boolean(this.dataset.messageId)
      );
    }
    if (selector.startsWith(".")) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }
    if (/^[a-z]+$/i.test(selector)) {
      return this.tagName.toLowerCase() === selector.toLowerCase();
    }
    return false;
  }

  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) {
      return this;
    }
    let current = this.parentElement;
    while (current) {
      if (current.matches(selector)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector: string): FakeElement | null {
    for (const child of this.children) {
      if (child.matches(selector)) {
        return child;
      }
      const found = child.querySelector(selector);
      if (found) {
        return found;
      }
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const results: FakeElement[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) {
        results.push(child);
      }
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 600 };
  }

  focus(): void {}
}

class FakeDocumentFragment {
  readonly childNodes: FakeNode[] = [];
  readonly children: FakeElement[] = [];
  appendChild<T extends FakeNode>(node: T): T {
    this.childNodes.push(node);
    if (node instanceof FakeElement) {
      this.children.push(node);
    }
    return node;
  }
}

class FakeDocument {
  readonly body: FakeElement;
  readonly fullscreenElement: FakeElement | null = null;
  readonly activeElement: FakeElement | null = null;
  constructor() {
    this.body = new FakeElement(this, "body");
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(this, tag);
  }
  createElementNS(_ns: string, tag: string): FakeElement {
    return new FakeElement(this, tag);
  }
  createTextNode(text: string): FakeTextNode {
    return new FakeTextNode(this, text);
  }
  createDocumentFragment(): FakeDocumentFragment {
    return new FakeDocumentFragment();
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

function makeBridgeState(
  overrides: Partial<OverlayBridgeState> = {},
): OverlayBridgeState {
  return {
    supported: true,
    sources: [
      { tabId: 77, site: "twitch", channelLogin: "shroud", label: "#shroud" },
    ],
    activeSource: {
      tabId: 77,
      site: "twitch",
      channelLogin: "shroud",
      label: "#shroud",
    },
    delaySec: 10,
    suspendedReason: null,
    calibration: {
      status: "idle",
      selectedMessageId: null,
      suggestedDelaySec: null,
    },
    ...overrides,
  };
}

let doc: FakeDocument;

beforeEach(() => {
  vi.spyOn(fakeBrowser.i18n, "getUILanguage").mockReturnValue("ja");
  doc = new FakeDocument();
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", {
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({ position: "relative" }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createTestPanel() {
  const hooks: OverlayBridgeHooks = {
    onRefreshSources: vi.fn(),
    onSelectSource: vi.fn(),
    onAdjustDelay: vi.fn(),
    onResume: vi.fn(),
    onDisconnect: vi.fn(),
    onMarkScene: vi.fn(),
    onSelectReaction: vi.fn(),
    onApplySuggestedDelay: vi.fn(),
    onCancelCalibration: vi.fn(),
  };
  const panel = createOverlayPanel({
    site: "youtube-live",
    onSend: async () => false,
    bridge: hooks,
  });
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const initial = settings();
  initial.uiLocale = "ja";
  initial.panel.useNativeChat = false;
  panel.mount(container as unknown as HTMLElement);
  panel.applySettings(initial);
  return { panel, hooks, container, initial };
}

describe("overlay panel bridge calibration UI", () => {
  it("shows Mark scene only when bridge is active and not suspended", () => {
    const { panel, container, initial } = createTestPanel();
    const calibrateBar = container.querySelector(
      ".fce-panel-bridge-calibrate",
    )!;
    const markBtn = container.querySelector(".fce-panel-bridge-mark")!;

    expect(calibrateBar.hidden).toBe(true);

    panel.setBridgeState(makeBridgeState());
    expect(calibrateBar.hidden).toBe(false);
    expect(markBtn.hidden).toBe(false);
    expect(markBtn.textContent).toBe("場面を記録");

    panel.applySettings({ ...initial, uiLocale: "en" });
    expect(markBtn.textContent).toBe("Mark scene");

    panel.setBridgeState(makeBridgeState({ suspendedReason: "pause" }));
    expect(calibrateBar.hidden).toBe(true);

    panel.setBridgeState(makeBridgeState({ activeSource: null }));
    expect(calibrateBar.hidden).toBe(true);

    panel.unmount();
  });

  it("handles mark, row selection (existing + appended), scroll preservation, and keyboard shortcuts", () => {
    const { panel, hooks, container } = createTestPanel();
    const parentClicks = vi.fn();
    container.addEventListener("click", parentClicks);

    panel.setBridgeState(makeBridgeState());
    panel.setMessages([
      message({ id: "m1", site: "twitch", text: "first reaction" }),
      message({ id: "m2", site: "twitch", text: "second reaction" }),
    ]);

    const listEl = container.querySelector(".fce-panel-list")!;
    const row1Before = listEl.children[0]!;
    const markBtn = container.querySelector(".fce-panel-bridge-mark")!;

    const markEvent = markBtn.dispatchFakeEvent("click");
    expect(hooks.onMarkScene).toHaveBeenCalledTimes(1);
    expect(markEvent.propagationStopped).toBe(true);
    expect(parentClicks).not.toHaveBeenCalled();

    // Simulate user scrolling up before new messages arrive during picking.
    listEl.scrollHeight = 500;
    listEl.clientHeight = 200;
    listEl.scrollTop = 50;

    panel.setBridgeState(
      makeBridgeState({
        calibration: {
          status: "picking",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );

    const panelEl = container.querySelector(".fce-panel")!;
    const statusEl = container.querySelector(
      ".fce-panel-bridge-calibrate-status",
    )!;
    expect(panelEl.dataset.calibrating).toBe("1");
    expect(statusEl.textContent).toBe(
      "記録した場面への反応を 1 件選んでください",
    );
    expect(row1Before.dataset.selectable).toBe("1");
    expect(row1Before.getAttribute("role")).toBe("button");
    expect(row1Before.tabIndex).toBe(0);

    // Appending a message keeps existing row DOM node identical and preserves scrolled-up position.
    panel.setMessages([
      message({ id: "m1", site: "twitch", text: "first reaction" }),
      message({ id: "m2", site: "twitch", text: "second reaction" }),
      message({ id: "m3", site: "twitch", text: "third reaction" }),
    ]);
    expect(listEl.children[0]).toBe(row1Before);
    expect(listEl.scrollTop).toBe(50);

    const row3 = listEl.children[2]!;
    expect(row3.dataset.selectable).toBe("1");

    // Clicking text inside row1 selects m1 without bubbling to YouTube player.
    const row1Body = row1Before.querySelector(".fce-panel-text")!;
    const clickRow1 = row1Body.dispatchFakeEvent("click");
    expect(hooks.onSelectReaction).toHaveBeenCalledWith("m1");
    expect(clickRow1.propagationStopped).toBe(true);
    expect(parentClicks).not.toHaveBeenCalled();

    // Clicking newly appended row3 selects m3.
    row3.dispatchFakeEvent("click");
    expect(hooks.onSelectReaction).toHaveBeenLastCalledWith("m3");

    // Same-id hydration updates the row content in place.
    panel.setMessages([
      message({ id: "m1", site: "twitch", text: "first reaction" }),
      message({ id: "m2", site: "twitch", text: "second hydrated" }),
      message({ id: "m3", site: "twitch", text: "third reaction" }),
    ]);
    expect(listEl.children[0]).toBe(row1Before);
    expect(
      listEl.children[1]?.querySelector(".fce-panel-text")?.childNodes[0]
        ?.textContent,
    ).toBe("second hydrated");

    // Keyboard Enter selects row and Escape cancels calibration.
    row1Before.dispatchFakeEvent("keydown", { key: "Enter" });
    expect(hooks.onSelectReaction).toHaveBeenLastCalledWith("m1");
    row1Before.dispatchFakeEvent("keydown", { key: "Escape" });
    expect(hooks.onCancelCalibration).toHaveBeenCalledTimes(1);

    panel.unmount();
  });

  it("renders suggested estimate, selected highlight, Apply, Cancel, and unmounts cleanly", () => {
    const { panel, hooks, container, initial } = createTestPanel();
    panel.setBridgeState(makeBridgeState());
    panel.setMessages([
      message({ id: "m1", site: "twitch", text: "alpha" }),
      message({ id: "m2", site: "twitch", text: "beta" }),
    ]);

    panel.setBridgeState(
      makeBridgeState({
        calibration: {
          status: "suggested",
          selectedMessageId: "m2",
          suggestedDelaySec: 12,
        },
      }),
    );

    const statusEl = container.querySelector(
      ".fce-panel-bridge-calibrate-status",
    )!;
    const markBtn = container.querySelector(".fce-panel-bridge-mark")!;
    const applyBtn = container.querySelector(".fce-panel-bridge-apply")!;
    const cancelBtn = container.querySelector(".fce-panel-bridge-cancel")!;
    const listEl = container.querySelector(".fce-panel-list")!;
    const row1 = listEl.children[0]!;
    const row2 = listEl.children[1]!;

    expect(statusEl.textContent).toBe("推定 +12秒");
    expect(markBtn.hidden).toBe(true);
    expect(applyBtn.hidden).toBe(false);
    expect(applyBtn.textContent).toBe("適用");
    expect(cancelBtn.hidden).toBe(false);
    expect(cancelBtn.textContent).toBe("キャンセル");
    expect(row1.dataset.selected).toBe("0");
    expect(row1.getAttribute("aria-pressed")).toBe("false");
    expect(row2.dataset.selected).toBe("1");
    expect(row2.getAttribute("aria-pressed")).toBe("true");

    panel.applySettings({ ...initial, uiLocale: "en" });
    expect(statusEl.textContent).toBe("Suggested +12s");
    expect(applyBtn.textContent).toBe("Apply");
    expect(cancelBtn.textContent).toBe("Cancel");

    applyBtn.dispatchFakeEvent("click");
    expect(hooks.onApplySuggestedDelay).toHaveBeenCalledTimes(1);
    cancelBtn.dispatchFakeEvent("click");
    expect(hooks.onCancelCalibration).toHaveBeenCalledTimes(1);

    panel.unmount();
    expect(container.querySelector(".fce-panel")).toBeNull();
  });

  it("renders site badges for mixed rows, keeps local list visible when suspended, limits calibration to remote rows, and adapts picker labels per host site", () => {
    const { panel, hooks, container, initial } = createTestPanel();
    panel.setBridgeState(makeBridgeState());
    panel.setMessages([
      message({ id: "same-1", site: "youtube-live", text: "yt local" }),
      message({ id: "same-1", site: "twitch", text: "tw remote" }),
    ]);

    const listEl = container.querySelector(".fce-panel-list")!;
    expect(listEl.children).toHaveLength(2);
    expect(listEl.children[0]?.dataset.site).toBe("youtube-live");
    expect(listEl.children[1]?.dataset.site).toBe("twitch");
    const ytBadge = listEl.children[0]?.querySelector(".fce-panel-site-badge");
    const twBadge = listEl.children[1]?.querySelector(".fce-panel-site-badge");
    expect(ytBadge?.dataset.site).toBe("youtube-live");
    expect(ytBadge?.getAttribute("role")).toBe("img");
    expect(ytBadge?.getAttribute("aria-label")).toBe("YouTube");
    expect(ytBadge?.title).toBe("YouTube");
    expect(ytBadge?.textContent).toBe("");
    const ytSvg = ytBadge?.querySelector("svg");
    expect(ytSvg?.getAttribute("aria-hidden")).toBe("true");
    expect(ytSvg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(
      ytSvg?.querySelectorAll("path").map((path) => path.getAttribute("fill")),
    ).toEqual(["#ff0033", "#ffffff"]);

    expect(twBadge?.dataset.site).toBe("twitch");
    expect(twBadge?.getAttribute("role")).toBe("img");
    expect(twBadge?.getAttribute("aria-label")).toBe("Twitch");
    expect(twBadge?.title).toBe("Twitch");
    expect(twBadge?.textContent).toBe("");
    const twSvg = twBadge?.querySelector("svg");
    expect(twSvg?.getAttribute("aria-hidden")).toBe("true");
    expect(twSvg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(
      twSvg?.querySelectorAll("path").map((path) => path.getAttribute("fill")),
    ).toEqual(["#9146ff", "#ffffff", "#9146ff"]);

    // In picking mode, only remote Twitch rows are selectable; clicking local YT row does nothing.
    panel.setBridgeState(
      makeBridgeState({
        calibration: {
          status: "picking",
          selectedMessageId: null,
          suggestedDelaySec: null,
        },
      }),
    );
    const ytRow = listEl.children[0]!;
    const twRow = listEl.children[1]!;
    expect(ytRow.dataset.selectable).toBeUndefined();
    expect(twRow.dataset.selectable).toBe("1");

    ytRow.dispatchFakeEvent("click");
    expect(hooks.onSelectReaction).not.toHaveBeenCalled();
    twRow.dispatchFakeEvent("click");
    expect(hooks.onSelectReaction).toHaveBeenCalledWith("same-1");

    // When suspended, mask banner appears while local list remains visible.
    panel.setBridgeState(makeBridgeState({ suspendedReason: "pause" }));
    const maskEl = container.querySelector(".fce-panel-bridge-mask")!;
    expect(maskEl.hidden).toBe(false);
    expect(listEl.hidden).toBe(false);
    panel.unmount();

    // Twitch host panel shows YouTube tab picker label and Off (Twitch only).
    vi.stubGlobal("location", { href: "https://www.twitch.tv/shroud" });
    const twitchHooks: OverlayBridgeHooks = {
      onRefreshSources: vi.fn(),
      onSelectSource: vi.fn(),
      onAdjustDelay: vi.fn(),
      onResume: vi.fn(),
      onDisconnect: vi.fn(),
      onMarkScene: vi.fn(),
      onSelectReaction: vi.fn(),
      onApplySuggestedDelay: vi.fn(),
      onCancelCalibration: vi.fn(),
    };
    const twitchPanel = createOverlayPanel({
      site: "twitch",
      onSend: async () => false,
      bridge: twitchHooks,
    });
    const twitchHost = doc.createElement("div");
    doc.body.appendChild(twitchHost);
    twitchPanel.mount(twitchHost as unknown as HTMLElement);
    twitchPanel.applySettings({ ...initial, uiLocale: "ja" });
    twitchPanel.setBridgeState(
      makeBridgeState({
        sources: [
          {
            tabId: 88,
            site: "youtube-live",
            channelLogin: "ytVid1",
            label: "YT Stream",
          },
        ],
        activeSource: null,
      }),
    );
    const gearTitle = twitchHost.querySelector(".fce-panel-bridge-row")
      ?.children[0];
    const selectEl = twitchHost.querySelector(".fce-panel-bridge-select")!;
    expect(gearTitle?.textContent).toBe("YouTube タブ");
    expect(selectEl.children[0]?.textContent).toBe("オフ（Twitch のみ）");
    expect(selectEl.children[1]?.textContent).toBe("YT Stream");
    twitchPanel.unmount();
  });
});
