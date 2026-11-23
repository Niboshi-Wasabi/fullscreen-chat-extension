import { createBridgeHub } from "../app/bridge-hub";
import {
  isAllowedPopoutUrl,
  isPopoutRuntimeRequest,
  isPopoutSiteKey,
  isTrustedExtensionSender,
  POPOUT_CLOSE_TYPE,
  POPOUT_FOCUS_TYPE,
  POPOUT_OPEN_TYPE,
  POPOUT_QUERY_TYPE,
  type PopoutOpenRequest,
  type PopoutOpenResponse,
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
  ownerTabId?: number;
}

/** Subset of windows.Window used for bounds persistence / 別窓の位置とサイズを保存するための Window の部分型 */
interface WindowBoundsSource {
  id?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  state?: string;
}

type RuntimeSender = {
  id?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number; windowId?: number; url?: string };
};

let managed: ManagedPopout | null = null;
/** Bumped on every explicit state mutation so stale startup restores drop out.
 * 明示的な状態更新ごとに進め、遅れて完了した起動時の復元による上書きを防ぐ。 */
let managedEpoch = 0;
let boundsPersistTimer: ReturnType<typeof setTimeout> | null = null;
/** Serialize open/close so concurrent messages cannot create duplicates.
 * 開閉を直列化し、並行メッセージで窓が二重に作られないようにする。 */
let popoutQueue: Promise<void> = Promise.resolve();

function setManaged(next: ManagedPopout | null): void {
  managed = next;
  managedEpoch++;
}

function clearBoundsPersistTimer(): void {
  if (boundsPersistTimer !== null) {
    globalThis.clearTimeout(boundsPersistTimer);
    boundsPersistTimer = null;
  }
}

export function registerBackgroundHandlers(): () => void {
  setManaged(null);
  clearBoundsPersistTimer();
  popoutQueue = Promise.resolve();
  const stopSettings = registerSettingsPersistence();
  const managedRestore = restoreManagedPopout();
  const bridgeHub = createBridgeHub({
    getPopoutOwnerTabId: async () => {
      await managedRestore;
      return managed?.ownerTabId;
    },
  });
  void bridgeHub.restore();

  const onMessage: Parameters<
    typeof browser.runtime.onMessage.addListener
  >[0] = (message, sender, sendResponse) => {
    const runtimeSender = sender as RuntimeSender;
    if (!isTrustedExtensionSender(runtimeSender)) {
      return undefined;
    }
    if (isPopoutRuntimeRequest(message)) {
      void handlePopoutMessage(message, runtimeSender.tab?.id)
        .then((result) => sendResponse(result))
        .catch((error: unknown) => {
          console.warn("[fce] popout request failed", error);
          sendResponse(undefined);
        });
      // Keep the message channel open for async reply / 非同期で応答できるよう通信チャネルを維持する
      return true;
    }
    if (bridgeHub.handleMessage(message, runtimeSender, sendResponse)) {
      return true;
    }
    return undefined;
  };
  browser.runtime.onMessage.addListener(onMessage);

  const onWindowRemoved = (windowId: number) => {
    void enqueuePopoutTask(() => handlePopoutWindowRemoved(windowId));
  };
  browser.windows?.onRemoved?.addListener(onWindowRemoved);

  const onTabRemoved = (tabId: number) => {
    void enqueuePopoutTask(() => handleOwnerTabRemoved(tabId));
    void bridgeHub.handleTabRemoved(tabId);
  };
  browser.tabs?.onRemoved?.addListener(onTabRemoved);

  // onBoundsChanged is Chromium-only; guard windows itself for safety.
  // onBoundsChanged は Chromium のみ。windows API 自体が利用できるかも確認する。
  const windowsWithBounds = browser.windows as
    | (typeof browser.windows & {
        onBoundsChanged?: {
          addListener: (callback: (window: WindowBoundsSource) => void) => void;
          removeListener?: (
            callback: (window: WindowBoundsSource) => void,
          ) => void;
        };
      })
    | undefined;
  const onBoundsChanged = (window: WindowBoundsSource) => {
    if (!managed || window.id !== managed.windowId) {
      return;
    }
    const siteKey = managed.siteKey;
    clearBoundsPersistTimer();
    boundsPersistTimer = globalThis.setTimeout(() => {
      boundsPersistTimer = null;
      void persistBoundsFromWindow(window, siteKey).catch((error: unknown) => {
        console.warn("[fce] popout bounds save failed", error);
      });
    }, 250);
  };
  windowsWithBounds?.onBoundsChanged?.addListener(onBoundsChanged);

  const onCommand = async (command: string) => {
    await forwardCommandToActiveTab(command);
  };
  browser.commands?.onCommand?.addListener(onCommand);

  return () => {
    stopSettings();
    bridgeHub.dispose();
    clearBoundsPersistTimer();
    browser.runtime.onMessage.removeListener(onMessage);
    browser.windows?.onRemoved?.removeListener(onWindowRemoved);
    browser.tabs?.onRemoved?.removeListener(onTabRemoved);
    windowsWithBounds?.onBoundsChanged?.removeListener?.(onBoundsChanged);
    browser.commands?.onCommand?.removeListener(onCommand);
    setManaged(null);
  };
}

