/** Official chat frames handle compose focus without starting another runtime. */
export function bindNativeComposeFocus(): () => void {
  const listener: Parameters<
    typeof browser.runtime.onMessage.addListener
  >[0] = (message) => {
    if (
      message?.type !== "fce:command" ||
      message.command !== "toggle-compose-focus"
    )
      return;
    // Off-screen YouTube receivers must never steal focus from the visible UI.
    if (window.frameElement?.id === "fce-hidden-live-chat-frame") return;
    document
      .querySelector<HTMLElement>(
        '#input[contenteditable], textarea[data-a-target="chat-input"], [data-a-target="chat-input"][contenteditable]',
      )
      ?.focus();
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
