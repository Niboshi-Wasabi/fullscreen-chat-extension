import {
  COMMENTS_PORTAL_PLACEHOLDER_ID,
  NATIVE_COMMENTS_PORTAL_ID,
} from "../shared/dom-ids";

const FIND_RETRY_MS = 400;
const FIND_RETRY_MAX = 20;

export type YouTubeCommentsPortal = {
  /** Attach comments into the panel host when found / 見つかればパネルへ載せる */
  sync(enabled: boolean): void;
  /** True while a comments node is reparented / ポータル中か */
  isAttached(): boolean;
  dispose(): void;
};

/**
 * Reparents page `ytd-comments` into the overlay portal host (ISS-026).
 * ページの通常コメント節をパネル内ホストへ再配置する。
 */
export function createYouTubeCommentsPortal(options: {
  resolveHost: () => HTMLElement | null;
  /** Called when enabled but comments root never appears / ノード未出現時 */
  onUnavailable?: () => void;
}): YouTubeCommentsPortal {
  let attachedNode: HTMLElement | null = null;
  let homeParent: Node | null = null;
  let homeNext: ChildNode | null = null;
  let placeholder: HTMLElement | null = null;
  let retryTimer: number | null = null;
  let retryCount = 0;
  let pageObserver: MutationObserver | null = null;
  let wantAttached = false;
  let disposed = false;

  return {
    sync(enabled) {
      if (disposed) {
        return;
      }
      wantAttached = enabled;
      clearRetry();
      if (!enabled) {
        stopPageObserver();
        detachInternal();
        return;
      }
      tryAttachOrSchedule();
      ensurePageObserver();
    },
    isAttached() {
      return Boolean(attachedNode?.isConnected);
    },
    dispose() {
      disposed = true;
      wantAttached = false;
      clearRetry();
      stopPageObserver();
      detachInternal();
    },
  };

  function tryAttachOrSchedule(): void {
    if (disposed || !wantAttached) {
      return;
    }
    const host = options.resolveHost();
    if (!host) {
      scheduleRetry();
      return;
    }
    // Already holding a live node inside the host.
    // 既にホスト内へ載せたノードが生きていれば完了。
    if (attachedNode?.isConnected && attachedNode.parentElement === host) {
      return;
    }
    // SPA regenerated the section while we still show a placeholder.
    // プレースホルダ残存中に YouTube が節を再生成したら拾い直す。
    if (attachedNode && !attachedNode.isConnected) {
      attachedNode = null;
      homeParent = null;
      homeNext = null;
    }
    const root = findYouTubeCommentsRoot();
    if (!root) {
      scheduleRetry();
      return;
    }
    if (root === attachedNode && root.parentElement === host) {
      clearRetry();
      return;
    }
    attachInternal(root, host);
    clearRetry();
  }

  function scheduleRetry(): void {
    if (disposed || !wantAttached || retryTimer !== null) {
      return;
    }
    if (retryCount >= FIND_RETRY_MAX) {
      options.onUnavailable?.();
      return;
    }
    retryCount += 1;
    retryTimer = globalThis.setTimeout(() => {
      retryTimer = null;
      tryAttachOrSchedule();
    }, FIND_RETRY_MS) as unknown as number;
  }

  function clearRetry(): void {
    if (retryTimer !== null) {
      globalThis.clearTimeout(retryTimer);
      retryTimer = null;
    }
    retryCount = 0;
  }

  function ensurePageObserver(): void {
    if (pageObserver || disposed) {
      return;
    }
    pageObserver = new MutationObserver(() => {
      if (!wantAttached || disposed) {
        return;
      }
      // Host may remount; comments may regenerate after navigation.
      // ホスト再マウントやナビ後の再生成に追従する。
      if (!attachedNode?.isConnected || !options.resolveHost()) {
        tryAttachOrSchedule();
      }
    });
    pageObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function stopPageObserver(): void {
    pageObserver?.disconnect();
    pageObserver = null;
  }

  function attachInternal(node: HTMLElement, host: HTMLElement): void {
    if (attachedNode && attachedNode !== node) {
      detachInternal();
    }
    if (node.parentElement === host) {
      attachedNode = node;
      return;
    }
    homeParent = node.parentNode;
    homeNext = node.nextSibling;
    placeholder = ensurePlaceholder(node);
    if (homeParent && placeholder.parentNode !== homeParent) {
      homeParent.insertBefore(placeholder, homeNext);
    }
    host.replaceChildren();
    host.appendChild(node);
    attachedNode = node;
  }

  function detachInternal(): void {
    const node = attachedNode;
    const parent = homeParent;
    const next = homeNext;
    const slot = placeholder;
    attachedNode = null;
    homeParent = null;
    homeNext = null;
    placeholder = null;

    if (node?.isConnected) {
      if (parent?.isConnected) {
        try {
          parent.insertBefore(
            node,
            next && next.parentNode === parent ? next : null,
          );
        } catch {
          parent.appendChild(node);
        }
      } else if (slot?.parentNode) {
        slot.parentNode.insertBefore(node, slot);
      }
    }
    slot?.remove();
    const host = document.getElementById(NATIVE_COMMENTS_PORTAL_ID);
    if (host && (!node || node.parentElement !== host)) {
      host.replaceChildren();
    }
  }
}

/** Locate the main comments section on a watch page / 視聴ページのコメント節 */
export function findYouTubeCommentsRoot(
  doc: ParentNode = document,
): HTMLElement | null {
  const candidates = [
    doc.querySelector<HTMLElement>("ytd-comments#comments"),
    doc.querySelector<HTMLElement>("#comments.ytd-watch-flexy"),
    doc.querySelector<HTMLElement>("ytd-comments"),
    doc.querySelector<HTMLElement>("#comments"),
  ];
  for (const node of candidates) {
    if (!node) {
      continue;
    }
    // Never treat our own portal/placeholder as the source.
    // 自前ポータル／穴埋めをソースにしない。
    if (
      node.id === NATIVE_COMMENTS_PORTAL_ID ||
      node.id === COMMENTS_PORTAL_PLACEHOLDER_ID
    ) {
      continue;
    }
    if (node.closest(`#${NATIVE_COMMENTS_PORTAL_ID}`)) {
      continue;
    }
    return node;
  }
  return null;
}

/** True while comments are parked in the panel / パネルへポータル中か */
export function isYouTubeCommentsPortaled(doc: Document = document): boolean {
  return Boolean(doc.getElementById(COMMENTS_PORTAL_PLACEHOLDER_ID));
}

function ensurePlaceholder(source: HTMLElement): HTMLElement {
  const existing = document.getElementById(COMMENTS_PORTAL_PLACEHOLDER_ID);
  if (existing) {
    return existing;
  }
  const slot = document.createElement("div");
  slot.id = COMMENTS_PORTAL_PLACEHOLDER_ID;
  slot.setAttribute("data-fce", "comments-portal-placeholder");
  slot.setAttribute("aria-hidden", "true");
  // Keep approximate height so the page layout does not jump.
  // ページ側の高さ穴をある程度残してジャンプを抑える。
  const height = Math.max(source.getBoundingClientRect().height, 1);
  slot.style.cssText = `display:block;width:100%;min-height:${Math.round(height)}px;pointer-events:none;`;
  return slot;
}
