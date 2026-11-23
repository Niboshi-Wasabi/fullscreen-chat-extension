import type { NormalizedMessage, SiteKind } from "../core/message";
import { isSafeHttpsImageUrl } from "./safe-image-url";
import { isTwitchHost } from "./site-ids";
import { isTrustedExtensionSender } from "./trusted-sender";
import { isYouTubeHost } from "./youtube-page";

export const BRIDGE_REGISTER_TYPE = "fce:bridge-register" as const;
export const BRIDGE_UNREGISTER_TYPE = "fce:bridge-unregister" as const;
export const BRIDGE_LIST_SOURCES_TYPE = "fce:bridge-list-sources" as const;
export const BRIDGE_SUBSCRIBE_TYPE = "fce:bridge-subscribe" as const;
export const BRIDGE_UNSUBSCRIBE_TYPE = "fce:bridge-unsubscribe" as const;
export const BRIDGE_PUSH_BATCH_TYPE = "fce:bridge-push-batch" as const;
export const BRIDGE_DELIVER_BATCH_TYPE = "fce:bridge-deliver-batch" as const;
export const BRIDGE_SOURCE_STATUS_TYPE = "fce:bridge-source-status" as const;
export const BRIDGE_DEMAND_TYPE = "fce:bridge-demand" as const;
export const BRIDGE_POPOUT_SYNC_TYPE = "fce:bridge-popout-sync" as const;
export const BRIDGE_POPOUT_SUBSCRIBE_TYPE =
  "fce:bridge-popout-subscribe" as const;
export const BRIDGE_POPOUT_UPDATE_TYPE = "fce:bridge-popout-update" as const;

export const MAX_BRIDGE_BATCH_SIZE = 50;
const MAX_BRIDGE_POPOUT_MESSAGES = 500;

export type BridgeSourceStatusKind = "active" | "channel-changed" | "closed";

export interface BridgeSourceSummary {
  tabId: number;
  site: SiteKind;
  channelLogin: string;
  label: string;
}

export interface BridgeBatchItem {
  receivedAtMs: number;
  message: NormalizedMessage;
}

export interface BridgeRegisterRequest {
  type: typeof BRIDGE_REGISTER_TYPE;
  site: SiteKind;
  channelLogin: string;
  label?: string;
}

export interface BridgeUnregisterRequest {
  type: typeof BRIDGE_UNREGISTER_TYPE;
}

export interface BridgeListSourcesRequest {
  type: typeof BRIDGE_LIST_SOURCES_TYPE;
}

export interface BridgeSubscribeRequest {
  type: typeof BRIDGE_SUBSCRIBE_TYPE;
  sourceTabId: number;
}

export interface BridgeUnsubscribeRequest {
  type: typeof BRIDGE_UNSUBSCRIBE_TYPE;
}

export interface BridgePushBatchRequest {
  type: typeof BRIDGE_PUSH_BATCH_TYPE;
  site: SiteKind;
  channelLogin: string;
  items: BridgeBatchItem[];
}

export type BridgeRuntimeRequest =
  | BridgeRegisterRequest
  | BridgeUnregisterRequest
  | BridgeListSourcesRequest
  | BridgeSubscribeRequest
  | BridgeUnsubscribeRequest
  | BridgePushBatchRequest;

export interface BridgePopoutSnapshot {
  localSite: SiteKind;
  peerSite: SiteKind | null;
  peerLabel: string | null;
  delaySec: number;
  suspendedReason: "pause" | "seek" | "ad" | null;
  messages: NormalizedMessage[];
}

export interface BridgePopoutSyncRequest {
  type: typeof BRIDGE_POPOUT_SYNC_TYPE;
  snapshot: BridgePopoutSnapshot;
}

export interface BridgePopoutSubscribeRequest {
  type: typeof BRIDGE_POPOUT_SUBSCRIBE_TYPE;
  site: SiteKind;
}

export interface BridgePopoutUpdateEvent {
  type: typeof BRIDGE_POPOUT_UPDATE_TYPE;
  snapshot: BridgePopoutSnapshot | null;
}

export interface BridgeDeliverBatchEvent {
  type: typeof BRIDGE_DELIVER_BATCH_TYPE;
  sourceTabId: number;
  site: SiteKind;
  channelLogin: string;
  items: BridgeBatchItem[];
}

export interface BridgeSourceStatusEvent {
  type: typeof BRIDGE_SOURCE_STATUS_TYPE;
  sourceTabId: number;
  status: BridgeSourceStatusKind;
  channelLogin?: string;
}

