import type {
  MessageSegment,
  NormalizedMessage,
  SiteKind,
} from "../../core/message";
import {
  BRIDGE_POPOUT_SUBSCRIBE_TYPE,
  isBridgePopoutUpdateEvent,
  type BridgePopoutSnapshot,
  type BridgePopoutSubscribeResponse,
} from "../../shared/bridge-messages";
import { ensureLocale, t } from "../../shared/i18n";
import "../../shared/i18n/register-lazy-locales";
import { isSafeHttpsImageUrl } from "../../shared/safe-image-url";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  watchSettings,
  type ExtensionSettings,
} from "../../shared/settings";
import { isTrustedExtensionSender } from "../../shared/trusted-sender";
import { createSiteBadge } from "../../ui/site-icons";

const titleEl = document.querySelector<HTMLElement>("#popoutTitle");
const peerEl = document.querySelector<HTMLElement>("#popoutPeer");
const readOnlyEl = document.querySelector<HTMLElement>("#popoutReadOnly");
const delayEl = document.querySelector<HTMLElement>("#popoutDelay");
const bannerEl = document.querySelector<HTMLElement>("#popoutBanner");
const listEl = document.querySelector<HTMLElement>("#popoutList");

const siteParam = new URLSearchParams(location.search).get("site");
const localSite: SiteKind = siteParam === "twitch" ? "twitch" : "youtube-live";

let settings: ExtensionSettings = structuredClone(DEFAULT_SETTINGS);
let currentSnapshot: BridgePopoutSnapshot | null = null;
let subscribeInFlight: Promise<void> | null = null;

function renderChrome(): void {
  const locale = settings.uiLocale;
  const appName = t(locale, "appName");
  document.title = appName;
  if (titleEl) {
    titleEl.textContent = appName;
    titleEl.title = appName;
  }
  if (readOnlyEl) {
    readOnlyEl.textContent = t(locale, "bridgeReadOnly");
  }
  if (peerEl) {
    if (currentSnapshot?.peerLabel) {
      peerEl.hidden = false;
      peerEl.textContent = currentSnapshot.peerLabel;
      peerEl.title = currentSnapshot.peerLabel;
    } else {
      peerEl.hidden = true;
      peerEl.textContent = "";
      peerEl.title = "";
    }
  }
  if (delayEl) {
    const delaySec = currentSnapshot?.delaySec ?? 0;
    const formatted = `+${delaySec}s`;
    delayEl.textContent = formatted;
    delayEl.title = `${t(locale, "bridgeDelayLabel")}: ${formatted}`;
  }
  if (bannerEl) {
    const reason = currentSnapshot?.suspendedReason ?? null;
    if (reason) {
      const key =
        reason === "pause"
          ? "bridgePausedPause"
          : reason === "seek"
            ? "bridgePausedSeek"
            : "bridgePausedAd";
      bannerEl.hidden = false;
      bannerEl.textContent = t(locale, key);
    } else {
      bannerEl.hidden = true;
      bannerEl.textContent = "";
    }
  }
}

function appendSegments(body: HTMLElement, message: NormalizedMessage): void {
  const segments: MessageSegment[] = message.segments?.length
    ? message.segments
    : [{ type: "text", text: message.text }];
  for (const segment of segments) {
    if (segment.type === "text") {
      if (segment.text) {
        body.appendChild(document.createTextNode(segment.text));
      }
      continue;
    }
    if (!isSafeHttpsImageUrl(segment.src)) {
      body.appendChild(
        document.createTextNode(segment.alt ? `:${segment.alt}:` : "✦"),
      );
      continue;
    }
    const img = document.createElement("img");
    img.className = "fce-popout-emoji";
    img.src = segment.src;
    img.alt = segment.alt || "emoji";
    img.title = segment.alt || "";
    body.appendChild(img);
  }
}

function renderMessages(): void {
  if (!listEl) {
    return;
  }
  const wasNearBottom =
    listEl.children.length === 0 ||
    listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight <= 24;
  const maxVisible = settings.filter.maxVisible;
  const rows = (currentSnapshot?.messages ?? []).slice(-maxVisible);
  const fragment = document.createDocumentFragment();
  for (const message of rows) {
    const row = document.createElement("div");
    row.className = "fce-popout-row";
    row.dataset.site = message.site;

    row.appendChild(createSiteBadge(message.site, "fce-popout-site-badge"));

    if (settings.panel.showBadges && message.badgeIcons?.length) {
      const badges = document.createElement("span");
      badges.className = "fce-popout-badges";
      for (const icon of message.badgeIcons) {
        if (!icon.src || !isSafeHttpsImageUrl(icon.src)) {
          continue;
        }
        const img = document.createElement("img");
        img.className = "fce-popout-badge-icon";
        img.src = icon.src;
        img.alt = icon.alt;
        img.title = icon.alt;
        badges.appendChild(img);
      }
      if (badges.childNodes.length > 0) {
        row.appendChild(badges);
      }
    }

    if (settings.panel.showAuthor) {
      const author = document.createElement("span");
      author.className = "fce-popout-author";
      if (message.authorColor) {
        author.style.color = message.authorColor;
      }
      author.textContent =
        message.site === "twitch"
          ? `${message.authorName}: `
          : message.authorName;
      row.appendChild(author);
    }

    const text = document.createElement("span");
    text.className = "fce-popout-text";
    appendSegments(text, message);
    row.appendChild(text);
    fragment.appendChild(row);
  }
  listEl.replaceChildren(fragment);
  if (wasNearBottom) {
    listEl.scrollTop = listEl.scrollHeight;
  }
}

function applySnapshot(snapshot: BridgePopoutSnapshot | null): void {
  currentSnapshot = snapshot;
  renderChrome();
  renderMessages();
}

function subscribeToHub(preserveExisting: boolean): Promise<void> {
  if (subscribeInFlight) {
    return subscribeInFlight;
  }
  subscribeInFlight = (async () => {
    try {
      const reply = (await browser.runtime.sendMessage({
        type: BRIDGE_POPOUT_SUBSCRIBE_TYPE,
        site: localSite,
      })) as BridgePopoutSubscribeResponse | undefined;
      if (
        reply &&
        "snapshot" in reply &&
        (reply.snapshot !== null ||
          (!preserveExisting && currentSnapshot === null))
      ) {
        applySnapshot(reply.snapshot);
      }
    } catch {
      // Background unavailable during teardown.
    } finally {
      subscribeInFlight = null;
    }
  })();
  return subscribeInFlight;
}

async function init(): Promise<void> {
  settings = await loadSettings();
  await ensureLocale(settings.uiLocale);
  renderChrome();

  watchSettings((next) => {
    settings = next;
    void ensureLocale(next.uiLocale).then(() => {
      renderChrome();
      renderMessages();
    });
  });

  browser.runtime.onMessage.addListener((message, sender) => {
    const senderInfo = sender as { id?: string; tab?: unknown };
    if (!isTrustedExtensionSender(senderInfo) || senderInfo.tab !== undefined) {
      return undefined;
    }
    if (
      isBridgePopoutUpdateEvent(message) &&
      (message.snapshot === null || message.snapshot.localSite === localSite)
    ) {
      applySnapshot(message.snapshot);
    }
    return undefined;
  });

  window.addEventListener("focus", () => {
    void subscribeToHub(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void subscribeToHub(true);
    }
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      void subscribeToHub(true);
    }
  });

  await subscribeToHub(false);
}

void init();
