import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionSettings } from "../../src/shared/settings";
import { settings } from "../helpers";

const state = vi.hoisted(() => ({
  load: vi.fn<() => Promise<ExtensionSettings>>(),
  listeners: new Set<(next: ExtensionSettings) => void>(),
}));

vi.mock("../../src/shared/settings", async (original) => ({
  ...(await original<typeof import("../../src/shared/settings")>()),
  loadSettings: state.load,
  watchSettings: (listener: (next: ExtensionSettings) => void) => {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  },
}));

vi.mock("../../src/shared/i18n", async (original) => ({
  ...(await original<typeof import("../../src/shared/i18n")>()),
  ensureLocale: vi.fn(async () => "en"),
  t: (_locale: string, key: string) => key,
}));

class FakeNode {
  id = "";
  type = "";
  className = "";
  title = "";
  textContent = "";
  style = {
    props: new Map<string, { value: string; priority: string }>(),
    setProperty(name: string, value: string, priority = "") {
      this.props.set(name, { value, priority });
    },
    removeProperty(name: string) {
      this.props.delete(name);
    },
    getPropertyValue(name: string) {
      return this.props.get(name)?.value ?? "";
    },
    getPropertyPriority(name: string) {
      return this.props.get(name)?.priority ?? "";
    },
  };
  dataset: Record<string, string> = {};
  attrs = new Map<string, string>();
  children: FakeNode[] = [];
  parentElement: FakeNode | null = null;
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  append(...nodes: FakeNode[]) {
    for (const node of nodes) {
      this.appendChild(node);
    }
  }
  appendChild(child: FakeNode) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child: FakeNode) {
    return this.appendChild(child);
  }
  replaceChildren(...nodes: FakeNode[]) {
    this.children = nodes;
  }
  addEventListener() {}
  remove() {}
  querySelector(selector: string): FakeNode | null {
    if (selector.includes("fce-player-toggle-icon")) {
      return this.children[0] ?? null;
    }
    if (selector.includes("fce-player-toggle-badge")) {
      return this.children[1] ?? null;
    }
    return null;
  }
}

beforeEach(() => {
  state.listeners.clear();
  state.load.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("late initial settings read guards", () => {
  it("keeps newer watchSettings state in startPlayerChrome", async () => {
    let releaseInitial!: (value: ExtensionSettings) => void;
    state.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseInitial = resolve;
        }),
    );
    const controls = new FakeNode();
    const byId = new Map<string, FakeNode>();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("document", {
      documentElement: new FakeNode(),
      createElement: () => new FakeNode(),
      createElementNS: () => new FakeNode(),
      getElementById: (id: string) => byId.get(id) ?? null,
      querySelector: (selector: string) =>
        selector.includes("ytp-right-controls") ? controls : null,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    // Track created button by id
    const origCreate = (
      document as unknown as { createElement: () => FakeNode }
    ).createElement;
    vi.spyOn(
      document as unknown as { createElement: () => FakeNode },
      "createElement",
    ).mockImplementation(() => {
      const node = origCreate();
      return new Proxy(node, {
        set(target, prop, value) {
          (target as unknown as Record<PropertyKey, unknown>)[prop] = value;
          if (prop === "id" && typeof value === "string") {
            byId.set(value, target);
          }
          return true;
        },
      });
    });
    vi.stubGlobal(
      "MutationObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );

    const { startPlayerChrome } = await import("../../src/views/player-chrome");
    const stop = startPlayerChrome("youtube");
    const updated = settings();
    updated.enabled = false;
    for (const listener of state.listeners) listener(updated);
    await Promise.resolve();
    await Promise.resolve();

    const button = byId.get("fce-player-toggle");
    expect(button?.dataset.enabled).toBe("0");

    // Late initial read (enabled: true) must NOT overwrite the newer disabled state.
    releaseInitial(settings());
    await Promise.resolve();
    await Promise.resolve();
    expect(button?.dataset.enabled).toBe("0");
    stop();
  });

  it("keeps newer watchSettings filter state in startNativeChatNgHider", async () => {
    let releaseInitial!: (value: ExtensionSettings) => void;
    state.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseInitial = resolve;
        }),
    );

    const row = new FakeNode();
    row.setAttribute("author-type", "");
    Object.assign(row, {
      querySelector: (sel: string) => {
        if (sel.includes("author-name")) return { textContent: "Viewer" };
        if (sel.includes("#message"))
          return {
            textContent: "safe",
            childNodes: [{ nodeType: 3, textContent: "safe" }],
          };
        return null;
      },
    });

    vi.stubGlobal("HTMLElement", FakeNode);
    vi.stubGlobal("Node", { TEXT_NODE: 3 });
    vi.stubGlobal("document", {
      documentElement: new FakeNode(),
      querySelectorAll: (selector: string) =>
        selector.includes("yt-live-chat-text-message-renderer") ? [row] : [],
    });
    vi.stubGlobal(
      "MutationObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );

    const { startNativeChatNgHider } =
      await import("../../src/app/native-chat-ng");
    const stop = startNativeChatNgHider("youtube-live");

    const updated = settings();
    updated.filter.applyToNativeChat = false;
    for (const listener of state.listeners) listener(updated);
    expect(row.getAttribute("data-fce-ng-hidden")).toBeNull();

    // Late initial read with ngWords: ["safe"] and applyToNativeChat: true must NOT re-apply.
    const stale = settings();
    stale.filter.ngWords = ["safe"];
    stale.filter.applyToNativeChat = true;
    releaseInitial(stale);
    await Promise.resolve();
    await Promise.resolve();
    expect(row.getAttribute("data-fce-ng-hidden")).toBeNull();
    stop();
  });
});