export interface BridgeDemandEvent {
  type: typeof BRIDGE_DEMAND_TYPE;
  activeSubscribers: number;
}

export type BridgeContentEvent =
  BridgeDeliverBatchEvent | BridgeSourceStatusEvent | BridgeDemandEvent;

export interface BridgeListSourcesResponse {
  sources: BridgeSourceSummary[];
}

export interface BridgeSubscribeResponse {
  source: BridgeSourceSummary | null;
}

export interface BridgePopoutSubscribeResponse {
  snapshot: BridgePopoutSnapshot | null;
}

export interface BridgeSenderInfo {
  id?: string;
  url?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
}

const VALID_ROLES = new Set([
  "viewer",
  "member",
  "moderator",
  "owner",
  "bot",
  "unknown",
]);
const SAFE_COLOR_RE =
  /^(?:#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*[\d.]+)?\s*\))$/i;
const CHANNEL_LOGIN_RE = /^[A-Za-z0-9_]{1,50}$/;
const YOUTUBE_SOURCE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isTabId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isBridgeSiteKind(value: unknown): value is SiteKind {
  return value === "twitch" || value === "youtube-live";
}

export function isValidChannelLogin(value: unknown): value is string {
  return typeof value === "string" && CHANNEL_LOGIN_RE.test(value);
}

export function isValidSourceKeyForSite(
  site: SiteKind,
  value: unknown,
): value is string {
  if (typeof value !== "string") {
    return false;
  }
  return site === "twitch"
    ? CHANNEL_LOGIN_RE.test(value)
    : YOUTUBE_SOURCE_KEY_RE.test(value);
}

export function isBridgeMessage(
  value: unknown,
  expectedSite?: SiteKind,
): value is NormalizedMessage {
  if (
    !isRecord(value) ||
    !isBridgeSiteKind(value.site) ||
    (expectedSite !== undefined && value.site !== expectedSite) ||
    !isText(value.id, 2048) ||
    !value.id ||
    !isText(value.authorName, 1000) ||
    !isText(value.text, 20000)
  ) {
    return false;
  }
  if (
    typeof value.timestampMs !== "number" ||
    !Number.isFinite(value.timestampMs) ||
    typeof value.isCommand !== "boolean" ||
    !VALID_ROLES.has(String(value.role))
  ) {
    return false;
  }
  if (
    !Array.isArray(value.badges) ||
    value.badges.length > 100 ||
    !value.badges.every((badge) => isText(badge, 1000))
  ) {
    return false;
  }
  if (value.authorId !== undefined && !isText(value.authorId, 2048)) {
    return false;
  }
  if (value.authorLogin !== undefined && !isText(value.authorLogin, 1000)) {
    return false;
  }
  if (
    value.authorColor !== undefined &&
    (!isText(value.authorColor, 64) || !SAFE_COLOR_RE.test(value.authorColor))
  ) {
    return false;
  }
  if (value.isSelf !== undefined && typeof value.isSelf !== "boolean") {
    return false;
  }
  if (
    value.videoOffsetSec !== undefined &&
    (typeof value.videoOffsetSec !== "number" ||
      !Number.isFinite(value.videoOffsetSec))
  ) {
    return false;
  }
  if (
    value.badgeIcons !== undefined &&
    (!Array.isArray(value.badgeIcons) ||
      value.badgeIcons.length > 100 ||
      !value.badgeIcons.every(
        (icon) =>
          isRecord(icon) &&
          isText(icon.alt, 1000) &&
          isText(icon.src, 8192) &&
          isSafeHttpsImageUrl(icon.src),
      ))
  ) {
    return false;
  }
  if (
    value.segments !== undefined &&
    (!Array.isArray(value.segments) ||
      value.segments.length > 500 ||
      !value.segments.every((segment) => {
        if (!isRecord(segment)) return false;
        if (segment.type === "text") return isText(segment.text, 20000);
        return (
          segment.type === "emoji" &&
          isText(segment.alt, 1000) &&
          isText(segment.src, 8192) &&
          isSafeHttpsImageUrl(segment.src)
        );
      }))
  ) {
    return false;
  }
  return true;
}

export function isBridgeTwitchMessage(
  value: unknown,
): value is NormalizedMessage {
  return isBridgeMessage(value, "twitch");
}

/** Return a whitelisted copy without `raw` or unknown fields.
 * `raw` や未知のフィールドを除き、許可されたフィールドだけをコピーして返す。 */
export function sanitizeBridgeMessage(
  value: NormalizedMessage,
): NormalizedMessage {
  return {
    id: value.id,
    site: value.site,
    authorName: value.authorName,
    ...(value.authorLogin !== undefined
      ? { authorLogin: value.authorLogin }
      : {}),
    ...(value.authorId !== undefined ? { authorId: value.authorId } : {}),
    ...(value.authorColor !== undefined
      ? { authorColor: value.authorColor }
      : {}),
    role: value.role,
    badges: [...value.badges],
    ...(value.badgeIcons !== undefined
      ? {
          badgeIcons: value.badgeIcons.map((icon) => ({
            alt: icon.alt,
            src: icon.src,
          })),
        }
      : {}),
    text: value.text,
    ...(value.segments !== undefined
      ? {
          segments: value.segments.map((segment) =>
            segment.type === "text"
              ? { type: "text" as const, text: segment.text }
              : {
                  type: "emoji" as const,
                  src: segment.src,
                  alt: segment.alt,
                },
          ),
        }
      : {}),
    timestampMs: value.timestampMs,
    ...(value.videoOffsetSec !== undefined
      ? { videoOffsetSec: value.videoOffsetSec }
      : {}),
    isCommand: value.isCommand,
    ...(value.isSelf !== undefined ? { isSelf: value.isSelf } : {}),
  };
}

function isValidBatchItems(
  value: unknown,
  expectedSite: SiteKind,
): value is BridgeBatchItem[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_BRIDGE_BATCH_SIZE
  ) {
    return false;
  }
  return value.every(
    (item) =>
      isRecord(item) &&
      typeof item.receivedAtMs === "number" &&
      Number.isFinite(item.receivedAtMs) &&
      isBridgeMessage(item.message, expectedSite),
  );
}

