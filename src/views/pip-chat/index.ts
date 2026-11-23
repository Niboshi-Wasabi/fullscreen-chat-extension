import { bindCompose } from "../../shared/compose";
/**
 * Document Picture-in-Picture chat surface (always-on-top where supported).
 * Document PiP で表示するチャット（対応ブラウザでは常時前面）。
 */

import type { MessageSegment, NormalizedMessage } from "../../core/message";
import { ensureLocale, t } from "../../shared/i18n";
import { isAllowedNativeChatEmbedUrl } from "../../shared/runtime-messages";
import { isSafeHttpsImageUrl } from "../../shared/safe-image-url";
import {
  loadSettings,
  watchSettings,
  type ExtensionSettings,
  type UiLocale,
} from "../../shared/settings";
import { createSiteBadge } from "../../ui/site-icons";

const NATIVE_CHAT_DISABLED_RE =
  /チャットは無効|chat is disabled|chat has been disabled|チャットをご利用いただけません/i;

export interface PipChatController {
  open(): Promise<boolean>;
  close(): void;
  isOpen(): boolean;
  isOpening?(): boolean;
  setMessages(messages: NormalizedMessage[]): void;
  /** Official chat iframe instead of the list; null keeps the list.
   * 一覧の代わりに出す公式チャット iframe。null なら一覧のまま。 */
  setNativeChatUrl(url: string | null): void;
  setBridgeMode?(options: {
    active: boolean;
    headerLabel?: string;
    readOnly?: boolean;
  }): void;
  focusCompose(): void;
}

interface DocumentPipWindow extends Window {
  documentPictureInPicture?: {
    requestWindow: (options?: {
      width?: number;
      height?: number;
    }) => Promise<Window>;
  };
}

export function isDocumentPipAvailable(): boolean {
  const root = window as DocumentPipWindow;
  return typeof root.documentPictureInPicture?.requestWindow === "function";
}

