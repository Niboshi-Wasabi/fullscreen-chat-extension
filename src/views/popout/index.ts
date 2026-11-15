import {
  POPOUT_CLOSE_TYPE,
  POPOUT_FOCUS_TYPE,
  POPOUT_OPEN_TYPE,
  POPOUT_QUERY_TYPE,
  type PopoutQueryResponse,
} from "../../shared/runtime-messages";
import type { PopoutTarget } from "../../shared/site-ids";

/**
 * Popout controller — opens the official site chat in a separate window.
 * 別窓コントローラ。公式サイトのチャットを別ウィンドウで開く。
 */
export interface PopoutController {
  open(): void;
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
  let inflight: Promise<void> | null = null;
  const resolveTarget = options.resolveTarget ?? (() => null);

  const requestOpen = (force: boolean) => {
    const target = resolveTarget();
    if (!target) {
      console.warn("[fce] popout: no official chat URL for this page");
      return;
    }
    if (
      !force &&
      openState &&
      lastRequestedUrl === target.url &&
      inflight === null
    ) {
      return;
    }
    openState = true;
    lastRequestedUrl = target.url;
    const task = browser.runtime
      .sendMessage({
        type: POPOUT_OPEN_TYPE,
        url: target.url,
        siteKey: target.siteKey,
      })
      .then(() => undefined)
      .catch((error: unknown) => {
        openState = false;
        lastRequestedUrl = null;
        console.warn("[fce] popout open failed", error);
      })
      .finally(() => {
        if (inflight === task) {
          inflight = null;
        }
      });
    inflight = task;
  };

  return {
    open() {
      requestOpen(true);
    },
    close() {
      openState = false;
      lastRequestedUrl = null;
      void browser.runtime
        .sendMessage({ type: POPOUT_CLOSE_TYPE })
        .catch(() => undefined);
    },
    focus() {
      if (!openState && resolveTarget()) {
        requestOpen(true);
        return;
      }
      void browser.runtime
        .sendMessage({ type: POPOUT_FOCUS_TYPE })
        .catch(() => undefined);
    },
    isOpen() {
      return openState;
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
      // 設定保存などでの無効な再同期を避け、再オープン嵐を防ぐ。
      if (lastRequestedUrl === target.url) {
        return;
      }
      requestOpen(true);
    },
  };
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