export function isBridgeSourceSummary(
  value: unknown,
): value is BridgeSourceSummary {
  return (
    isRecord(value) &&
    isTabId(value.tabId) &&
    isBridgeSiteKind(value.site) &&
    isValidSourceKeyForSite(value.site, value.channelLogin) &&
    isText(value.label, 120) &&
    value.label.length > 0
  );
}

export function isBridgeRuntimeRequest(
  value: unknown,
): value is BridgeRuntimeRequest {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.type) {
    case BRIDGE_REGISTER_TYPE:
      return (
        isBridgeSiteKind(value.site) &&
        isValidSourceKeyForSite(value.site, value.channelLogin) &&
        (value.label === undefined || isText(value.label, 120))
      );
    case BRIDGE_UNREGISTER_TYPE:
    case BRIDGE_LIST_SOURCES_TYPE:
    case BRIDGE_UNSUBSCRIBE_TYPE:
      return true;
    case BRIDGE_SUBSCRIBE_TYPE:
      return isTabId(value.sourceTabId);
    case BRIDGE_PUSH_BATCH_TYPE:
      return (
        isBridgeSiteKind(value.site) &&
        isValidSourceKeyForSite(value.site, value.channelLogin) &&
        isValidBatchItems(value.items, value.site)
      );
    default:
      return false;
  }
}

export function isBridgeContentEvent(
  value: unknown,
): value is BridgeContentEvent {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.type) {
    case BRIDGE_DELIVER_BATCH_TYPE:
      return (
        isTabId(value.sourceTabId) &&
        isBridgeSiteKind(value.site) &&
        isValidSourceKeyForSite(value.site, value.channelLogin) &&
        isValidBatchItems(value.items, value.site)
      );
    case BRIDGE_SOURCE_STATUS_TYPE:
      return (
        isTabId(value.sourceTabId) &&
        (value.status === "active" ||
          value.status === "channel-changed" ||
          value.status === "closed") &&
        (value.channelLogin === undefined ||
          isValidSourceKeyForSite("twitch", value.channelLogin) ||
          isValidSourceKeyForSite("youtube-live", value.channelLogin))
      );
    case BRIDGE_DEMAND_TYPE:
      return (
        typeof value.activeSubscribers === "number" &&
        Number.isInteger(value.activeSubscribers) &&
        value.activeSubscribers >= 0
      );
    default:
      return false;
  }
}

export function isBridgePopoutSnapshot(
  value: unknown,
): value is BridgePopoutSnapshot {
  return (
    isRecord(value) &&
    isBridgeSiteKind(value.localSite) &&
    (value.peerSite === null || isBridgeSiteKind(value.peerSite)) &&
    (value.peerLabel === null || isText(value.peerLabel, 120)) &&
    typeof value.delaySec === "number" &&
    Number.isFinite(value.delaySec) &&
    value.delaySec >= 0 &&
    value.delaySec <= 120 &&
    (value.suspendedReason === null ||
      value.suspendedReason === "pause" ||
      value.suspendedReason === "seek" ||
      value.suspendedReason === "ad") &&
    Array.isArray(value.messages) &&
    value.messages.length <= MAX_BRIDGE_POPOUT_MESSAGES &&
    value.messages.every((item) => isBridgeMessage(item))
  );
}

