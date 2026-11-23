import type { SiteKind } from "../core/message";
import {
  BRIDGE_DELIVER_BATCH_TYPE,
  BRIDGE_DEMAND_TYPE,
  BRIDGE_LIST_SOURCES_TYPE,
  BRIDGE_POPOUT_UPDATE_TYPE,
  BRIDGE_PUSH_BATCH_TYPE,
  BRIDGE_REGISTER_TYPE,
  BRIDGE_SOURCE_STATUS_TYPE,
  BRIDGE_SUBSCRIBE_TYPE,
  BRIDGE_UNREGISTER_TYPE,
  BRIDGE_UNSUBSCRIBE_TYPE,
  isBridgePopoutSubscribeRequest,
  isBridgePopoutSyncRequest,
  isBridgeRuntimeRequest,
  isBridgeSiteKind,
  isBridgeSourceSummary,
  isTrustedBridgePopoutSender,
  resolveTrustedBridgeSenderSite,
  sanitizeBridgeMessage,
  sanitizeBridgePopoutSnapshot,
  type BridgeContentEvent,
  type BridgeListSourcesResponse,
  type BridgePopoutSnapshot,
  type BridgePopoutSubscribeResponse,
  type BridgePopoutUpdateEvent,
  type BridgeSenderInfo,
  type BridgeSourceSummary,
  type BridgeSubscribeResponse,
} from "../shared/bridge-messages";

const BRIDGE_HUB_STORAGE_KEY = "fceBridgeHubState";

interface StoredBridgeHubState {
  sources: BridgeSourceSummary[];
  subscriptions: Array<[number, number]>;
  popoutViewers?: Array<[number, SiteKind]>;
}

export interface BridgeHubOptions {
  getPopoutOwnerTabId?: () => number | undefined | Promise<number | undefined>;
}

export interface BridgeHub {
  restore(): Promise<void>;
  handleMessage(
    message: unknown,
    sender: BridgeSenderInfo | undefined,
    sendResponse: (reply?: unknown) => void,
  ): boolean;
  handleTabRemoved(tabId: number): Promise<void>;
  dispose(): void;
}

/**
 * Background hub coordinating bidirectional live chat sources and subscribers.
 * バックグラウンド中継ハブ。YouTube と Twitch の間で双方向にライブチャットを中継し、混合チャット用の別窓を同期する。
 */
