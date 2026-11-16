import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createYouTubeCommentsPortal,
  findYouTubeCommentsRoot,
} from "../../src/app/youtube-comments-portal";
import {
  COMMENTS_PORTAL_PLACEHOLDER_ID,
  NATIVE_COMMENTS_PORTAL_ID,
} from "../../src/shared/dom-ids";

type FakeNode = {
  id: string;
  tagName: string;
  parentNode: FakeNode | null;
  parentElement: FakeNode | null;
  nextSibling: FakeNode | null;
  previousSibling: FakeNode | null;
  isConnected: boolean;
  childNodes: FakeNode[];
  style: { cssText: string };
  appendChild: (child: FakeNode) => FakeNode;
  insertBefore: (child: FakeNode, ref: FakeNode | null) => FakeNode;
  replaceChildren: (...nodes: FakeNode[]) => void;
  remove: () => void;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => { height: number };
  closest: (selector: string) => FakeNode | null;
  querySelector: (selector: string) => FakeNode | null;
  matches?: (selector: string) => boolean;
};

function createFakeNode(tagName: string, id = ""): FakeNode {
  const attrs = new Map<string, string>();
  const node: FakeNode = {
    id,
    tagName: tagName.toUpperCase(),
    parentNode: null,
    parentElement: null,
    nextSibling: null,
    previousSibling: null,
    isConnected: false,
    childNodes: [],
    style: { cssText: "" },
    appendChild(child) {
      return node.insertBefore(child, null);
    },
    insertBefore(child, ref) {
      if (child.parentNode) {
        child.remove();
      }
      const index =
        ref === null ? node.childNodes.length : node.childNodes.indexOf(ref);
      const at = index < 0 ? node.childNodes.length : index;
      node.childNodes.splice(at, 0, child);
      child.parentNode = node;
      child.parentElement = node;
      child.isConnected = node.isConnected;
      relink(node);
      return child;
    },
    replaceChildren(...nodes) {
      for (const child of [...node.childNodes]) {
        child.parentNode = null;
        child.parentElement = null;
        child.nextSibling = null;
        child.previousSibling = null;
        child.isConnected = false;
      }
      node.childNodes = [];
      for (const child of nodes) {
        node.appendChild(child);
      }
    },
    remove() {
      const parent = node.parentNode;
      if (!parent) {
        return;
      }
      const index = parent.childNodes.indexOf(node);
      if (index >= 0) {
        parent.childNodes.splice(index, 1);
      }
      node.parentNode = null;
      node.parentElement = null;
      node.nextSibling = null;
      node.previousSibling = null;
      node.isConnected = false;
      relink(parent);
    },
    setAttribute(name, value) {
      attrs.set(name, value);
    },
    getAttribute(name) {
      return attrs.get(name) ?? null;
    },
    getBoundingClientRect() {
      return { height: 240 };
    },
    closest(selector) {
      let current: FakeNode | null = node;
      while (current) {
        if (matchesSelector(current, selector)) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    },
    querySelector(selector) {
      return findDeep(node, selector);
    },
  };
  return node;
}

function relink(parent: FakeNode): void {
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes[index]!;
    child.previousSibling = parent.childNodes[index - 1] ?? null;
    child.nextSibling = parent.childNodes[index + 1] ?? null;
    child.isConnected = parent.isConnected;
    relink(child);
  }
}

function matchesSelector(node: FakeNode, selector: string): boolean {
  const parts = selector.split(",").map((part) => part.trim());
  return parts.some((part) => {
    if (part.startsWith("#")) {
      return node.id === part.slice(1);
    }
    if (part.includes("#")) {
      const [tag, id] = part.split("#");
      return (
        node.tagName === (tag ?? "").toUpperCase() && node.id === (id ?? "")
      );
    }
    if (part.includes(".")) {
      const [tag] = part.split(".");
      return node.tagName === (tag ?? "").toUpperCase();
    }
    return node.tagName === part.toUpperCase();
  });
}

function findDeep(root: FakeNode, selector: string): FakeNode | null {
  const stack = [...root.childNodes];
  while (stack.length) {
    const current = stack.shift()!;
    if (matchesSelector(current, selector)) {
      return current;
    }
    stack.push(...current.childNodes);
  }
  return null;
}

