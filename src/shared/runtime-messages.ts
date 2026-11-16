import type { PopoutBounds } from "./settings";
import type { PopoutSiteKey } from "./site-ids";

export const POPOUT_OPEN_TYPE = "fce:popout-open" as const;
export const POPOUT_CLOSE_TYPE = "fce:popout-close" as const;
export const POPOUT_FOCUS_TYPE = "fce:popout-focus" as const;
export const POPOUT_QUERY_TYPE = "fce:popout-query" as const;

/** Extension-owned chat popout (comments / no official URL) / 拡張自前別窓 */
export const EXTENSION_CHAT_PUSH_TYPE = "fce:extension-chat-push" as const;
export const EXTENSION_CHAT_SEND_TYPE = "fce:extension-chat-send" as const;
export const EXTENSION_CHAT_READY_TYPE = "fce:extension-chat-ready" as const;

export interface ExtensionChatRow {
  id: string;
  authorName: string;
  text: string;
}

export interface ExtensionChatPushMessage {
  type: typeof EXTENSION_CHAT_PUSH_TYPE;
  messages: ExtensionChatRow[];
}

export interface ExtensionChatSendMessage {
  type: typeof EXTENSION_CHAT_SEND_TYPE;
  text: string;
}

export interface ExtensionChatReadyMessage {
  type: typeof EXTENSION_CHAT_READY_TYPE;
}

export type ExtensionChatRuntimeMessage =
  | ExtensionChatPushMessage
  | ExtensionChatSendMessage
  | ExtensionChatReadyMessage;

export function isExtensionChatRuntimeMessage(
  value: unknown,
): value is ExtensionChatRuntimeMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return (
    type === EXTENSION_CHAT_PUSH_TYPE ||
    type === EXTENSION_CHAT_SEND_TYPE ||
    type === EXTENSION_CHAT_READY_TYPE
  );
}

/** Public path of the extension-owned chat popout page / 拡張自前チャット別窓の公開パス */
export const EXTENSION_CHAT_POPOUT_PAGE = "/popout-chat.html" as const;

export function resolveExtensionChatPopoutUrl(): string {
  return browser.runtime.getURL(EXTENSION_CHAT_POPOUT_PAGE);
}

export interface PopoutOpenRequest {
  type: typeof POPOUT_OPEN_TYPE;
  url: string;
  siteKey: PopoutSiteKey;
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

export type PopoutRuntimeRequest =
  | PopoutOpenRequest
  | PopoutCloseRequest
  | PopoutFocusRequest
  | PopoutQueryRequest;

export function isPopoutRuntimeRequest(
  value: unknown,
): value is PopoutRuntimeRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return (
    type === POPOUT_OPEN_TYPE ||
    type === POPOUT_CLOSE_TYPE ||
    type === POPOUT_FOCUS_TYPE ||
    type === POPOUT_QUERY_TYPE
  );
}

export type { PopoutBounds, PopoutSiteKey };
