/** Verify that an internal runtime message came from this extension instance. */
export function isTrustedExtensionSender(
  sender: { id?: string } | undefined,
): boolean {
  try {
    if (typeof browser === "undefined" || !browser.runtime?.id) {
      return false;
    }
    return sender?.id === browser.runtime.id;
  } catch {
    return false;
  }
}
