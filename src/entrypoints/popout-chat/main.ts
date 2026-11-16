import { bindCompose } from "../../shared/compose";
import { ensureLocale, t } from "../../shared/i18n";
import {
  EXTENSION_CHAT_PUSH_TYPE,
  EXTENSION_CHAT_READY_TYPE,
  EXTENSION_CHAT_SEND_TYPE,
  isExtensionChatRuntimeMessage,
  type ExtensionChatRow,
} from "../../shared/runtime-messages";
import { loadSettings, type UiLocale } from "../../shared/settings";

const headerEl = document.getElementById("header");
const listEl = document.getElementById("list");
const formEl = document.getElementById("compose") as HTMLFormElement | null;
const inputEl = document.getElementById("input") as HTMLTextAreaElement | null;
const sendEl = document.getElementById("send");

let uiLocale: UiLocale = "auto";
let lastMessages: ExtensionChatRow[] = [];

void bootstrap();

browser.runtime.onMessage.addListener((message) => {
  if (!isExtensionChatRuntimeMessage(message)) {
    return;
  }
  if (message.type === EXTENSION_CHAT_PUSH_TYPE) {
    lastMessages = Array.isArray(message.messages) ? message.messages : [];
    render(lastMessages);
  }
});

function bootstrap(): void {
  if (!formEl || !inputEl) {
    return;
  }
  bindCompose(
    formEl,
    inputEl,
    async (text) => {
      try {
        await browser.runtime.sendMessage({
          type: EXTENSION_CHAT_SEND_TYPE,
          text,
        });
        return true;
      } catch {
        return false;
      }
    },
    undefined,
    () => uiLocale,
  );
  void loadSettings().then(async (settings) => {
    await ensureLocale(settings.uiLocale);
    uiLocale = settings.uiLocale;
    if (headerEl) {
      headerEl.textContent = t(settings.uiLocale, "appName");
    }
    if (inputEl) {
      inputEl.placeholder = t(settings.uiLocale, "composePlaceholder");
    }
    if (sendEl) {
      sendEl.textContent = t(settings.uiLocale, "composeSend");
    }
  });
  void browser.runtime
    .sendMessage({ type: EXTENSION_CHAT_READY_TYPE })
    .catch(() => undefined);
  render(lastMessages);
}

function render(messages: ExtensionChatRow[]): void {
  if (!listEl) {
    return;
  }
  listEl.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const message of messages.slice(-200)) {
    const row = document.createElement("div");
    row.className = "fce-ext-chat-row";
    const author = document.createElement("div");
    author.className = "fce-ext-chat-author";
    author.textContent = message.authorName;
    const text = document.createElement("div");
    text.className = "fce-ext-chat-text";
    text.textContent = message.text;
    row.append(author, text);
    fragment.appendChild(row);
  }
  listEl.appendChild(fragment);
  listEl.scrollTop = listEl.scrollHeight;
}
