import {
  isPopoutRuntimeRequest,
  POPOUT_CLOSE_TYPE,
  POPOUT_FOCUS_TYPE,
  POPOUT_OPEN_TYPE,
  POPOUT_QUERY_TYPE,
  type PopoutOpenRequest,
  type PopoutQueryResponse,
  type PopoutRuntimeRequest,
} from "../shared/runtime-messages";
import {
  registerSettingsPersistence,
  loadSettings,
  saveSettings,
  type PopoutBounds,
} from "../shared/settings";
import { DEFAULT_POPOUT_BOUNDS, type PopoutSiteKey } from "../shared/site-ids";

const MANAGED_POPOUT_STORAGE_KEY = "fceManagedPopout";

interface ManagedPopout {
  windowId: number;
  siteKey: PopoutSiteKey;
  url: string;
}

/** Subset of windows.Window used for bounds persistence / bounds 保存に使う Window 部分型 */
interface WindowBoundsSource {
  id?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

let managed: ManagedPopout | null = null;
/** Serialize open/close so concurrent messages cannot create duplicates.
 * 開閉を直列化し、並行メッセージで窓が二重に作られないようにする。 */
let popoutQueue: Promise<void> = Promise.resolve();

export default defineBackground(() => {
  registerSettingsPersistence();
  void restoreManagedPopout();

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isPopoutRuntimeRequest(message)) {
      void handlePopoutMessage(message).then((result) => {
        if (result !== undefined) {
          sendResponse(result);
        }
      });
      // Keep the message channel open for async reply / 非同期応答のためチャネル維持
      return true;
    }
    return undefined;
  });

  browser.windows?.onRemoved.addListener((windowId) => {
    if (managed?.windowId === windowId) {
      managed = null;
      void clearManagedPopoutStorage();
    }
  });

  // onBoundsChanged is Chromium-only; guard windows itself for safety.
  // onBoundsChanged は Chromium のみ。windows 本体もガードする。
  const windowsWithBounds = browser.windows as
    | (typeof browser.windows & {
        onBoundsChanged?: {
          addListener: (callback: (window: WindowBoundsSource) => void) => void;
        };
      })
    | undefined;
  windowsWithBounds?.onBoundsChanged?.addListener((window) => {
    if (!managed || window.id !== managed.windowId) {
      return;
    }
    void persistBoundsFromWindow(window, managed.siteKey);
  });

  browser.commands.onCommand.addListener(async (command) => {
    await forwardCommandToActiveTab(command);
  });
});

async function handlePopoutMessage(
  message: PopoutRuntimeRequest,
): Promise<PopoutQueryResponse | void> {
  if (message.type === POPOUT_QUERY_TYPE) {
    await ensureManagedFresh();
    return {
      open: managed !== null,
      windowId: managed?.windowId ?? null,
      siteKey: managed?.siteKey ?? null,
    };
  }

  await enqueuePopoutTask(async () => {
    if (message.type === POPOUT_CLOSE_TYPE) {
      await closeManagedPopout();
      return;
    }
    if (message.type === POPOUT_FOCUS_TYPE) {
      await focusManagedPopout();
      return;
    }
    if (message.type === POPOUT_OPEN_TYPE) {
      await openOrFocusPopout(message);
    }
  });
}

