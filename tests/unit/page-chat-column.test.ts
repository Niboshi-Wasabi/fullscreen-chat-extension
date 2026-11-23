import { describe, expect, it } from "vitest";
import {
  isChatColumnCollapseLabel,
  isChatColumnExpandLabel,
  isPageChatColumnOpen,
  setTwitchChatReinitializing,
  shouldMountVideoPanel,
} from "../../src/shared/page-chat-column";

function element(options: {
  label?: string;
  collapsed?: boolean;
  hidden?: boolean;
  width?: number;
  height?: number;
  className?: string;
}): Element {
  const attributes = new Map<string, string>();
  if (options.label) {
    attributes.set("aria-label", options.label);
  }
  const classNames = new Set(
    (options.className ?? "").split(/\s+/).filter(Boolean),
  );
  return {
    hasAttribute: (name: string) =>
      (name === "collapsed" && options.collapsed === true) ||
      (name === "hidden" && options.hidden === true) ||
      attributes.has(name),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    classList: {
      contains: (name: string) => classNames.has(name),
    },
    getBoundingClientRect: () => ({
      width: options.width ?? 320,
      height: options.height ?? 640,
    }),
  } as unknown as Element;
}

function page(
  hostname: string,
  nodes: Record<string, Element | null>,
): Document {
  return {
    location: { hostname },
    querySelector: (selector: string) => {
      for (const [key, node] of Object.entries(nodes)) {
        if (selector.includes(key)) {
          return node;
        }
      }
      return null;
    },
  } as unknown as Document;
}

describe("official video chat duplicate gate", () => {
  it("hides the official overlay while the page chat column is open", () => {
    expect(
      shouldMountVideoPanel({
        useNativeChat: true,
        fullscreen: false,
        pageChatOpen: true,
      }),
    ).toBe(false);
  });

  it("shows the official overlay when that column is closed or the player is fullscreen", () => {
    expect(
      shouldMountVideoPanel({
        useNativeChat: true,
        fullscreen: false,
        pageChatOpen: false,
      }),
    ).toBe(true);
    expect(
      shouldMountVideoPanel({
        useNativeChat: true,
        fullscreen: true,
        pageChatOpen: true,
      }),
    ).toBe(true);
  });

  it("keeps the extension list when official chat is off", () => {
    expect(
      shouldMountVideoPanel({
        useNativeChat: false,
        fullscreen: false,
        pageChatOpen: true,
      }),
    ).toBe(true);
  });

  it("treats a collapsed YouTube chat frame as closed", () => {
    const open = page("www.youtube.com", {
      "ytd-live-chat-frame": element({}),
    });
    const collapsed = page("www.youtube.com", {
      "ytd-live-chat-frame": element({ collapsed: true, width: 0, height: 0 }),
    });
    expect(isPageChatColumnOpen(open)).toBe(true);
    expect(isPageChatColumnOpen(collapsed)).toBe(false);
  });

  it("treats the Twitch expand control as a closed column", () => {
    const open = page("www.twitch.tv", {
      "right-column__toggle-collapse-btn": element({
        label: "チャットを折りたたむ",
      }),
    });
    const closed = page("www.twitch.tv", {
      "right-column__toggle-collapse-btn": element({ label: "チャットを展開" }),
    });
    expect(isPageChatColumnOpen(open)).toBe(true);
    expect(isPageChatColumnOpen(closed)).toBe(false);
  });

  it("reads hide labels as an open column even though 非表示 contains 表示", () => {
    for (const label of ["チャットを非表示", "Hide chat", "Collapse Chat"]) {
      expect(isChatColumnCollapseLabel(label)).toBe(true);
      expect(isChatColumnExpandLabel(label)).toBe(false);
      expect(
        isPageChatColumnOpen(
          page("www.twitch.tv", {
            "right-column__toggle-collapse-btn": element({ label }),
          }),
        ),
      ).toBe(true);
    }
    for (const label of ["チャットを表示", "Show chat", "Expand Chat"]) {
      expect(isChatColumnExpandLabel(label)).toBe(true);
    }
  });

  it("falls back to the Twitch column class when the toggle is missing", () => {
    const open = page("www.twitch.tv", {
      "channel-root__right-column": element({}),
    });
    const collapsed = page("www.twitch.tv", {
      "channel-root__right-column": element({
        className: "channel-root__right-column--collapsed",
      }),
    });
    expect(isPageChatColumnOpen(open)).toBe(true);
    expect(isPageChatColumnOpen(collapsed)).toBe(false);
  });

  it("treats a YouTube chat frame with the collapsed attribute as closed even with a visible box", () => {
    const collapsed = page("www.youtube.com", {
      "ytd-live-chat-frame": element({ collapsed: true }),
    });
    expect(isPageChatColumnOpen(collapsed)).toBe(false);
  });

  it("ignores temporary Twitch column toggles while the adapter is reinitializing collapsed chat", () => {
    const toggledOpen = page("www.twitch.tv", {
      "right-column__toggle-collapse-btn": element({
        label: "Collapse Chat",
      }),
    });
    setTwitchChatReinitializing(true);
    try {
      expect(isPageChatColumnOpen(toggledOpen)).toBe(false);
    } finally {
      setTwitchChatReinitializing(false);
    }
    expect(isPageChatColumnOpen(toggledOpen)).toBe(true);
  });
});