export function createPipChatController(options: {
  onSend: (text: string) => Promise<boolean>;
  /** The PiP window closed without `close()` — by the user or opener unload.
   * `close()` 以外で PiP 窓が閉じた。利用者操作か、開いた側のページ離脱。 */
  onClosedExternally?: () => void;
  onNativeChatRejected?: () => void;
}): PipChatController {
  let uiLocale: UiLocale = "auto";
  let composeEnabled = true;
  let maxVisible = 200;
  let unbindCompose: (() => void) | null = null;
  let unwatchSettings: (() => void) | null = null;
  let pipWindow: Window | null = null;
  let headerEl: HTMLElement | null = null;
  let listEl: HTMLElement | null = null;
  let formEl: HTMLFormElement | null = null;
  let nativeFrame: HTMLIFrameElement | null = null;
  let inputEl: HTMLTextAreaElement | null = null;
  let lastMessages: NormalizedMessage[] = [];
  let nativeUrl: string | null = null;
  let bridgeActive = false;
  let bridgeHeaderLabel: string | null = null;
  let bridgeReadOnly = false;
  let generation = 0;
  let opening: Promise<boolean> | null = null;

  return {
    open() {
      if (pipWindow && !pipWindow.closed) {
        render(lastMessages);
        return Promise.resolve(true);
      }
      if (opening) return opening;
      if (!isDocumentPipAvailable()) {
        return Promise.resolve(false);
      }
      const requested = ++generation;
      const task = (async () => {
        let stage: "requestWindow" | "buildUi" = "requestWindow";
        try {
          const api = (window as DocumentPipWindow).documentPictureInPicture!;
          const opened = await api.requestWindow({ width: 400, height: 640 });
          stage = "buildUi";
          if (requested !== generation) {
            if (opened !== pipWindow && !opened.closed) opened.close();
            return false;
          }
          pipWindow = opened;
          buildListUi(pipWindow);
          render(lastMessages);
          pipWindow.addEventListener("pagehide", () => {
            if (pipWindow !== opened) return;
            generation++;
            teardownUi();
            pipWindow = null;
            options.onClosedExternally?.();
          });
          return true;
        } catch (error) {
          if (requested !== generation) return false;
          if (!(stage === "requestWindow" && isNotAllowedError(error))) {
            console.warn(
              `[fce] Document PiP open failed (${stage}): ${formatPipError(error)}`,
            );
          }
          teardownUi();
          const current = pipWindow;
          pipWindow = null;
          if (current && !current.closed) current.close();
          return false;
        }
      })();
      const pending = task.finally(() => {
        if (opening === pending) opening = null;
      });
      opening = pending;
      return pending;
    },
    close() {
      closeInternal();
    },
    isOpen() {
      return Boolean(pipWindow && !pipWindow.closed);
    },
    isOpening() {
      return opening !== null;
    },
    focusCompose() {
      if (nativeUrl) {
        nativeFrame?.focus();
        return;
      }
      inputEl?.focus();
    },
    setMessages(messages) {
      lastMessages = messages;
      render(messages);
    },
    setNativeChatUrl(url) {
      nativeUrl = url && isAllowedNativeChatEmbedUrl(url) ? url : null;
      renderSurface();
    },
    setBridgeMode(next) {
      bridgeActive = next.active;
      bridgeHeaderLabel = next.headerLabel ?? null;
      bridgeReadOnly = Boolean(next.readOnly);
      syncHeaderText(uiLocale);
      renderSurface();
      render(lastMessages);
    },
  };

  function closeInternal(): void {
    generation++;
    opening = null;
    teardownUi();
    const current = pipWindow;
    pipWindow = null;
    if (current && !current.closed) current.close();
  }

  function teardownUi(): void {
    unwatchSettings?.();
    unwatchSettings = null;
    unbindCompose?.();
    unbindCompose = null;
    headerEl = null;
    listEl = null;
    formEl = null;
    nativeFrame = null;
    inputEl = null;
  }

  function syncHeaderText(locale: UiLocale): void {
    if (!headerEl) {
      return;
    }
    const base = t(locale, "appName");
    headerEl.textContent =
      bridgeActive && bridgeHeaderLabel
        ? `${base} — ${bridgeHeaderLabel}`
        : base;
  }

  function renderSurface(): void {
    if (!listEl || !formEl || !nativeFrame) {
      return;
    }
    const url = nativeUrl;
    listEl.hidden = url !== null;
    formEl.hidden = url !== null || !composeEnabled || bridgeReadOnly;
    nativeFrame.hidden = url === null;
    if (url !== null) {
      if (nativeFrame.dataset.src !== url) {
        nativeFrame.src = url;
        nativeFrame.dataset.src = url;
      }
      return;
    }
    if (nativeFrame.dataset.src) {
      nativeFrame.src = "about:blank";
      delete nativeFrame.dataset.src;
    }
  }

  function buildListUi(target: Window): void {
    const doc = target.document;
    doc.head.replaceChildren();
    const style = doc.createElement("style");
    style.textContent = PIP_CHAT_CSS;
    doc.head.appendChild(style);

    doc.body.replaceChildren();
    doc.body.className = "fce-pip-body";

    const header = doc.createElement("header");
    header.className = "fce-pip-header";
    headerEl = header;

    listEl = doc.createElement("div");
    listEl.className = "fce-pip-list";
    listEl.setAttribute("role", "log");

    nativeFrame = doc.createElement("iframe");
    nativeFrame.className = "fce-pip-native";
    nativeFrame.title = "Official chat";
    nativeFrame.allow = "clipboard-write";
    nativeFrame.hidden = true;
    nativeFrame.addEventListener("load", () => {
      if (!nativeFrame || nativeUrl === null) {
        return;
      }
      try {
        const text = nativeFrame.contentDocument?.body?.textContent ?? "";
        if (NATIVE_CHAT_DISABLED_RE.test(text)) {
          options.onNativeChatRejected?.();
        }
      } catch {
        // Cross-origin: cannot inspect; keep native mode.
      }
    });

    const form = doc.createElement("form");
    form.className = "fce-pip-compose";
    formEl = form;
    inputEl = doc.createElement("textarea");
    inputEl.rows = 2;
    inputEl.maxLength = 500;
    const send = doc.createElement("button");
    send.type = "submit";
    form.append(inputEl, send);
    unbindCompose = bindCompose(
      form,
      inputEl,
      options.onSend,
      undefined,
      () => uiLocale,
    );

    doc.body.append(header, listEl, nativeFrame, form);
    renderSurface();
    let settingsRevision = 0;
    const applySettings = (settings: ExtensionSettings) => {
      if (pipWindow !== target) return;
      const requested = ++settingsRevision;
      uiLocale = settings.uiLocale;
      composeEnabled = settings.compose.enabled;
      maxVisible = settings.filter.maxVisible;
      renderSurface();
      render(lastMessages);
      void ensureLocale(settings.uiLocale)
        .then(() => {
          if (pipWindow !== target || requested !== settingsRevision) return;
          syncHeaderText(settings.uiLocale);
          if (inputEl)
            inputEl.placeholder = t(settings.uiLocale, "composePlaceholder");
          send.textContent = t(settings.uiLocale, "composeSend");
        })
        .catch((error: unknown) =>
          console.warn("[fce] pip locale failed", error),
        );
    };
    unwatchSettings = watchSettings(applySettings);
    const initialRevision = settingsRevision;
    void loadSettings()
      .then((settings) => {
        // A newer storage notification is authoritative. / 初期値の読み込みが遅れても、新しい設定通知の値を上書きしない。
        if (settingsRevision === initialRevision) applySettings(settings);
      })
      .catch((error: unknown) =>
        console.warn("[fce] pip loadSettings failed", error),
      );
  }

  function render(messages: NormalizedMessage[]): void {
    if (!listEl || !pipWindow || pipWindow.closed) {
      return;
    }
    const doc = pipWindow.document;
    listEl.replaceChildren();
    const fragment = doc.createDocumentFragment();
    for (const message of messages.slice(-maxVisible)) {
      const row = doc.createElement("div");
      row.className = "fce-pip-row";
      row.dataset.site = message.site;
      const author = doc.createElement("div");
      author.className = "fce-pip-author";
      if (bridgeActive) {
        author.appendChild(
          createSiteBadge(message.site, "fce-pip-site-badge", doc),
        );
      }
      author.appendChild(doc.createTextNode(message.authorName));
      const text = doc.createElement("div");
      text.className = "fce-pip-text";
      if (message.segments?.length) {
        appendPipMessageSegments(doc, text, message.segments);
      } else {
        text.textContent = message.text;
      }
      row.append(author, text);
      fragment.appendChild(row);
    }
    listEl.appendChild(fragment);
    listEl.scrollTop = listEl.scrollHeight;
  }
}

function isNotAllowedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "NotAllowedError"
  );
}

function formatPipError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const name =
      "name" in error && typeof error.name === "string" && error.name
        ? error.name
        : "";
    const message =
      "message" in error && typeof error.message === "string" && error.message
        ? error.message
        : "";
    if (name && message) return `${name}: ${message}`;
    if (name) return name;
    if (message) return message;
  }
  return String(error);
}

function appendPipMessageSegments(
  doc: Document,
  body: HTMLElement,
  segments: MessageSegment[],
): void {
  for (const segment of segments) {
    if (segment.type === "text") {
      if (segment.text) {
        body.appendChild(doc.createTextNode(segment.text));
      }
      continue;
    }
    if (!isSafeHttpsImageUrl(segment.src)) {
      body.appendChild(
        doc.createTextNode(segment.alt ? `:${segment.alt}:` : "✦"),
      );
      continue;
    }
    const img = doc.createElement("img");
    img.className = "fce-pip-emoji";
    img.src = segment.src;
    img.alt = segment.alt || "emoji";
    img.title = segment.alt || "";
    body.appendChild(img);
  }
}

const PIP_CHAT_CSS = `
html, body { margin: 0; height: 100%; }
.fce-pip-body {
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 100%;
  background: #121212;
  color: #f2f2f2;
  font: 13px/1.4 "Segoe UI", Meiryo, sans-serif;
}
.fce-pip-header {
  padding: 10px 12px;
  border-bottom: 1px solid #2a2a2a;
  font-weight: 700;
  font-size: 13px;
}
.fce-pip-list {
  overflow: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fce-pip-native { width: 100%; height: 100%; border: 0; }
.fce-pip-body [hidden] { display: none !important; }
.fce-pip-row { display: grid; gap: 2px; }
.fce-pip-author {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #9a9a9a;
  font-weight: 600;
}
.fce-pip-site-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.fce-pip-site-badge svg {
  display: block;
  width: 100%;
  height: 100%;
}
.fce-pip-text { word-break: break-word; }
.fce-pip-emoji {
  width: 1.15em;
  height: 1.15em;
  vertical-align: -0.15em;
  margin-inline: 0.1em;
  object-fit: contain;
}
.fce-pip-compose {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid #2a2a2a;
}
.fce-pip-compose textarea {
  resize: vertical;
  min-height: 40px;
  border: 1px solid #333;
  border-radius: 8px;
  background: #1a1a1a;
  color: #f2f2f2;
  padding: 8px;
  font: inherit;
}
.fce-pip-compose button {
  align-self: end;
  min-height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: #3b82f6;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}
`;