export default defineBackground(() => {
  registerBackgroundHandlers();
});

async function handlePopoutMessage(
  message: PopoutRuntimeRequest,
  senderTabId?: number,
): Promise<PopoutQueryResponse | PopoutOpenResponse | void> {
  if (message.type === POPOUT_QUERY_TYPE) {
    return enqueuePopoutTask(async () => {
      await ensureManagedFresh();
      return {
        open: managed !== null,
        windowId: managed?.windowId ?? null,
        siteKey: managed?.siteKey ?? null,
      };
    });
  }

  if (message.type === POPOUT_OPEN_TYPE) {
    return enqueuePopoutTask(() => openOrFocusPopout(message, senderTabId));
  }

  await enqueuePopoutTask(async () => {
    if (message.type === POPOUT_CLOSE_TYPE) {
      await closeManagedPopout(senderTabId);
      return;
    }
    if (message.type === POPOUT_FOCUS_TYPE) {
      await focusManagedPopout();
    }
  });
}

function enqueuePopoutTask<T>(task: () => Promise<T>): Promise<T> {
  const run = popoutQueue.then(task, task);
  popoutQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function openOrFocusPopout(
  request: PopoutOpenRequest,
  senderTabId?: number,
): Promise<PopoutOpenResponse> {
  // One shared window. Only the watch tab the user is looking at may open or
  // retarget it, so a background YouTube/Twitch tab cannot replace that chat.
  // 別窓は一つ。見ているタブだけが開閉・URL変更でき、バックグラウンドタブは別窓を操作できない。
  if (!(await isForegroundWatchTab(senderTabId))) {
    return { accepted: false };
  }
  // The user just closed it; reopening would undo the switch back to the panel.
  // 利用者が閉じた直後。開き直すとパネルへ戻した操作を打ち消してしまう。
  if (await ensureManagedFresh()) {
    return { accepted: false };
  }
  // Background claims / syncs (`focus: false`) must not reopen after a user
  // close already reset `displayMode` back to `"panel"` before focus landed.
  // 利用者が閉じてパネルに戻った場合は、フォーカスを伴わない同期や再取得の要求で開き直さない。
  if (request.focus === false) {
    const currentSettings = await loadSettings();
    if (currentSettings.displayMode !== "popout") {
      return { accepted: false };
    }
  }
  const nextOwnerTabId = senderTabId ?? managed?.ownerTabId;

  const reclaimed = await findExistingPopoutWindow(request.url);
  if (reclaimed !== null) {
    const previousWindowId =
      managed && managed.windowId !== reclaimed ? managed.windowId : null;
    setManaged({
      windowId: reclaimed,
      siteKey: request.siteKey,
      url: request.url,
      ownerTabId: nextOwnerTabId,
    });
    await persistManagedPopout(managed!);
    if (previousWindowId !== null) {
      try {
        await browser.windows.remove(previousWindowId);
      } catch {
        // Already closed / 既に閉じられている
      }
    }
    if (request.focus) {
      try {
        await browser.windows.update(reclaimed, { focused: true });
      } catch {
        await forgetIfPopoutGone(reclaimed);
        return { accepted: false };
      }
    }
    return { accepted: true };
  }

  if (managed) {
    const managedWindowId = managed.windowId;
    try {
      const existing = await browser.windows.get(managedWindowId, {
        populate: true,
      });
      if (existing.id !== undefined) {
        const tabId = existing.tabs?.[0]?.id;
        if (tabId !== undefined && managed.url !== request.url) {
          await browser.tabs.update(tabId, { url: request.url });
        }
        // Keep user-moved geometry; only URL sync, plus focus when asked.
        // ユーザーが動かした位置は維持し、URL と（求められたら）フォーカスだけ。
        if (request.focus) {
          await browser.windows.update(managed.windowId, { focused: true });
        }
        setManaged({
          windowId: existing.id,
          siteKey: request.siteKey,
          url: request.url,
          ownerTabId: nextOwnerTabId,
        });
        await persistManagedPopout(managed!);
        return { accepted: true };
      }
    } catch {
      await forgetIfPopoutGone(managedWindowId);
      return { accepted: false };
    }
  }

  const bounds = await resolveBounds(request.siteKey);
  const created = await createPopoutWindow(
    request.url,
    bounds,
    request.focus === true,
  );
  const createdId = created?.id;
  if (createdId === undefined) {
    return { accepted: false };
  }
  setManaged({
    windowId: createdId,
    siteKey: request.siteKey,
    url: request.url,
    ownerTabId: nextOwnerTabId,
  });
  await persistManagedPopout(managed!);
  return { accepted: true };
}

/**
 * Create the popup, in the background unless the user asked for it.
 * Ceiling: if a browser rejects `focused: false`, retry without the field and
 * accept its default focus; Firefox behaviour here is not verified yet.
 * 利用者が前面表示を要求しなければ背面で開く。`focused: false` を拒むブラウザでは
 * 指定を外して作り直し、既定のフォーカスを受け入れる。Firefox は未確認。
 */
async function createPopoutWindow(
  url: string,
  bounds: PopoutBounds,
  focused: boolean,
): Promise<{ id?: number } | undefined> {
  const createData = {
    url,
    type: "popup" as const,
    width: bounds.width,
    height: bounds.height,
    left: bounds.left,
    top: bounds.top,
  };
  try {
    return await browser.windows.create({ ...createData, focused });
  } catch (error) {
    if (focused) {
      throw error;
    }
    return browser.windows.create(createData);
  }
}

/** Active tab of the last focused normal window, ignoring the toolbar popup. */
async function isForegroundWatchTab(
  senderTabId: number | undefined,
): Promise<boolean> {
  if (senderTabId === undefined || !browser.windows?.getLastFocused) {
    return false;
  }
  try {
    const focused = await browser.windows.getLastFocused({
      populate: true,
      windowTypes: ["normal"],
    });
    return (
      focused.tabs?.some((tab) => tab.active && tab.id === senderTabId) === true
    );
  } catch {
    return false;
  }
}

async function closeManagedPopout(senderTabId?: number): Promise<void> {
  await ensureManagedFresh();
  if (!managed) {
    return;
  }
  const senderOwnsWindow =
    senderTabId === undefined ||
    senderTabId === managed.ownerTabId ||
    (await isForegroundWatchTab(senderTabId));
  if (!senderOwnsWindow) {
    return;
  }
  const windowId = managed.windowId;
  const siteKey = managed.siteKey;
  clearBoundsPersistTimer();
  setManaged(null);
  await clearManagedPopoutStorage();
  try {
    const window = await browser.windows.get(windowId);
    await persistBoundsFromWindow(window, siteKey);
    await browser.windows.remove(windowId);
  } catch {
    // Already closed / 既に閉じられている
  }
}

async function handleOwnerTabRemoved(tabId: number): Promise<void> {
  if (managed?.ownerTabId !== tabId) {
    return;
  }
  setManaged({ ...managed, ownerTabId: undefined });
  await persistManagedPopout(managed!);
}

/**
 * The user closed the managed popout. Extension-initiated closes clear `managed`
 * before removing the window, so they never reach here. Popout mode would
 * reopen the window on the next sync, so return to the in-page panel.
 * 利用者が別窓を閉じた。拡張側から閉じるときは先に managed を消すので来ない。
 * 別窓モードのままだと次の同期で開き直すため、パネルへ戻す。
 */
async function handlePopoutWindowRemoved(windowId: number): Promise<void> {
  // After a service worker restart only session storage remembers the window.
  // service worker が再起動したあとは session storage にのみ別窓の記録が残る。
  const record = managed ?? (await readStoredManagedPopout());
  if (record?.windowId !== windowId) {
    return;
  }
  await forgetUserClosedPopout();
}

/**
 * A remembered window that no longer exists was closed by the user. Other
 * requests can notice that before `windows.onRemoved` arrives, so every path
 * that finds the window gone must return to the panel, not only the event.
 * 記録した別窓が見つからなければ、利用者が閉じたとみなす。onRemoved より先に別の要求で確認できることが
 * あるので、どの経路で別窓が見つからなくてもパネルに戻す。
 */
async function forgetUserClosedPopout(): Promise<void> {
  clearBoundsPersistTimer();
  setManaged(null);
  await clearManagedPopoutStorage();
  const settings = await loadSettings();
  if (settings.displayMode === "popout") {
    await saveSettings({ displayMode: "panel" });
  }
}

/**
 * A popout call failed. Only a window that is really gone means the user
 * closed it; other failures keep the record so the window stays managed.
 * 別窓の操作が失敗した。別窓が存在しないと確認できたときだけ利用者が閉じたとみなす。
 * それ以外の失敗では記録を残し、窓を管理から外さない。
 */
async function forgetIfPopoutGone(windowId: number): Promise<void> {
  try {
    await browser.windows.get(windowId);
  } catch {
    if (managed?.windowId === windowId) {
      await forgetUserClosedPopout();
    }
  }
}

async function focusManagedPopout(): Promise<void> {
  await ensureManagedFresh();
  if (!managed) {
    return;
  }
  const windowId = managed.windowId;
  try {
    await browser.windows.update(windowId, { focused: true });
    const window = await browser.windows.get(windowId, {
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
    await forgetIfPopoutGone(windowId);
  }
}

/** @returns true when the remembered window turned out to be closed by the user.
 * 記録した窓を利用者が閉じていたら true。 */
async function ensureManagedFresh(): Promise<boolean> {
  if (!managed && (await restoreManagedPopout())) {
    return true;
  }
  if (!managed) {
    return false;
  }
  try {
    await browser.windows.get(managed.windowId);
    return false;
  } catch {
    await forgetUserClosedPopout();
    return true;
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
 * 公式チャット URL が同じ配信を指す場合は同じ別窓として扱う。 */
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
      if (
        !existing.pathname.startsWith("/live_chat") ||
        existing.pathname !== target.pathname
      ) {
        return false;
      }
      const existingV = existing.searchParams.get("v");
      const targetV = target.searchParams.get("v");
      if (existingV || targetV) {
        return Boolean(existingV && existingV === targetV);
      }
      const existingCont = existing.searchParams.get("continuation");
      const targetCont = target.searchParams.get("continuation");
      return Boolean(existingCont && existingCont === targetCont);
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

/** @returns true when the stored window no longer exists.
 * 記録した窓がもう無ければ true。 */
async function restoreManagedPopout(): Promise<boolean> {
  const startedEpoch = managedEpoch;
  const record = await readStoredManagedPopout();
  if (!record || managedEpoch !== startedEpoch) {
    return false;
  }
  try {
    await browser.windows.get(record.windowId);
    if (managedEpoch !== startedEpoch) {
      return false;
    }
    setManaged(record);
    return false;
  } catch {
    if (managedEpoch !== startedEpoch) {
      return false;
    }
    await forgetUserClosedPopout();
    return true;
  }
}

/** Validated session record, without checking that the window still exists.
 * 検証済みのセッション記録を取得する。別窓が開いているかは確認しない。 */
async function readStoredManagedPopout(): Promise<ManagedPopout | null> {
  try {
    const stored = await browser.storage.session.get(
      MANAGED_POPOUT_STORAGE_KEY,
    );
    const raw = stored[MANAGED_POPOUT_STORAGE_KEY];
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const record = raw as ManagedPopout;
    if (
      typeof record.windowId !== "number" ||
      typeof record.url !== "string" ||
      !isPopoutSiteKey(record.siteKey) ||
      !isAllowedPopoutUrl(record.url, record.siteKey) ||
      (record.ownerTabId !== undefined && !Number.isInteger(record.ownerTabId))
    ) {
      return null;
    }
    return record;
  } catch {
    return null;
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
    window.state === "minimized" ||
    window.left === undefined ||
    window.top === undefined ||
    window.width === undefined ||
    window.height === undefined ||
    window.left <= -30000 ||
    window.top <= -30000
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
    left: Math.min(1_000_000, Math.max(-1_000_000, Math.round(bounds.left))),
    top: Math.min(1_000_000, Math.max(-1_000_000, Math.round(bounds.top))),
    width: Math.min(32_768, Math.max(280, Math.round(bounds.width))),
    height: Math.min(32_768, Math.max(360, Math.round(bounds.height))),
  };
}

async function forwardCommandToActiveTab(command: string): Promise<void> {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  const activeTab = tabs[0];
  const tabId = activeTab?.id;
  if (tabId === undefined) {
    return;
  }
  // A restarted service worker only knows the popout from session storage.
  // service worker 再起動後は session storage にしか別窓の記録が無い。
  await enqueuePopoutTask(ensureManagedFresh);
  // When the managed popout is focused, keep compose focus inside it and route
  // page-level commands back to the owner watch tab.
  const targetTabId =
    command !== "toggle-compose-focus" &&
    managed &&
    activeTab?.windowId === managed.windowId &&
    managed.ownerTabId !== undefined
      ? managed.ownerTabId
      : tabId;
  try {
    await browser.tabs.sendMessage(targetTabId, {
      type: "fce:command",
      command,
    });
  } catch {
    // Tab may not have a content script / content script 未注入のタブ
  }
}
