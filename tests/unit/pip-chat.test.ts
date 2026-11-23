import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPipChatController } from "../../src/views/pip-chat";
import type { ExtensionSettings } from "../../src/shared/settings";
import { settings } from "../helpers";
import { fakeBrowser } from "wxt/testing/fake-browser";

const storage = vi.hoisted(() => ({
  load: vi.fn(),
  listeners: new Set<(next: ExtensionSettings) => void>(),
}));
vi.mock("../../src/shared/settings", async (original) => ({
  ...(await original<typeof import("../../src/shared/settings")>()),
  loadSettings: storage.load,
  watchSettings: (listener: (next: ExtensionSettings) => void) => {
    storage.listeners.add(listener);
    return () => storage.listeners.delete(listener);
  },
}));

class FakeElement extends EventTarget {
  className = "";
  hidden = false;
  textContent = "";
  value = "";
  disabled = false;
  scrollTop = 0;
  scrollHeight = 0;
  rows = 0;
  maxLength = 0;
  type = "";
  title = "";
  allow = "";
  src = "";
  contentDocument: { body: { textContent: string } } | null = null;
  placeholder = "";
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  constructor(
    readonly ownerDocument: FakeDocument,
    readonly tagName = "div",
  ) {
    super();
  }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      this.appendChild(node);
    }
  }
  appendChild(node: FakeElement): FakeElement {
    if (node instanceof FakeDocumentFragment) {
      this.children.push(...node.children);
      node.children.length = 0;
      return node;
    }
    this.children.push(node);
    return node;
  }
  replaceChildren(...nodes: FakeElement[]): void {
    this.children = nodes;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  remove(): void {}
  focus(): void {}
}

class FakeDocumentFragment extends FakeElement {}

class FakeDocument {
  readonly head: FakeElement = new FakeElement(this, "head");
  readonly body: FakeElement = new FakeElement(this, "body");
  createElement(tag = "div"): FakeElement {
    return new FakeElement(this, tag);
  }
  createElementNS(_ns: string, tag: string): FakeElement {
    return new FakeElement(this, tag);
  }
  createTextNode(text: string): FakeElement {
    const node = new FakeElement(this, "#text");
    node.textContent = text;
    return node;
  }
  createDocumentFragment(): FakeElement {
    return new FakeDocumentFragment(this, "#fragment");
  }
}

/** Like the browser, closing the PiP window fires its pagehide. */
class FakePipWindow extends EventTarget {
  closed = false;
  readonly document = new FakeDocument();
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dispatchEvent(new Event("pagehide"));
  }
}

let requestWindow: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(fakeBrowser.i18n, "getUILanguage").mockReturnValue("en");
  storage.listeners.clear();
  storage.load.mockImplementation(() => new Promise(() => {}));
  requestWindow = vi.fn(async () => new FakePipWindow());
  vi.stubGlobal("window", {
    documentPictureInPicture: { requestWindow },
  });
});
afterEach(() => vi.unstubAllGlobals());

function controller() {
  const onClosedExternally = vi.fn();
  const pip = createPipChatController({
    onSend: async () => true,
    onClosedExternally,
  });
  return { pip, onClosedExternally };
}

