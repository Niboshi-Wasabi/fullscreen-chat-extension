import { HIDDEN_LIVE_CHAT_FRAME_ID } from "./dom-ids";
import { isTrustedExtensionSender } from "./runtime-messages";

/** Official chat frames handle compose focus without starting another runtime. */
export function bindNativeComposeFocus(): () => void {
  const listener: Parameters<
    typeof browser.runtime.onMessage.addListener
  >[0] = (message, sender) => {
    const senderInfo = sender as { id?: string; tab?: unknown };
    if (!isTrustedExtensionSender(senderInfo) || senderInfo.tab !== undefined) {
      return;
    }
    if (
      !message ||
      typeof message !== "object" ||
      (message as { type?: unknown }).type !== "fce:command" ||
      (message as { command?: unknown }).command !== "toggle-compose-focus"
    )
      return;
    // Off-screen YouTube receivers must never steal focus from the visible UI.
    try {
      if (window.frameElement?.id === HIDDEN_LIVE_CHAT_FRAME_ID) return;
    } catch {
      return;
    }
    document
      .querySelector<HTMLElement>(
        '#input[contenteditable], textarea[data-a-target="chat-input"], [data-a-target="chat-input"][contenteditable]',
      )
      ?.focus();
  };
  try {
    browser.runtime.onMessage.addListener(listener);
  } catch {
    return () => {};
  }
  return () => {
    try {
      browser.runtime.onMessage.removeListener(listener);
    } catch {
      // Extension context may already be invalidated on teardown.
    }
  };
}