function enqueuePopoutTask(task: () => Promise<void>): Promise<void> {
  const run = popoutQueue.then(task, task);
  popoutQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function openOrFocusPopout(request: PopoutOpenRequest): Promise<void> {
  await ensureManagedFresh();

  const reclaimed = await findExistingPopoutWindow(request.url);
  if (reclaimed !== null) {
    managed = {
      windowId: reclaimed,
      siteKey: request.siteKey,
      url: request.url,
    };
    await persistManagedPopout(managed);
    await browser.windows.update(reclaimed, { focused: true });
    return;
  }

  if (managed) {
    try {
      const existing = await browser.windows.get(managed.windowId, {
        populate: true,
      });
      if (existing.id !== undefined) {
        const tabId = existing.tabs?.[0]?.id;
        if (tabId !== undefined && managed.url !== request.url) {
          await browser.tabs.update(tabId, { url: request.url });
        }
        // Keep user-moved geometry; only focus + URL sync.
        // ユーザーが動かした位置は維持し、フォーカスと URL だけ合わせる。
        await browser.windows.update(managed.windowId, { focused: true });
        managed = {
          windowId: existing.id,
          siteKey: request.siteKey,
          url: request.url,
        };
        await persistManagedPopout(managed);
        return;
      }
    } catch {
      managed = null;
      await clearManagedPopoutStorage();
    }
  }

  const bounds = await resolveBounds(request.siteKey);
  const created = await browser.windows.create({
    url: request.url,
    type: "popup",
    focused: true,
    width: bounds.width,
    height: bounds.height,
    left: bounds.left,
    top: bounds.top,
  });
  const createdId = created?.id;
  if (createdId === undefined) {
    return;
  }
  managed = {
    windowId: createdId,
    siteKey: request.siteKey,
    url: request.url,
  };
  await persistManagedPopout(managed);
}

async function closeManagedPopout(): Promise<void> {
  await ensureManagedFresh();
  if (!managed) {
    return;
  }
  const windowId = managed.windowId;
  const siteKey = managed.siteKey;
  managed = null;
  await clearManagedPopoutStorage();
  try {
    const window = await browser.windows.get(windowId);
    await persistBoundsFromWindow(window, siteKey);
    await browser.windows.remove(windowId);
  } catch {
    // Already closed / 既に閉じられている
  }
}

async function focusManagedPopout(): Promise<void> {
  await ensureManagedFresh();
  if (!managed) {
    return;
  }
  try {
    await browser.windows.update(managed.windowId, { focused: true });
    const window = await browser.windows.get(managed.windowId, {
      populate: true,
    });
    const tabId = window.tabs?.[0]?.id;
    if (tabId !== undefined)
      await browser.tabs
        .sendMessage(tabId, {
          type: "fce:command",
          command: "toggle-compose-focus",
        })
        .catch(() => undefined);
  } catch {
    managed = null;
    await clearManagedPopoutStorage();
  }
}

async function ensureManagedFresh(): Promise<void> {
  if (!managed) {
    await restoreManagedPopout();
  }
  if (!managed) {
    return;
  }
  try {
    await browser.windows.get(managed.windowId);
  } catch {
    managed = null;
    await clearManagedPopoutStorage();
  }
}

async function findExistingPopoutWindow(url: string): Promise<number | null> {
  const windows = await browser.windows.getAll({
    populate: true,
    windowTypes: ["popup"],
  });
  for (const window of windows) {
    if (window.id === undefined) {
      continue;
    }
    const tabUrl = window.tabs?.[0]?.url ?? "";
    if (isSamePopoutChat(tabUrl, url)) {
      return window.id;
    }
  }
  return null;
}

/** Treat equivalent official chat URLs as the same window target.
 * 公式チャット URL が実質同じなら同一窓とみなす。 */
function isSamePopoutChat(existingUrl: string, targetUrl: string): boolean {
  if (!existingUrl || !targetUrl) {
    return false;
  }
  try {
    const existing = new URL(existingUrl);
    const target = new URL(targetUrl);
    if (existing.hostname !== target.hostname) {
      return false;
    }
    if (existing.hostname.includes("youtube.com")) {
      return (
        existing.pathname.startsWith("/live_chat") &&
        target.pathname.startsWith("/live_chat") &&
        existing.searchParams.get("v") === target.searchParams.get("v")
      );
    }
    if (existing.hostname.includes("twitch.tv")) {
      return (
        /\/popout\/[^/]+\/chat/i.test(existing.pathname) &&
        existing.pathname.toLowerCase() === target.pathname.toLowerCase()
      );
    }
    return (
      existingHrefWithoutHash(existing) === existingHrefWithoutHash(target)
    );
  } catch {
    return existingUrl === targetUrl;
  }
}

function existingHrefWithoutHash(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}`;
}

async function restoreManagedPopout(): Promise<void> {
  try {
    const stored = await browser.storage.session.get(
      MANAGED_POPOUT_STORAGE_KEY,
    );
    const raw = stored[MANAGED_POPOUT_STORAGE_KEY];
    if (!raw || typeof raw !== "object") {
      return;
    }
    const record = raw as ManagedPopout;
    if (
      typeof record.windowId !== "number" ||
      typeof record.url !== "string" ||
      (record.siteKey !== "youtube" && record.siteKey !== "twitch")
    ) {
      return;
    }
    await browser.windows.get(record.windowId);
    managed = record;
  } catch {
    managed = null;
    await clearManagedPopoutStorage();
  }
}

async function persistManagedPopout(next: ManagedPopout): Promise<void> {
  try {
    await browser.storage.session.set({
      [MANAGED_POPOUT_STORAGE_KEY]: next,
    });
  } catch {
    // session storage may be unavailable in rare hosts / 稀に session が使えない
  }
}

async function clearManagedPopoutStorage(): Promise<void> {
  try {
    await browser.storage.session.remove(MANAGED_POPOUT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function resolveBounds(siteKey: PopoutSiteKey): Promise<PopoutBounds> {
  const settings = await loadSettings();
  if (settings.popout.rememberPerSite) {
    const perSite = settings.popout.boundsBySite?.[siteKey];
    if (perSite) {
      return sanitizeBounds(perSite);
    }
  }
  if (settings.popout.bounds) {
    return sanitizeBounds(settings.popout.bounds);
  }
  return {
    left: 100,
    top: 80,
    width: DEFAULT_POPOUT_BOUNDS.width,
    height: DEFAULT_POPOUT_BOUNDS.height,
  };
}

async function persistBoundsFromWindow(
  window: WindowBoundsSource,
  siteKey: PopoutSiteKey,
): Promise<void> {
  if (
    window.left === undefined ||
    window.top === undefined ||
    window.width === undefined ||
    window.height === undefined
  ) {
    return;
  }
  const bounds = sanitizeBounds({
    left: window.left,
    top: window.top,
    width: window.width,
    height: window.height,
  });
  const settings = await loadSettings();
  const previous = settings.popout.rememberPerSite
    ? settings.popout.boundsBySite?.[siteKey]
    : settings.popout.bounds;
  if (
    previous &&
    previous.left === bounds.left &&
    previous.top === bounds.top &&
    previous.width === bounds.width &&
    previous.height === bounds.height
  ) {
    return;
  }
  if (settings.popout.rememberPerSite) {
    await saveSettings({
      popout: {
        bounds,
        boundsBySite: {
          [siteKey]: bounds,
        },
      },
    });
    return;
  }
  await saveSettings({
    popout: {
      bounds,
    },
  });
}

function sanitizeBounds(bounds: PopoutBounds): PopoutBounds {
  return {
    left: Math.round(bounds.left),
    top: Math.round(bounds.top),
    width: Math.max(280, Math.round(bounds.width)),
    height: Math.max(360, Math.round(bounds.height)),
  };
}

async function forwardCommandToActiveTab(command: string): Promise<void> {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  const tabId = tabs[0]?.id;
  if (tabId === undefined) {
    return;
  }
  try {
    await browser.tabs.sendMessage(tabId, {
      type: "fce:command",
      command,
    });
  } catch {
    // Tab may not have a content script / content script 未注入のタブ
  }
}
