import type { NormalizedMessage, SiteKind } from "../core/message";
import {
  BRIDGE_DELIVER_BATCH_TYPE,
  BRIDGE_DEMAND_TYPE,
  BRIDGE_LIST_SOURCES_TYPE,
  BRIDGE_PUSH_BATCH_TYPE,
  BRIDGE_REGISTER_TYPE,
  BRIDGE_SOURCE_STATUS_TYPE,
  BRIDGE_SUBSCRIBE_TYPE,
  BRIDGE_UNREGISTER_TYPE,
  BRIDGE_UNSUBSCRIBE_TYPE,
  isBridgeContentEvent,
  isBridgeSourceSummary,
  isValidSourceKeyForSite,
  MAX_BRIDGE_BATCH_SIZE,
  sanitizeBridgeMessage,
  type BridgeBatchItem,
  type BridgeListSourcesResponse,
  type BridgeSenderInfo,
  type BridgeSourceStatusKind,
  type BridgeSourceSummary,
  type BridgeSubscribeResponse,
} from "../shared/bridge-messages";
import { isTrustedExtensionSender } from "../shared/trusted-sender";

const BATCH_FLUSH_DELAY_MS = 150;
const REGISTER_RETRY_DELAYS_MS = [500, 1500, 3000] as const;

async function sendRuntimeMessageSafe<T>(
  payload: unknown,
): Promise<T | undefined> {
  try {
    if (typeof browser === "undefined" || !browser.runtime?.sendMessage) {
      return undefined;
    }
    return (await browser.runtime.sendMessage(payload)) as T | undefined;
  } catch {
    return undefined;
  }
}

export interface BridgePublisherOptions {
  site?: SiteKind;
  getChannelLogin: () => string | null;
  getLabel?: () => string | null;
  onDemandChange?: (activeSubscribers: number) => void;
  attachListener?: boolean;
}

export interface BridgePublisher {
  start(): void;
  stop(): void;
  syncChannel(): void;
  enqueue(message: NormalizedMessage): void;
  hasSubscribers(): boolean;
  handleMessage(
    message: unknown,
    sender: BridgeSenderInfo | undefined,
  ): boolean;
}

/**
 * Watch-tab side publisher: sends sanitized live chat batches of `site` only while subscribed.
 * 視聴タブ側の送信部。相手タブから購読されている間だけこのタブのサイトで取得したコメントをまとめて送る。
 */
