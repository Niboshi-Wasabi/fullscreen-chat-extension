import type { PopoutBounds } from "./settings";
import type { PopoutSiteKey } from "./site-ids";
import { isTrustedExtensionSender } from "./trusted-sender";

export { isTrustedExtensionSender };

export const POPOUT_OPEN_TYPE = "fce:popout-open" as const;
export const POPOUT_CLOSE_TYPE = "fce:popout-close" as const;
export const POPOUT_FOCUS_TYPE = "fce:popout-focus" as const;
export const POPOUT_QUERY_TYPE = "fce:popout-query" as const;
export const BRIDGE_POPOUT_PAGE_PATH = "/bridge-popout.html" as const;

function readBridgePopoutBaseUrl(): string | undefined {
  if (typeof browser === "undefined") {
    return undefined;
  }
  try {
    return browser.runtime?.getURL?.(BRIDGE_POPOUT_PAGE_PATH);
  } catch {
    return undefined;
  }
}

export function buildBridgePopoutUrl(siteKey: PopoutSiteKey): string | null {
  const base = readBridgePopoutBaseUrl();
  if (typeof base !== "string" || !base) {
    return null;
  }
  try {
    const url = new URL(base);
    url.searchParams.set("site", siteKey);
    return url.toString();
  } catch {
    return null;
  }
}

function isAllowedBridgePopoutUrl(url: URL, siteKey?: PopoutSiteKey): boolean {
  const base = readBridgePopoutBaseUrl();
  if (typeof base !== "string" || !base) {
    return false;
  }
  try {
    const expected = new URL(base);
    if (
      url.protocol !== expected.protocol ||
      url.host !== expected.host ||
      url.pathname !== expected.pathname
    ) {
      return false;
    }
    const siteParam = url.searchParams.get("site");
    if (siteKey !== undefined) {
      return siteParam === siteKey;
    }
    return siteParam === "youtube" || siteParam === "twitch";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPopoutSiteKey(value: unknown): value is PopoutSiteKey {
  return value === "youtube" || value === "twitch";
}

/** Validate popout target URLs against permitted sites. */
export function isAllowedPopoutUrl(
  rawUrl: string,
  siteKey?: PopoutSiteKey,
): boolean {
  if (typeof rawUrl !== "string" || !rawUrl || rawUrl.length > 4096) {
    return false;
  }
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password) {
      return false;
    }
    if (isAllowedBridgePopoutUrl(url, siteKey)) {
      return true;
    }
    if (url.protocol !== "https:" || url.port !== "") {
      return false;
    }
    if (
      siteKey !== "twitch" &&
      /(^|\.)youtube\.com$/i.test(url.hostname) &&
      /^\/live_chat(?:_replay)?$/.test(url.pathname)
    ) {
      return true;
    }
    if (
      siteKey !== "youtube" &&
      /(^|\.)twitch\.tv$/i.test(url.hostname) &&
      /^\/popout\/[^/]+\/chat\/?$/i.test(url.pathname)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Validate official chat iframe embed URLs before assigning to an iframe `src`. */
export function isAllowedNativeChatEmbedUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== "string" || !rawUrl || rawUrl.length > 4096) {
    return false;
  }
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.port !== "" ||
      url.username ||
      url.password
    ) {
      return false;
    }
    if (
      /(^|\.)youtube\.com$/i.test(url.hostname) &&
      /^\/live_chat(?:_replay)?\/?$/i.test(url.pathname)
    ) {
      return true;
    }
    if (
      /(^|\.)twitch\.tv$/i.test(url.hostname) &&
      /^\/(?:embed|popout)\/[^/]+\/chat\/?$/i.test(url.pathname)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export interface PopoutOpenRequest {
  type: typeof POPOUT_OPEN_TYPE;
  url: string;
  siteKey: PopoutSiteKey;
  /**
   * Bring the window forward. Only explicit user actions set this; a watch tab
   * reclaiming ownership on focus must not pull focus away from the page.
   * 窓を前面へ出す。明示操作だけが立てる。視聴タブにフォーカスが戻り、共有の別窓を取得し直す場合は
   * ページからフォーカスを奪わない。
   */
  focus?: boolean;
}

export interface PopoutCloseRequest {
  type: typeof POPOUT_CLOSE_TYPE;
}

export interface PopoutFocusRequest {
  type: typeof POPOUT_FOCUS_TYPE;
}

export interface PopoutQueryRequest {
  type: typeof POPOUT_QUERY_TYPE;
}

export interface PopoutQueryResponse {
  open: boolean;
  windowId: number | null;
  siteKey: PopoutSiteKey | null;
}

/** Background accepted this tab as the watch page that owns the popout. */
export interface PopoutOpenResponse {
  accepted: boolean;
}

export type PopoutRuntimeRequest =
  | PopoutOpenRequest
  | PopoutCloseRequest
  | PopoutFocusRequest
  | PopoutQueryRequest;

export function isPopoutRuntimeRequest(
  value: unknown,
): value is PopoutRuntimeRequest {
  if (!isRecord(value)) {
    return false;
  }
  const type = value.type;
  if (type === POPOUT_OPEN_TYPE) {
    return (
      isPopoutSiteKey(value.siteKey) &&
      (value.focus === undefined || typeof value.focus === "boolean") &&
      typeof value.url === "string" &&
      isAllowedPopoutUrl(value.url, value.siteKey)
    );
  }
  return (
    type === POPOUT_CLOSE_TYPE ||
    type === POPOUT_FOCUS_TYPE ||
    type === POPOUT_QUERY_TYPE
  );
}

export type { PopoutBounds, PopoutSiteKey };
