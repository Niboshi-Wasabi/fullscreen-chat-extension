import {
  POPOUT_CLOSE_TYPE,
  POPOUT_FOCUS_TYPE,
  POPOUT_OPEN_TYPE,
  POPOUT_QUERY_TYPE,
  type PopoutOpenResponse,
  type PopoutQueryResponse,
} from "../../shared/runtime-messages";
import type { PopoutTarget } from "../../shared/site-ids";

/**
 * Popout controller — opens the official site chat in a separate window.
 * 別窓コントローラ。公式サイトのチャットを別ウィンドウで開く。
 */
export interface PopoutController {
  /** Open or retarget, and bring the window forward / 開くか差し替えて前面へ */
  open(): Promise<boolean>;
  /**
   * Take the shared window for this tab without focusing it, even when the URL
   * looks unchanged: another watch tab may have retargeted it meanwhile.
   * このタブで共有窓を取り直す。前面には出さない。別のタブが表示先を変更した可能性が
   * あるので、URL が同じに見えても送る。
   */
  claim(): Promise<boolean>;
  close(): void;
  focus(): void;
  isOpen(): boolean;
  /** Refresh URL only when the watched page target changed / 視聴先が変わったときだけ URL 更新 */
  sync(): void;
}

export interface PopoutControllerOptions {
  resolveTarget?: () => PopoutTarget | null;
}

export function createPopoutController(
  options: PopoutControllerOptions = {},
): PopoutController {
  let openState = false;
  let lastRequestedUrl: string | null = null;
  let inflight: Promise<boolean> | null = null;
  let inflightUrl: string | null = null;
  let inflightFocus = false;
  // Bumped by close() so replies to earlier requests cannot reopen the state.
  // close() で進め、それ以前の要求への応答で開いた状態に戻らないようにする。
  let generation = 0;
  const resolveTarget = options.resolveTarget ?? (() => null);

  const requestOpen = (focus: boolean): Promise<boolean> => {
    const target = resolveTarget();
    if (!target) {
      console.warn("[fce] popout: no official chat URL for this page");
      return Promise.resolve(false);
    }
    // Join a pending request unless it would drop a wanted focus.
    // 送信中の要求に合流する。ただし求めたフォーカスが失われる場合は送り直す。
    if (inflight && inflightUrl === target.url && (inflightFocus || !focus)) {
      return inflight;
    }
    lastRequestedUrl = target.url;
    inflightUrl = target.url;
    inflightFocus = focus;
    const requested = generation;
    let requestPromise: Promise<unknown>;
    try {
      requestPromise = browser.runtime.sendMessage({
        type: POPOUT_OPEN_TYPE,
        url: target.url,
        siteKey: target.siteKey,
        focus,
      });
    } catch (error: unknown) {
      requestPromise = Promise.reject(error);
    }
    const task = requestPromise
      .then((response: unknown) => {
        if (requested !== generation) {
          return false;
        }
        const accepted = isPopoutAccepted(response);
        if (!accepted) {
          if (lastRequestedUrl === target.url) {
            openState = false;
            lastRequestedUrl = null;
          }
          return false;
        }
        openState = true;
        // A newer request for another URL is still the one that counts.
        // 別 URL の新しい要求が送信中なら、そちらを正とする。
        if (inflight === task) {
          lastRequestedUrl = target.url;
        }
        return true;
      })
      .catch((error: unknown) => {
        if (!isExtensionContextInvalidated(error)) {
          console.warn("[fce] popout open failed", error);
        }
        if (requested === generation && lastRequestedUrl === target.url) {
          openState = false;
          lastRequestedUrl = null;
        }
        return false;
      })
      .finally(() => {
        if (inflight === task) {
          inflight = null;
          inflightUrl = null;
          inflightFocus = false;
        }
      });
    inflight = task;
    return task;
  };

  return {
    open() {
      return requestOpen(true);
    },
    claim() {
      return requestOpen(false);
    },
    close() {
      generation++;
      openState = false;
      lastRequestedUrl = null;
      inflight = null;
      inflightUrl = null;
      inflightFocus = false;
      try {
        void browser.runtime
          .sendMessage({ type: POPOUT_CLOSE_TYPE })
          .catch(() => undefined);
      } catch {
        // Extension context may already be invalidated on teardown.
      }
    },
    focus() {
      if (!openState && resolveTarget()) {
        void requestOpen(true);
        return;
      }
      try {
        void browser.runtime
          .sendMessage({ type: POPOUT_FOCUS_TYPE })
          .catch(() => undefined);
      } catch {
        // Extension context may already be invalidated.
      }
    },
    isOpen() {
      // A pending open counts, so a close issued meanwhile is still sent.
      // 送信中の open も開いているとみなし、その間の close を送り漏らさない。
      return openState || inflight !== null;
    },
    sync() {
      if (!openState) {
        return;
      }
      const target = resolveTarget();
      if (!target) {
        return;
      }
      // Skip no-op syncs — avoids reopen storms from settings writes.
      // 設定保存などでの無効な再同期を避け、別窓が何度も開き直されるのを防ぐ。
      if (lastRequestedUrl === target.url) {
        return;
      }
      void requestOpen(false);
    },
  };
}

function isExtensionContextInvalidated(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return false;
  }
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /Extension context invalidated/i.test(message)
  );
}

function isPopoutAccepted(response: unknown): boolean {
  if (typeof response !== "object" || response === null) {
    return false;
  }
  return (response as PopoutOpenResponse).accepted === true;
}

/** Ask background whether a managed popout is open / 管理中の別窓が開いているか */
export async function queryPopoutOpen(): Promise<boolean> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: POPOUT_QUERY_TYPE,
    })) as PopoutQueryResponse | undefined;
    return Boolean(response?.open);
  } catch {
    return false;
  }
}
