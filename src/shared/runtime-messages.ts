import type { PopoutBounds } from "./settings";
import type { PopoutSiteKey } from "./site-ids";

export const POPOUT_OPEN_TYPE = "fce:popout-open" as const;
export const POPOUT_CLOSE_TYPE = "fce:popout-close" as const;
export const POPOUT_FOCUS_TYPE = "fce:popout-focus" as const;
export const POPOUT_QUERY_TYPE = "fce:popout-query" as const;

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