function installFakeDocument(root: FakeNode): void {
  root.isConnected = true;
  relink(root);
  const doc = {
    documentElement: root,
    body: root,
    getElementById(id: string) {
      if (root.id === id) {
        return root;
      }
      return findDeep(root, `#${id}`);
    },
    createElement(tag: string) {
      return createFakeNode(tag);
    },
    querySelector(selector: string) {
      return findDeep(root, selector);
    },
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("findYouTubeCommentsRoot", () => {
  it("prefers ytd-comments#comments", () => {
    const root = createFakeNode("body");
    const other = createFakeNode("ytd-comments");
    const preferred = createFakeNode("ytd-comments", "comments");
    root.appendChild(other);
    root.appendChild(preferred);
    installFakeDocument(root);
    expect(findYouTubeCommentsRoot(document as unknown as ParentNode)).toBe(
      preferred,
    );
  });

  it("ignores the panel portal host", () => {
    const root = createFakeNode("body");
    const host = createFakeNode("div", NATIVE_COMMENTS_PORTAL_ID);
    const nested = createFakeNode("ytd-comments", "comments");
    host.appendChild(nested);
    root.appendChild(host);
    installFakeDocument(root);
    expect(
      findYouTubeCommentsRoot(document as unknown as ParentNode),
    ).toBeNull();
  });
});

describe("createYouTubeCommentsPortal", () => {
  it("reparents comments into the host and restores on detach", () => {
    const root = createFakeNode("body");
    const home = createFakeNode("div", "page-home");
    const comments = createFakeNode("ytd-comments", "comments");
    const sibling = createFakeNode("div", "after-comments");
    const host = createFakeNode("div", NATIVE_COMMENTS_PORTAL_ID);
    home.appendChild(comments);
    home.appendChild(sibling);
    root.appendChild(home);
    root.appendChild(host);
    installFakeDocument(root);

    const portal = createYouTubeCommentsPortal({
      resolveHost: () => host as unknown as HTMLElement,
    });
    portal.sync(true);

    expect(comments.parentElement).toBe(host);
    expect(
      document.getElementById(COMMENTS_PORTAL_PLACEHOLDER_ID),
    ).toBeTruthy();
    expect(
      home.childNodes.some(
        (child) => child.id === COMMENTS_PORTAL_PLACEHOLDER_ID,
      ),
    ).toBe(true);
    expect(portal.isAttached()).toBe(true);

    portal.sync(false);

    expect(comments.parentElement).toBe(home);
    expect(comments.nextSibling).toBe(sibling);
    expect(document.getElementById(COMMENTS_PORTAL_PLACEHOLDER_ID)).toBeNull();
    expect(portal.isAttached()).toBe(false);
  });

  it("dispose restores even when host still holds the node", () => {
    const root = createFakeNode("body");
    const home = createFakeNode("div");
    const comments = createFakeNode("ytd-comments", "comments");
    const host = createFakeNode("div", NATIVE_COMMENTS_PORTAL_ID);
    home.appendChild(comments);
    root.appendChild(home);
    root.appendChild(host);
    installFakeDocument(root);

    const portal = createYouTubeCommentsPortal({
      resolveHost: () => host as unknown as HTMLElement,
    });
    portal.sync(true);
    expect(comments.parentElement).toBe(host);

    portal.dispose();
    expect(comments.parentElement).toBe(home);
    expect(document.getElementById(COMMENTS_PORTAL_PLACEHOLDER_ID)).toBeNull();
  });

  it("calls onUnavailable after retries when comments never appear", () => {
    vi.useFakeTimers();
    const root = createFakeNode("body");
    const host = createFakeNode("div", NATIVE_COMMENTS_PORTAL_ID);
    root.appendChild(host);
    installFakeDocument(root);
    const onUnavailable = vi.fn();
    const portal = createYouTubeCommentsPortal({
      resolveHost: () => host as unknown as HTMLElement,
      onUnavailable,
    });
    portal.sync(true);
    expect(onUnavailable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400 * 21);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    portal.dispose();
  });
});