export function sanitizeBridgePopoutSnapshot(
  snapshot: BridgePopoutSnapshot,
): BridgePopoutSnapshot {
  const clampedDelay = Number.isFinite(snapshot.delaySec)
    ? Math.min(120, Math.max(0, Math.round(snapshot.delaySec)))
    : 0;
  return {
    localSite: snapshot.localSite,
    peerSite: snapshot.peerSite,
    peerLabel:
      typeof snapshot.peerLabel === "string"
        ? snapshot.peerLabel.slice(0, 120)
        : null,
    delaySec: clampedDelay === 0 ? 0 : clampedDelay,
    suspendedReason: snapshot.suspendedReason,
    messages: snapshot.messages
      .slice(-MAX_BRIDGE_POPOUT_MESSAGES)
      .map((item) => sanitizeBridgeMessage(item)),
  };
}

export function isBridgePopoutSyncRequest(
  value: unknown,
): value is BridgePopoutSyncRequest {
  return (
    isRecord(value) &&
    value.type === BRIDGE_POPOUT_SYNC_TYPE &&
    isBridgePopoutSnapshot(value.snapshot)
  );
}

export function isBridgePopoutSubscribeRequest(
  value: unknown,
): value is BridgePopoutSubscribeRequest {
  return (
    isRecord(value) &&
    value.type === BRIDGE_POPOUT_SUBSCRIBE_TYPE &&
    isBridgeSiteKind(value.site)
  );
}

export function isBridgePopoutUpdateEvent(
  value: unknown,
): value is BridgePopoutUpdateEvent {
  return (
    isRecord(value) &&
    value.type === BRIDGE_POPOUT_UPDATE_TYPE &&
    (value.snapshot === null || isBridgePopoutSnapshot(value.snapshot))
  );
}

export function isTrustedBridgeSender(
  sender: BridgeSenderInfo | undefined,
  expectedHost: "twitch" | "youtube",
): sender is {
  id: string;
  url?: string;
  frameId?: number;
  tab: { id: number; url?: string };
} {
  if (!isTrustedExtensionSender(sender)) {
    return false;
  }
  if (!sender?.tab || !isTabId(sender.tab.id)) {
    return false;
  }
  if (sender.frameId !== undefined && sender.frameId !== 0) {
    return false;
  }
  const rawUrl =
    typeof sender.url === "string" && sender.url ? sender.url : sender.tab.url;
  if (typeof rawUrl !== "string" || !rawUrl) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") {
      return false;
    }
    return expectedHost === "twitch"
      ? isTwitchHost(parsed.hostname)
      : isYouTubeHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function resolveTrustedBridgeSenderSite(
  sender: BridgeSenderInfo | undefined,
): SiteKind | null {
  if (isTrustedBridgeSender(sender, "twitch")) {
    return "twitch";
  }
  if (isTrustedBridgeSender(sender, "youtube")) {
    return "youtube-live";
  }
  return null;
}

export function isTrustedBridgePopoutSender(
  sender: BridgeSenderInfo | undefined,
): sender is {
  id: string;
  url?: string;
  frameId?: number;
  tab: { id: number; url?: string };
} {
  if (!isTrustedExtensionSender(sender)) {
    return false;
  }
  if (!sender?.tab || !isTabId(sender.tab.id)) {
    return false;
  }
  if (sender.frameId !== undefined && sender.frameId !== 0) {
    return false;
  }
  const rawUrl =
    typeof sender.url === "string" && sender.url ? sender.url : sender.tab.url;
  if (typeof rawUrl !== "string" || !rawUrl) {
    return false;
  }
  let expectedUrl: string | undefined;
  try {
    expectedUrl =
      typeof browser !== "undefined"
        ? browser.runtime?.getURL?.("/bridge-popout.html")
        : undefined;
  } catch {
    return false;
  }
  if (typeof expectedUrl !== "string" || !expectedUrl) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    const expected = new URL(expectedUrl);
    return (
      parsed.protocol === expected.protocol &&
      parsed.host === expected.host &&
      parsed.pathname === expected.pathname
    );
  } catch {
    return false;
  }
}
