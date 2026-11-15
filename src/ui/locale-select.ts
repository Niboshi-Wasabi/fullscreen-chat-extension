import { listLocaleOptions } from "../shared/i18n";

/**
 * Fill a language `<select>` once — Auto stays i18n'd; other labels are native names.
 * 言語セレクトを一度だけ埋める。Auto は i18n、他は自称ラベル。
 */
export function populateLocaleSelect(select: HTMLSelectElement): void {
  if (select.dataset.fceLocaleReady === "1") {
    return;
  }
  const autoOption = select.querySelector<HTMLOptionElement>(
    'option[value="auto"]',
  );
  select.replaceChildren();
  if (autoOption) {
    select.append(autoOption);
  } else {
    const created = document.createElement("option");
    created.value = "auto";
    created.dataset.i18n = "localeAuto";
    created.textContent = "Auto";
    select.append(created);
  }
  for (const { code, label } of listLocaleOptions()) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = label;
    select.append(option);
  }
  select.dataset.fceLocaleReady = "1";
}
