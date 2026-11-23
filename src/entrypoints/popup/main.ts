import { applyDomI18n } from "../../ui/dom-i18n";
import { hydrateSiteIcons } from "../../ui/hydrate-site-icons";
import { populateLocaleSelect } from "../../ui/locale-select";
import {
  loadSettings,
  parseUiLocale,
  saveSettings,
  type DisplayMode,
} from "../../shared/settings";

hydrateSiteIcons();

const enabledInput = document.querySelector<HTMLInputElement>("#enabled");
const youtubeLiveInput =
  document.querySelector<HTMLInputElement>("#youtubeLive");
const twitchInput = document.querySelector<HTMLInputElement>("#twitch");
const uiLocaleSelect = document.querySelector<HTMLSelectElement>("#uiLocale");
const openOptions = document.querySelector<HTMLButtonElement>("#openOptions");
const modeRadios = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="displayMode"]'),
);

async function refresh(): Promise<void> {
  const settings = await loadSettings();
  if (uiLocaleSelect) {
    populateLocaleSelect(uiLocaleSelect);
  }
  await applyDomI18n(settings.uiLocale, "appName");
  if (enabledInput) {
    enabledInput.checked = settings.enabled;
  }
  for (const radio of modeRadios) {
    radio.checked = radio.value === settings.displayMode;
  }
  if (youtubeLiveInput) {
    youtubeLiveInput.checked = settings.youtubeLive.enabled;
  }
  if (twitchInput) {
    twitchInput.checked = settings.twitch.enabled;
  }
  if (uiLocaleSelect) {
    uiLocaleSelect.value = settings.uiLocale;
  }
}

enabledInput?.addEventListener("change", () => {
  void saveSettings({ enabled: Boolean(enabledInput.checked) });
});

for (const radio of modeRadios) {
  radio.addEventListener("change", () => {
    if (!radio.checked) {
      return;
    }
    void saveSettings({ displayMode: radio.value as DisplayMode });
  });
}

youtubeLiveInput?.addEventListener("change", () => {
  void saveSettings({
    youtubeLive: { enabled: Boolean(youtubeLiveInput.checked) },
  });
});

twitchInput?.addEventListener("change", () => {
  void saveSettings({ twitch: { enabled: Boolean(twitchInput.checked) } });
});

uiLocaleSelect?.addEventListener("change", () => {
  const nextLocale = parseUiLocale(uiLocaleSelect.value);
  void saveSettings({ uiLocale: nextLocale }).then(async () => {
    await applyDomI18n(nextLocale, "appName");
  });
});

openOptions?.addEventListener("click", () => {
  void browser.runtime.openOptionsPage();
});

void refresh();