export function createBridgeHub(options: BridgeHubOptions = {}): BridgeHub {
  const sources = new Map<number, BridgeSourceSummary>();
  const subscribersBySource = new Map<number, Set<number>>();
  const sourceBySubscriber = new Map<number, number>();
  const popoutSnapshotsByTab = new Map<number, BridgePopoutSnapshot>();
  const latestPopoutTabBySite = new Map<SiteKind, number>();
  const popoutViewerTabs = new Map<number, SiteKind>();
  let restored = false;
  let disposed = false;
  let queue: Promise<void> = Promise.resolve();

  function enqueueTask<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function ensureRestored(): Promise<void> {
    if (restored || disposed) {
      return;
    }
    restored = true;
    try {
      const stored = await browser.storage.session.get(BRIDGE_HUB_STORAGE_KEY);
      const raw = stored[BRIDGE_HUB_STORAGE_KEY] as
        Partial<StoredBridgeHubState> | undefined;
      if (raw && typeof raw === "object") {
        if (Array.isArray(raw.sources)) {
          for (const candidate of raw.sources) {
            if (isBridgeSourceSummary(candidate)) {
              sources.set(candidate.tabId, candidate);
            }
          }
        }
        if (Array.isArray(raw.subscriptions)) {
          for (const pair of raw.subscriptions) {
            if (!Array.isArray(pair) || pair.length !== 2) {
              continue;
            }
            const [subscriberTabId, sourceTabId] = pair;
            if (
              Number.isInteger(subscriberTabId) &&
              subscriberTabId >= 0 &&
              Number.isInteger(sourceTabId) &&
              sourceTabId >= 0 &&
              subscriberTabId !== sourceTabId &&
              sources.has(sourceTabId)
            ) {
              bindSubscriber(subscriberTabId, sourceTabId);
            }
          }
        }
        if (Array.isArray(raw.popoutViewers)) {
          for (const pair of raw.popoutViewers) {
            if (!Array.isArray(pair) || pair.length !== 2) {
              continue;
            }
            const [viewerTabId, viewerSite] = pair;
            if (
              typeof viewerTabId === "number" &&
              Number.isInteger(viewerTabId) &&
              viewerTabId >= 0 &&
              isBridgeSiteKind(viewerSite)
            ) {
              popoutViewerTabs.set(viewerTabId, viewerSite);
            }
          }
        }
      }
    } catch {
      // session storage unavailable in rare hosts
    }
  }

  async function persistState(): Promise<boolean> {
    if (disposed) {
      return false;
    }
    const payload: StoredBridgeHubState = {
      sources: Array.from(sources.values()),
      subscriptions: Array.from(sourceBySubscriber.entries()),
      popoutViewers: Array.from(popoutViewerTabs.entries()),
    };
    try {
      await browser.storage.session.set({
        [BRIDGE_HUB_STORAGE_KEY]: payload,
      });
      return true;
    } catch {
      // ignore storage errors when session storage is unavailable
      return false;
    }
  }

  function bindSubscriber(subscriberTabId: number, sourceTabId: number): void {
    sourceBySubscriber.set(subscriberTabId, sourceTabId);
    let set = subscribersBySource.get(sourceTabId);
    if (!set) {
      set = new Set<number>();
      subscribersBySource.set(sourceTabId, set);
    }
    set.add(subscriberTabId);
  }

  function unbindSubscriber(subscriberTabId: number): number | null {
    const previousSourceTabId = sourceBySubscriber.get(subscriberTabId);
    if (previousSourceTabId === undefined) {
      return null;
    }
    sourceBySubscriber.delete(subscriberTabId);
    const set = subscribersBySource.get(previousSourceTabId);
    if (set) {
      set.delete(subscriberTabId);
      if (set.size === 0) {
        subscribersBySource.delete(previousSourceTabId);
      }
    }
    return previousSourceTabId;
  }

  async function sendToTab(
    tabId: number,
    payload: BridgeContentEvent | BridgePopoutUpdateEvent,
  ): Promise<boolean> {
    if (disposed || !browser.tabs?.sendMessage) {
      return false;
    }
    try {
      await browser.tabs.sendMessage(tabId, payload);
      return true;
    } catch {
      return false;
    }
  }

  async function notifyDemand(sourceTabId: number): Promise<boolean> {
    const activeSubscribers = subscribersBySource.get(sourceTabId)?.size ?? 0;
    return sendToTab(sourceTabId, {
      type: BRIDGE_DEMAND_TYPE,
      activeSubscribers,
    });
  }

  async function broadcastPopoutSnapshot(
    site: SiteKind,
    snapshot: BridgePopoutSnapshot | null,
  ): Promise<void> {
    let pruned = false;
    for (const [viewerTabId, viewerSite] of Array.from(
      popoutViewerTabs.entries(),
    )) {
      if (viewerSite !== site) {
        continue;
      }
      const delivered = await sendToTab(viewerTabId, {
        type: BRIDGE_POPOUT_UPDATE_TYPE,
        snapshot,
      });
      if (!delivered) {
        popoutViewerTabs.delete(viewerTabId);
        pruned = true;
      }
    }
    if (pruned) {
      await persistState();
    }
  }

  async function resolveSnapshotForSite(
    site: SiteKind,
  ): Promise<BridgePopoutSnapshot | null> {
    const ownerTabId = await options.getPopoutOwnerTabId?.();
    const ownerSnapshot =
      ownerTabId !== undefined
        ? popoutSnapshotsByTab.get(ownerTabId)
        : undefined;
    const preferredTabId =
      ownerSnapshot?.localSite === site
        ? ownerTabId
        : latestPopoutTabBySite.get(site);
    if (preferredTabId === undefined) {
      return null;
    }
    return popoutSnapshotsByTab.get(preferredTabId) ?? null;
  }

  async function removeDeadSource(
    sourceTabId: number,
    status: "closed" | "channel-changed",
    nextChannelLogin?: string,
  ): Promise<boolean> {
    const existed = sources.delete(sourceTabId);
    const subscribers = Array.from(subscribersBySource.get(sourceTabId) ?? []);
    subscribersBySource.delete(sourceTabId);
    for (const subscriberTabId of subscribers) {
      sourceBySubscriber.delete(subscriberTabId);
    }
    if (subscribers.length > 0) {
      await Promise.all(
        subscribers.map((subscriberTabId) =>
          sendToTab(subscriberTabId, {
            type: BRIDGE_SOURCE_STATUS_TYPE,
            sourceTabId,
            status,
            ...(nextChannelLogin !== undefined
              ? { channelLogin: nextChannelLogin }
              : {}),
          }),
        ),
      );
    }
    return existed || subscribers.length > 0;
  }

  function defaultLabelForSource(site: SiteKind, key: string): string {
    return site === "twitch" ? `#${key}` : `YouTube (${key})`;
  }

  return {
    restore() {
      return enqueueTask(() => ensureRestored());
    },

    handleMessage(message, sender, sendResponse) {
      if (disposed) {
        return false;
      }

      if (isBridgePopoutSyncRequest(message)) {
        const senderSite = resolveTrustedBridgeSenderSite(sender);
        const senderTabId = sender?.tab?.id;
        if (
          !senderSite ||
          typeof senderTabId !== "number" ||
          senderSite !== message.snapshot.localSite
        ) {
          return false;
        }
        const sanitized = sanitizeBridgePopoutSnapshot(message.snapshot);
        void enqueueTask(async () => {
          await ensureRestored();
          if (disposed) {
            return undefined;
          }
          popoutSnapshotsByTab.set(senderTabId, sanitized);
          latestPopoutTabBySite.set(senderSite, senderTabId);
          const ownerTabId = await options.getPopoutOwnerTabId?.();
          if (ownerTabId === undefined || ownerTabId === senderTabId) {
            await broadcastPopoutSnapshot(senderSite, sanitized);
          }
          return { ok: true };
        })
          .then((result) => sendResponse(result))
          .catch((error: unknown) => {
            console.warn("[fce] bridge popout sync failed", error);
            sendResponse(undefined);
          });
        return true;
      }

      if (isBridgePopoutSubscribeRequest(message)) {
        if (!isTrustedBridgePopoutSender(sender)) {
          return false;
        }
        const viewerTabId = sender.tab.id;
        void enqueueTask(async () => {
          await ensureRestored();
          if (disposed) {
            return undefined;
          }
          const previousSite = popoutViewerTabs.get(viewerTabId);
          popoutViewerTabs.set(viewerTabId, message.site);
          if (previousSite !== message.site) {
            await persistState();
          }
          const response: BridgePopoutSubscribeResponse = {
            snapshot: await resolveSnapshotForSite(message.site),
          };
          return response;
        })
          .then((result) => sendResponse(result))
          .catch((error: unknown) => {
            console.warn("[fce] bridge popout subscribe failed", error);
            sendResponse(undefined);
          });
        return true;
      }

      if (!isBridgeRuntimeRequest(message)) {
        return false;
      }

      const senderSite = resolveTrustedBridgeSenderSite(sender);
      const senderTabId = sender?.tab?.id;
      if (!senderSite || typeof senderTabId !== "number") {
        return false;
      }

      if (
        message.type === BRIDGE_REGISTER_TYPE ||
        message.type === BRIDGE_UNREGISTER_TYPE ||
        message.type === BRIDGE_PUSH_BATCH_TYPE
      ) {
        if (
          (message.type === BRIDGE_REGISTER_TYPE ||
            message.type === BRIDGE_PUSH_BATCH_TYPE) &&
          message.site !== senderSite
        ) {
          return false;
        }
        const sourceTabId = senderTabId;
        void enqueueTask(async () => {
          await ensureRestored();
          if (disposed) {
            return undefined;
          }
          if (message.type === BRIDGE_REGISTER_TYPE) {
            const existing = sources.get(sourceTabId);
            if (
              existing &&
              (existing.channelLogin !== message.channelLogin ||
                existing.site !== message.site)
            ) {
              await removeDeadSource(
                sourceTabId,
                "channel-changed",
                message.channelLogin,
              );
            }
            const nextSource: BridgeSourceSummary = {
              tabId: sourceTabId,
              site: message.site,
              channelLogin: message.channelLogin,
              label:
                message.label?.trim() ||
                defaultLabelForSource(message.site, message.channelLogin),
            };
            sources.set(sourceTabId, nextSource);
            await persistState();
            await notifyDemand(sourceTabId);
            return { ok: true };
          }
          if (message.type === BRIDGE_UNREGISTER_TYPE) {
            const changed = await removeDeadSource(sourceTabId, "closed");
            if (changed) {
              await persistState();
            }
            return { ok: true };
          }
          // BRIDGE_PUSH_BATCH_TYPE
          const source = sources.get(sourceTabId);
          if (
            !source ||
            source.site !== senderSite ||
            source.channelLogin !== message.channelLogin
          ) {
            return { ok: false };
          }
          const subscribers = subscribersBySource.get(sourceTabId);
          if (!subscribers || subscribers.size === 0) {
            await notifyDemand(sourceTabId);
            return { ok: true };
          }
          const sanitizedItems = message.items.map((item) => ({
            receivedAtMs: item.receivedAtMs,
            message: sanitizeBridgeMessage(item.message),
          }));
          let pruned = false;
          for (const subscriberTabId of Array.from(subscribers)) {
            const delivered = await sendToTab(subscriberTabId, {
              type: BRIDGE_DELIVER_BATCH_TYPE,
              sourceTabId,
              site: source.site,
              channelLogin: source.channelLogin,
              items: sanitizedItems,
            });
            if (!delivered) {
              unbindSubscriber(subscriberTabId);
              pruned = true;
            }
          }
          if (pruned) {
            await persistState();
            await notifyDemand(sourceTabId);
          }
          return { ok: true };
        })
          .then((result) => sendResponse(result))
          .catch((error: unknown) => {
            console.warn("[fce] bridge hub request failed", error);
            sendResponse(undefined);
          });
        return true;
      }

      const subscriberTabId = senderTabId;
      void enqueueTask(async () => {
        await ensureRestored();
        if (disposed) {
          return undefined;
        }
        if (message.type === BRIDGE_LIST_SOURCES_TYPE) {
          const response: BridgeListSourcesResponse = {
            sources: Array.from(sources.values())
              .filter(
                (source) =>
                  source.tabId !== subscriberTabId &&
                  source.site !== senderSite,
              )
              .sort(
                (left, right) =>
                  left.label.localeCompare(right.label) ||
                  left.channelLogin.localeCompare(right.channelLogin),
              ),
          };
          return response;
        }
        if (message.type === BRIDGE_SUBSCRIBE_TYPE) {
          const previousSourceId = unbindSubscriber(subscriberTabId);
          if (
            previousSourceId !== null &&
            previousSourceId !== message.sourceTabId
          ) {
            const oldAlive = await notifyDemand(previousSourceId);
            if (!oldAlive) {
              await removeDeadSource(previousSourceId, "closed");
            }
          }
          const targetSource = sources.get(message.sourceTabId);
          if (
            !targetSource ||
            targetSource.tabId === subscriberTabId ||
            targetSource.site === senderSite
          ) {
            if (previousSourceId !== null) {
              await persistState();
            }
            const emptyResponse: BridgeSubscribeResponse = { source: null };
            return emptyResponse;
          }
          bindSubscriber(subscriberTabId, targetSource.tabId);
          await persistState();
          const sourceAlive = await notifyDemand(targetSource.tabId);
          if (!sourceAlive) {
            await removeDeadSource(targetSource.tabId, "closed");
            await persistState();
            const deadResponse: BridgeSubscribeResponse = { source: null };
            return deadResponse;
          }
          const okResponse: BridgeSubscribeResponse = { source: targetSource };
          return okResponse;
        }
        if (message.type === BRIDGE_UNSUBSCRIBE_TYPE) {
          const previousSourceId = unbindSubscriber(subscriberTabId);
          if (previousSourceId !== null) {
            await persistState();
            const oldAlive = await notifyDemand(previousSourceId);
            if (!oldAlive) {
              await removeDeadSource(previousSourceId, "closed");
              await persistState();
            }
          }
          return { ok: true };
        }
        return undefined;
      })
        .then((result) => sendResponse(result))
        .catch((error: unknown) => {
          console.warn("[fce] bridge hub subscriber request failed", error);
          sendResponse(undefined);
        });
      return true;
    },

    handleTabRemoved(tabId) {
      return enqueueTask(async () => {
        await ensureRestored();
        if (disposed) {
          return;
        }
        let changed = popoutViewerTabs.delete(tabId);
        const removedSnapshot = popoutSnapshotsByTab.get(tabId);
        if (removedSnapshot) {
          popoutSnapshotsByTab.delete(tabId);
          if (latestPopoutTabBySite.get(removedSnapshot.localSite) === tabId) {
            latestPopoutTabBySite.delete(removedSnapshot.localSite);
            for (const [candidateTabId, candidate] of popoutSnapshotsByTab) {
              if (candidate.localSite === removedSnapshot.localSite) {
                latestPopoutTabBySite.set(
                  removedSnapshot.localSite,
                  candidateTabId,
                );
                break;
              }
            }
            await broadcastPopoutSnapshot(
              removedSnapshot.localSite,
              await resolveSnapshotForSite(removedSnapshot.localSite),
            );
          }
        }
        if (sources.has(tabId) && (await removeDeadSource(tabId, "closed"))) {
          changed = true;
        }
        const previousSourceId = unbindSubscriber(tabId);
        if (previousSourceId !== null) {
          changed = true;
          const oldAlive = await notifyDemand(previousSourceId);
          if (!oldAlive) {
            await removeDeadSource(previousSourceId, "closed");
          }
        }
        if (changed) {
          await persistState();
        }
      });
    },

    dispose() {
      disposed = true;
      sources.clear();
      subscribersBySource.clear();
      sourceBySubscriber.clear();
      popoutSnapshotsByTab.clear();
      latestPopoutTabBySite.clear();
      popoutViewerTabs.clear();
    },
  };
}
