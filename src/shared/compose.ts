import { t } from "./i18n";
import type { UiLocale } from "./settings";
/** Share IME-safe submission and retain drafts until the native UI accepts them. */
export function bindCompose(
  form: HTMLFormElement,
  input: HTMLTextAreaElement,
  send: (text: string) => Promise<boolean>,
  onSuccess?: () => void,
  getLocale: () => UiLocale = () => "auto",
): () => void {
  const status = input.ownerDocument.createElement("span");
  status.setAttribute("role", "status");
  status.className = "fce-compose-status";
  status.style.gridColumn = "1 / -1";
  status.hidden = true;
  form.appendChild(status);
  const fail = () => {
    input.setAttribute("aria-invalid", "true");
    status.textContent = t(getLocale(), "sendFailed");
    status.hidden = false;
  };
  let disposed = false;
  let pending = false;
  const onSubmit = (event: Event) => {
    event.preventDefault();
    const draft = input.value;
    const text = draft.trim();
    if (pending || !text || input.disabled || input.style.display === "none")
      return;
    pending = true;
    form.setAttribute("aria-busy", "true");
    status.hidden = true;
    input.removeAttribute("aria-invalid");
    void Promise.resolve()
      .then(() => (disposed ? false : send(text)))
      .then((ok) => {
        if (disposed) return;
        if (ok) {
          if (input.value === draft) {
            input.value = "";
            onSuccess?.();
          }
        } else {
          fail();
        }
      })
      .catch(() => {
        if (!disposed) fail();
      })
      .finally(() => {
        pending = false;
        if (!disposed) form.removeAttribute("aria-busy");
      });
  };
  const onKey = (event: KeyboardEvent) => {
    // keyCode 229 also covers older IME implementations during confirmation.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  };
  const onInput = () => {
    input.removeAttribute("aria-invalid");
    status.hidden = true;
  };
  form.addEventListener("submit", onSubmit);
  input.addEventListener("keydown", onKey);
  input.addEventListener("input", onInput);
  return () => {
    disposed = true;
    status.remove();
    form.removeEventListener("submit", onSubmit);
    input.removeEventListener("keydown", onKey);
    input.removeEventListener("input", onInput);
  };
}
