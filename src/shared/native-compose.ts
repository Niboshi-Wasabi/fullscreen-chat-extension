/** Use the native value setter (including iframe realms and React-controlled inputs). */
export function fillNativeInput(input: HTMLElement, text: string): boolean {
  if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
    const field = input as HTMLInputElement | HTMLTextAreaElement;
    if (field.disabled || field.readOnly) return false;
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(field),
      "value",
    )?.set;
    if (!setter) return false;
    field.focus();
    setter.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  if (!input.isContentEditable) return false;
  input.focus();
  input.textContent = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
  return true;
}

export function canClickNativeButton(
  button: Element | null,
): button is HTMLElement {
  return (
    !!button &&
    typeof (button as HTMLElement).click === "function" &&
    !button.hasAttribute("disabled") &&
    button.getAttribute("aria-disabled") !== "true"
  );
}
