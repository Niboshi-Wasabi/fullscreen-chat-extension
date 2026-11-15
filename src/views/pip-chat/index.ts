import { bindCompose } from "../../shared/compose";
/**
 * Document Picture-in-Picture chat surface (always-on-top where supported).
 * Document PiP チャット面（対応ブラウザでは常時前面）。
 */

import type { NormalizedMessage } from "../../core/message";
import { ensureLocale, t } from "../../shared/i18n";
import { loadSettings, type UiLocale } from "../../shared/settings";

export interface PipChatController {
  open(): Promise<boolean>;
  close(): void;
  isOpen(): boolean;
  setMessages(messages: NormalizedMessage[]): void;
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
}): PipChatController {
  let uiLocale: UiLocale = "auto";
  let unbindCompose: (() => void) | null = null;
  let pipWindow: Window | null = null;
  let listEl: HTMLElement | null = null;
  let inputEl: HTMLTextAreaElement | null = null;
  let lastMessages: NormalizedMessage[] = [];
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
        try {
          const api = (window as DocumentPipWindow).documentPictureInPicture!;
          const opened = await api.requestWindow({ width: 400, height: 640 });
          if (requested !== generation) {
            if (opened !== pipWindow && !opened.closed) opened.close();
            return false;
          }
          pipWindow = opened;
          buildUi(pipWindow);
          render(lastMessages);
          pipWindow.addEventListener("pagehide", () => {
            if (pipWindow !== opened) return;
            generation++;
            unbindCompose?.();
            unbindCompose = null;
            pipWindow = null;
            listEl = null;
            inputEl = null;
          });
          return true;
        } catch (error) {
          if (requested !== generation) return false;
          console.warn("[fce] Document PiP open failed", error);
          unbindCompose?.();
          unbindCompose = null;
          const current = pipWindow;
          pipWindow = null;
          listEl = null;
          inputEl = null;
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
      generation++;
      opening = null;
      unbindCompose?.();
      unbindCompose = null;
      const current = pipWindow;
      pipWindow = null;
      listEl = null;
      inputEl = null;
      if (current && !current.closed) current.close();
    },
    isOpen() {
      return Boolean(pipWindow && !pipWindow.closed);
    },
    focusCompose() {
      inputEl?.focus();
    },
    setMessages(messages) {
      lastMessages = messages;
      render(messages);
    },
  };

  function buildUi(target: Window): void {
    const doc = target.document;
    doc.head.replaceChildren();
    const style = doc.createElement("style");
    style.textContent = PIP_CHAT_CSS;
    doc.head.appendChild(style);

    doc.body.replaceChildren();
    doc.body.className = "fce-pip-body";

    const header = doc.createElement("header");
    header.className = "fce-pip-header";
    void loadSettings().then(async (settings) => {
      await ensureLocale(settings.uiLocale);
      if (pipWindow !== target) return;
      uiLocale = settings.uiLocale;
      header.textContent = t(settings.uiLocale, "appName");
      if (inputEl) {
        inputEl.placeholder = t(settings.uiLocale, "composePlaceholder");
      }
      send.textContent = t(settings.uiLocale, "composeSend");
    });

    listEl = doc.createElement("div");
    listEl.className = "fce-pip-list";
    listEl.setAttribute("role", "log");

    const form = doc.createElement("form");
    form.className = "fce-pip-compose";
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

    doc.body.append(header, listEl, form);
  }

  function render(messages: NormalizedMessage[]): void {
    if (!listEl || !pipWindow || pipWindow.closed) {
      return;
    }
    listEl.replaceChildren();
    const fragment = pipWindow.document.createDocumentFragment();
    for (const message of messages.slice(-200)) {
      const row = pipWindow.document.createElement("div");
      row.className = "fce-pip-row";
      const author = pipWindow.document.createElement("div");
      author.className = "fce-pip-author";
      author.textContent = message.authorName;
      const text = pipWindow.document.createElement("div");
      text.className = "fce-pip-text";
      text.textContent = message.text;
      row.append(author, text);
      fragment.appendChild(row);
    }
    listEl.appendChild(fragment);
    listEl.scrollTop = listEl.scrollHeight;
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
.fce-pip-row { display: grid; gap: 2px; }
.fce-pip-author { font-size: 11px; color: #9a9a9a; font-weight: 600; }
.fce-pip-text { word-break: break-word; }
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