export function createBridgePublisher(
  options: BridgePublisherOptions,
): BridgePublisher {
  const site: SiteKind = options.site ?? "twitch";
  let started = false;
  let stopped = false;
  let registeredKey: string | null = null;
  let pendingRegisterKey: string | null = null;
  let registerSeq = 0;
  let retryAttempts = 0;
  let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let activeSubscribers = 0;
  const pendingById = new Map<string, BridgeBatchItem>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const listener: Parameters<
    typeof browser.runtime.onMessage.addListener
  >[0] = (message, sender) => {
    handleMessage(message, sender as BridgeSenderInfo | undefined);
    return undefined;
  };

  function clearFlushTimer(): void {
    if (flushTimer !== null) {
      globalThis.clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function clearRetryTimer(): void {
    if (retryTimer !== null) {
      globalThis.clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function flush(): void {
    clearFlushTimer();
    if (
      stopped ||
      !started ||
      activeSubscribers <= 0 ||
      !registeredKey ||
      pendingById.size === 0
    ) {
      return;
    }
    const channelLogin = registeredKey;
    const allItems = Array.from(pendingById.values());
    pendingById.clear();
    for (
      let offset = 0;
      offset < allItems.length;
      offset += MAX_BRIDGE_BATCH_SIZE
    ) {
      const chunk = allItems.slice(offset, offset + MAX_BRIDGE_BATCH_SIZE);
      void sendRuntimeMessageSafe({
        type: BRIDGE_PUSH_BATCH_TYPE,
        site,
        channelLogin,
        items: chunk,
      });
    }
  }

  function resolveSourceLabel(sourceKey: string): string {
    const raw = options.getLabel?.()?.trim();
    if (raw) {
      return raw.slice(0, 120);
    }
    return site === "twitch" ? `#${sourceKey}` : `YouTube (${sourceKey})`;
  }

  function attemptRegister(key: string): void {
    const seq = ++registerSeq;
    pendingRegisterKey = key;
    const label = resolveSourceLabel(key);
    void sendRuntimeMessageSafe<{ ok?: boolean }>({
      type: BRIDGE_REGISTER_TYPE,
      site,
      channelLogin: key,
      label,
    }).then((reply) => {
      if (stopped || !started || seq !== registerSeq) {
        return;
      }
      pendingRegisterKey = null;
      if (reply?.ok === true) {
        registeredKey = key;
        retryAttempts = 0;
        return;
      }
      registeredKey = null;
      if (retryAttempts < REGISTER_RETRY_DELAYS_MS.length) {
        const delayMs = REGISTER_RETRY_DELAYS_MS[retryAttempts]!;
        retryAttempts += 1;
        clearRetryTimer();
        retryTimer = globalThis.setTimeout(() => {
          retryTimer = null;
          if (
            stopped ||
            !started ||
            registeredKey !== null ||
            pendingRegisterKey !== null
          ) {
            return;
          }
          syncChannelInternal(false);
        }, delayMs);
      }
    });
  }

  function syncChannelInternal(resetBackoff = true): void {
    if (stopped || !started) {
      return;
    }
    const raw = options.getChannelLogin();
    const nextKey = isValidSourceKeyForSite(site, raw) ? raw : null;
    if (
      nextKey === registeredKey ||
      (nextKey !== null && nextKey === pendingRegisterKey)
    ) {
      return;
    }
    clearRetryTimer();
    if (resetBackoff) {
      retryAttempts = 0;
    }
    clearFlushTimer();
    pendingById.clear();
    if (nextKey) {
      registeredKey = null;
      attemptRegister(nextKey);
      return;
    }
    const shouldUnregister =
      registeredKey !== null || pendingRegisterKey !== null;
    registerSeq += 1;
    pendingRegisterKey = null;
    registeredKey = null;
    const hadSubscribers = activeSubscribers > 0;
    activeSubscribers = 0;
    if (shouldUnregister) {
      void sendRuntimeMessageSafe<{ ok?: boolean }>({
        type: BRIDGE_UNREGISTER_TYPE,
      });
    }
    if (hadSubscribers) {
      options.onDemandChange?.(0);
    }
  }

  function handleMessage(
    message: unknown,
    sender: BridgeSenderInfo | undefined,
  ): boolean {
    if (stopped || !started) {
      return false;
    }
    if (!isTrustedExtensionSender(sender) || sender?.tab !== undefined) {
      return false;
    }
    if (!isBridgeContentEvent(message) || message.type !== BRIDGE_DEMAND_TYPE) {
      return false;
    }
    const changed = activeSubscribers !== message.activeSubscribers;
    activeSubscribers = message.activeSubscribers;
    if (activeSubscribers <= 0) {
      clearFlushTimer();
      pendingById.clear();
    }
    if (changed) {
      options.onDemandChange?.(activeSubscribers);
    }
    return true;
  }

  return {
    start() {
      if (started && !stopped) {
        return;
      }
      stopped = false;
      started = true;
      if (options.attachListener !== false) {
        try {
          browser.runtime?.onMessage?.addListener(listener);
        } catch {
          // Extension context may already be invalidated.
        }
      }
      syncChannelInternal(true);
    },
    stop() {
      if (stopped && !started) {
        return;
      }
      stopped = true;
      started = false;
      activeSubscribers = 0;
      clearRetryTimer();
      retryAttempts = 0;
      registerSeq += 1;
      clearFlushTimer();
      pendingById.clear();
      if (options.attachListener !== false) {
        try {
          browser.runtime?.onMessage?.removeListener(listener);
        } catch {
          // Extension context may already be invalidated on teardown.
        }
      }
      const shouldUnregister =
        registeredKey !== null || pendingRegisterKey !== null;
      registeredKey = null;
      pendingRegisterKey = null;
      if (shouldUnregister) {
        void sendRuntimeMessageSafe<{ ok?: boolean }>({
          type: BRIDGE_UNREGISTER_TYPE,
        });
      }
    },
    syncChannel() {
      syncChannelInternal(true);
    },
    enqueue(message) {
      // Strictly reject remote/imported site messages so cross-tab echo loops cannot happen.
      if (stopped || !started || message.site !== site) {
        return;
      }
      if (!registeredKey && !pendingRegisterKey && retryTimer === null) {
        syncChannelInternal(true);
      }
      if (!registeredKey || activeSubscribers <= 0) {
        return;
      }
      const clean = sanitizeBridgeMessage(message);
      const existing = pendingById.get(clean.id);
      if (existing) {
        existing.message = clean;
      } else {
        pendingById.set(clean.id, {
          receivedAtMs: Date.now(),
          message: clean,
        });
      }
      if (pendingById.size >= MAX_BRIDGE_BATCH_SIZE) {
        flush();
        return;
      }
      if (flushTimer === null) {
        flushTimer = globalThis.setTimeout(flush, BATCH_FLUSH_DELAY_MS);
      }
    },
    hasSubscribers() {
      return !stopped && started && activeSubscribers > 0;
    },
    handleMessage,
  };
}

export interface BridgeSubscriberOptions {
  localSite?: SiteKind;
  onBatch: (payload: {
    sourceTabId: number;
    site: SiteKind;
    channelLogin: string;
    items: BridgeBatchItem[];
  }) => void;
  onSourceStatus: (payload: {
    sourceTabId: number;
    status: BridgeSourceStatusKind;
    channelLogin?: string;
  }) => void;
  attachListener?: boolean;
}

export interface BridgeSubscriber {
  start(): void;
  stop(): void;
  listSources(): Promise<BridgeSourceSummary[]>;
  subscribe(sourceTabId: number): Promise<BridgeSourceSummary | null>;
  unsubscribe(): Promise<void>;
  getActiveSource(): BridgeSourceSummary | null;
  handleMessage(
    message: unknown,
    sender: BridgeSenderInfo | undefined,
  ): boolean;
}

/**
 * Watch-tab side subscriber: discovers open peer-site sources and receives live batches.
 * 視聴タブ側の購読部。相手サイトの配信タブ一覧を取得し、ライブチャットを受信する。
 */
export function createBridgeSubscriber(
  options: BridgeSubscriberOptions,
): BridgeSubscriber {
  let started = false;
  let stopped = false;
  let activeSource: BridgeSourceSummary | null = null;
  let requestSeq = 0;
  let pendingSubscribeCount = 0;

  const listener: Parameters<
    typeof browser.runtime.onMessage.addListener
  >[0] = (message, sender) => {
    handleMessage(message, sender as BridgeSenderInfo | undefined);
    return undefined;
  };

  function handleMessage(
    message: unknown,
    sender: BridgeSenderInfo | undefined,
  ): boolean {
    if (stopped || !started) {
      return false;
    }
    if (!isTrustedExtensionSender(sender) || sender?.tab !== undefined) {
      return false;
    }
    if (!isBridgeContentEvent(message)) {
      return false;
    }
    if (message.type === BRIDGE_DELIVER_BATCH_TYPE) {
      if (
        !activeSource ||
        message.sourceTabId !== activeSource.tabId ||
        message.site !== activeSource.site ||
        (options.localSite !== undefined &&
          message.site === options.localSite) ||
        message.channelLogin !== activeSource.channelLogin
      ) {
        return false;
      }
      options.onBatch({
        sourceTabId: message.sourceTabId,
        site: message.site,
        channelLogin: message.channelLogin,
        items: message.items,
      });
      return true;
    }
    if (message.type === BRIDGE_SOURCE_STATUS_TYPE) {
      if (!activeSource || message.sourceTabId !== activeSource.tabId) {
        return false;
      }
      if (message.status === "closed" || message.status === "channel-changed") {
        activeSource = null;
      }
      options.onSourceStatus({
        sourceTabId: message.sourceTabId,
        status: message.status,
        ...(message.channelLogin !== undefined
          ? { channelLogin: message.channelLogin }
          : {}),
      });
      return true;
    }
    return false;
  }

  return {
    start() {
      if (started && !stopped) {
        return;
      }
      stopped = false;
      started = true;
      if (options.attachListener !== false) {
        try {
          browser.runtime?.onMessage?.addListener(listener);
        } catch {
          // Extension context may already be invalidated.
        }
      }
    },
    stop() {
      if (stopped && !started) {
        return;
      }
      stopped = true;
      started = false;
      requestSeq += 1;
      if (options.attachListener !== false) {
        try {
          browser.runtime?.onMessage?.removeListener(listener);
        } catch {
          // Extension context may already be invalidated on teardown.
        }
      }
      const shouldSend = activeSource !== null || pendingSubscribeCount > 0;
      activeSource = null;
      if (shouldSend) {
        void sendRuntimeMessageSafe({ type: BRIDGE_UNSUBSCRIBE_TYPE });
      }
    },
    async listSources() {
      if (stopped || !started) {
        return [];
      }
      const reply = await sendRuntimeMessageSafe<BridgeListSourcesResponse>({
        type: BRIDGE_LIST_SOURCES_TYPE,
      });
      if (!reply || !Array.isArray(reply.sources)) {
        return [];
      }
      const filtered: BridgeSourceSummary[] = [];
      for (const source of reply.sources) {
        if (!isBridgeSourceSummary(source)) {
          continue;
        }
        if (
          options.localSite !== undefined &&
          source.site === options.localSite
        ) {
          continue;
        }
        filtered.push(source);
      }
      return filtered;
    },
    async subscribe(sourceTabId) {
      if (stopped || !started) {
        return null;
      }
      const seq = ++requestSeq;
      pendingSubscribeCount += 1;
      // Clear any previous source immediately while switching so stale batches/status drop.
      activeSource = null;
      try {
        const reply = await sendRuntimeMessageSafe<BridgeSubscribeResponse>({
          type: BRIDGE_SUBSCRIBE_TYPE,
          sourceTabId,
        });
        if (stopped || !started || seq !== requestSeq) {
          return null;
        }
        const source =
          reply &&
          isBridgeSourceSummary(reply.source) &&
          (options.localSite === undefined ||
            reply.source.site !== options.localSite)
            ? reply.source
            : null;
        activeSource = source;
        return source;
      } finally {
        pendingSubscribeCount = Math.max(0, pendingSubscribeCount - 1);
      }
    },
    async unsubscribe() {
      requestSeq += 1;
      const shouldSend = activeSource !== null || pendingSubscribeCount > 0;
      activeSource = null;
      if (shouldSend) {
        await sendRuntimeMessageSafe({ type: BRIDGE_UNSUBSCRIBE_TYPE });
      }
    },
    getActiveSource() {
      return activeSource;
    },
    handleMessage,
  };
}