describe("Document PiP close paths", () => {
  it("reports a disabled official chat so the caller can reveal the fallback list", async () => {
    const onNativeChatRejected = vi.fn(() => pip.setNativeChatUrl(null));
    const pip = createPipChatController({
      onSend: async () => true,
      onNativeChatRejected,
    });
    pip.setNativeChatUrl("https://www.youtube.com/live_chat?v=fixture");
    await pip.open();
    const opened = (await requestWindow.mock.results[0]!
      .value) as FakePipWindow;
    const list = opened.document.body.children[1]!;
    const frame = opened.document.body.children[2]!;
    expect(list.hidden).toBe(true);
    frame.contentDocument = { body: { textContent: "Chat is disabled" } };
    frame.dispatchEvent(new Event("load"));
    expect(onNativeChatRejected).toHaveBeenCalledTimes(1);
    expect(frame.hidden).toBe(true);
    expect(list.hidden).toBe(false);
    pip.close();
  });
  it("updates compose visibility without reopening and unsubscribes on close", async () => {
    const initial = settings();
    initial.compose.enabled = false;
    storage.load.mockResolvedValue(initial);
    const { pip } = controller();
    await pip.open();
    const opened = (await requestWindow.mock.results[0]!
      .value) as FakePipWindow;
    const form = opened.document.body.children[3]!;
    await vi.waitFor(() => expect(form.hidden).toBe(true));
    const next = settings();
    for (const listener of storage.listeners) listener(next);
    expect(form.hidden).toBe(false);
    next.compose.enabled = false;
    for (const listener of storage.listeners) listener(next);
    expect(form.hidden).toBe(true);
    expect(requestWindow).toHaveBeenCalledTimes(1);
    pip.close();
    expect(storage.listeners.size).toBe(0);
  });

  it("does not let a late initial settings read undo a newer notification", async () => {
    let release!: (value: ExtensionSettings) => void;
    storage.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { pip } = controller();
    await pip.open();
    const opened = (await requestWindow.mock.results[0]!
      .value) as FakePipWindow;
    const form = opened.document.body.children[3]!;
    const next = settings();
    next.compose.enabled = false;
    for (const listener of storage.listeners) listener(next);
    release(settings());
    await Promise.resolve();
    await Promise.resolve();
    expect(form.hidden).toBe(true);
    pip.close();
  });
  it("reports a close by the user, not one requested through close()", async () => {
    const { pip, onClosedExternally } = controller();
    expect(await pip.open()).toBe(true);
    pip.close();
    expect(pip.isOpen()).toBe(false);
    expect(onClosedExternally).not.toHaveBeenCalled();

    expect(await pip.open()).toBe(true);
    const opened = (await requestWindow.mock.results[1]?.value) as
      FakePipWindow | undefined;
    opened?.close();
    expect(pip.isOpen()).toBe(false);
    expect(onClosedExternally).toHaveBeenCalledTimes(1);
    expect(storage.listeners.size).toBe(0);
  });

  it("closes a window that arrives after close() without reporting it", async () => {
    let resolve!: (win: FakePipWindow) => void;
    requestWindow.mockImplementationOnce(
      () => new Promise<FakePipWindow>((done) => (resolve = done)),
    );
    const { pip, onClosedExternally } = controller();
    const pending = pip.open();
    pip.close();
    const late = new FakePipWindow();
    resolve(late);
    expect(await pending).toBe(false);
    expect(late.closed).toBe(true);
    expect(pip.isOpen()).toBe(false);
    expect(onClosedExternally).not.toHaveBeenCalled();
  });

  it("returns false when the browser refuses the window", async () => {
    requestWindow.mockRejectedValueOnce(new Error("NotAllowedError"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { pip, onClosedExternally } = controller();
    expect(await pip.open()).toBe(false);
    expect(pip.isOpen()).toBe(false);
    expect(onClosedExternally).not.toHaveBeenCalled();
  });

  it("tracks isOpening while requestWindow is pending and clears on settle or close", async () => {
    let resolve!: (win: FakePipWindow) => void;
    requestWindow.mockImplementationOnce(
      () => new Promise<FakePipWindow>((done) => (resolve = done)),
    );
    const { pip } = controller();
    expect(pip.isOpening?.()).toBe(false);
    const pending = pip.open();
    expect(pip.isOpening?.()).toBe(true);
    resolve(new FakePipWindow());
    expect(await pending).toBe(true);
    expect(pip.isOpening?.()).toBe(false);
    pip.close();
  });

  it("suppresses console.warn on expected NotAllowedError and formats unexpected DOMException details", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { pip } = controller();

    requestWindow.mockRejectedValueOnce(
      new DOMException(
        "Document Picture-in-Picture requires user activation",
        "NotAllowedError",
      ),
    );
    expect(await pip.open()).toBe(false);
    expect(pip.isOpening?.()).toBe(false);
    expect(warn).not.toHaveBeenCalled();

    requestWindow.mockRejectedValueOnce(
      new DOMException("Already open", "InvalidStateError"),
    );
    expect(await pip.open()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[fce] Document PiP open failed (requestWindow): InvalidStateError: Already open",
    );
  });

  it("ignores disallowed native chat embed URLs", async () => {
    const { pip } = controller();
    pip.setNativeChatUrl("http://www.youtube.com/live_chat?v=abc");
    expect(await pip.open()).toBe(true);
    const opened = (await requestWindow.mock.results[0]
      ?.value) as FakePipWindow;
    const frame = opened.document.body.children[2]!;
    expect(frame.hidden).toBe(true);
    expect(frame.src).toBe("");

    pip.setNativeChatUrl(
      "https://www.twitch.tv/embed/k4sen/chat?parent=www.twitch.tv",
    );
    expect(frame.hidden).toBe(false);
    expect(frame.src).toBe(
      "https://www.twitch.tv/embed/k4sen/chat?parent=www.twitch.tv",
    );
  });

  it("renders site badges and hides compose while in read-only bridge mode", async () => {
    const { pip } = controller();
    await pip.open();
    const opened = (await requestWindow.mock.results[0]
      ?.value) as FakePipWindow;
    const header = opened.document.body.children[0]!;
    const list = opened.document.body.children[1]!;
    const form = opened.document.body.children[3]!;

    pip.setBridgeMode?.({
      active: true,
      headerLabel: "#shroud",
      readOnly: true,
    });
    pip.setMessages([
      {
        id: "yt-1",
        site: "youtube-live",
        authorName: "YTUser",
        text: "Hello YT",
        timestampMs: 1,
        role: "viewer",
        badges: [],
        isCommand: false,
      },
      {
        id: "tw-1",
        site: "twitch",
        authorName: "TWUser",
        text: "Hello TW",
        segments: [
          { type: "text", text: "Hello " },
          {
            type: "emoji",
            alt: "Pog",
            src: "https://cdn.example.test/pog.png",
          },
        ],
        timestampMs: 2,
        role: "viewer",
        badges: [],
        isCommand: false,
      },
    ]);

    expect(form.hidden).toBe(true);
    expect(header.textContent).toContain("#shroud");
    expect(list.children).toHaveLength(2);
    expect(list.children[0]?.dataset.site).toBe("youtube-live");
    expect(list.children[1]?.dataset.site).toBe("twitch");

    const ytBadge = list.children[0]?.children[0]?.children[0];
    expect(ytBadge?.className).toBe("fce-pip-site-badge");
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

    const twBadge = list.children[1]?.children[0]?.children[0];
    expect(twBadge?.className).toBe("fce-pip-site-badge");
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

    pip.setBridgeMode?.({ active: false, readOnly: false });
    expect(form.hidden).toBe(false);
    pip.close();
  });
});
