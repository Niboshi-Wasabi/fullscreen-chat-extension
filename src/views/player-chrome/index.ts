import { ensureLocale, t } from "../../shared/i18n";
import {
  loadSettings,
  saveSettings,
  watchSettings,
  type ExtensionSettings,
  type UiLocale,
} from "../../shared/settings";

const BUTTON_ID = "fce-player-toggle";
const STYLE_ID = "fce-player-chrome-style";

/** Product mark: fullscreen corners + chat bubble / 製品マーク：四隅＋吹き出し */
const TOGGLE_ICON_SVG = `<svg class="fce-player-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M3.8 8.5V4.2h4.3M20.2 8.5V4.2h-4.3M3.8 15.5v4.3h4.3M20.2 15.5v4.3h-4.3"/>
  <path fill="currentColor" d="M7 8h10a1.8 1.8 0 0 1 1.8 1.8v5.2A1.8 1.8 0 0 1 17 16.8h-5.6L7 20V8z"/>
  <path fill="#061018" fill-opacity="0.28" d="M9.2 10.6h5.6v1.15H9.2zm0 2.35h3.9v1.15H9.2z"/>
</svg>`;

export type PlayerChromeSite = "youtube" | "twitch";

/**
 * Control-bar toggle beside the seek/progress strip (right controls).
 * Survives `enabled: false` so the user can turn FCE back on.
 * シーク／プログレス付近の右コントロールへ置くトグル。`enabled: false` でも再有効化可。
 */
export function startPlayerChrome(site: PlayerChromeSite): () => void {
  let disposed = false;
  let settings: ExtensionSettings | null = null;
  let injectTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleInject = () => {
    window.clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      if (!disposed && settings) {
        ensureButton(site, settings);
      }
    }, 200);
  };

  const observer = new MutationObserver(() => {
    scheduleInject();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  const unwatch = watchSettings((next) => {
    settings = next;
    void ensureLocale(next.uiLocale).then(() => {
      if (!disposed && settings === next) {
        ensureButton(site, next);
      }
    });
  });

  void loadSettings().then(async (initial) => {
    if (disposed) {
      return;
    }
    settings = initial;
    await ensureLocale(initial.uiLocale);
    if (!disposed) {
      ensureButton(site, initial);
    }
  });

  const onFullscreen = () => scheduleInject();
  document.addEventListener("fullscreenchange", onFullscreen);

  return () => {
    disposed = true;
    unwatch();
    observer.disconnect();
    window.clearTimeout(injectTimer);
    document.removeEventListener("fullscreenchange", onFullscreen);
    document.getElementById(BUTTON_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  };
}

function ensureButton(
  site: PlayerChromeSite,
  settings: ExtensionSettings,
): void {
  ensureStyles();
  const mount = resolveControlsMount(site);
  if (!mount) {
    return;
  }

  let button = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (!button) {
    button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = classNameForSite(site);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void toggleEnabled();
    });
    mountButton(mount, button, site);
  } else if (button.parentElement !== mount) {
    mountButton(mount, button, site);
  }

  applyButtonState(button, settings.uiLocale, settings.enabled);
}

function classNameForSite(site: PlayerChromeSite): string {
  if (site === "youtube") {
    return "ytp-button fce-player-toggle";
  }
  return "fce-player-toggle fce-player-toggle--twitch";
}

/**
 * Prefer left of settings / fullscreen so the control sits in the familiar cluster.
 * 設定・全画面の左に置き、いつもの右コントロール群に乗せる。
 */
function mountButton(
  mount: HTMLElement,
  button: HTMLButtonElement,
  site: PlayerChromeSite,
): void {
  const anchor = resolveInsertAnchor(mount, site);
  if (anchor && anchor.parentElement === mount) {
    mount.insertBefore(button, anchor);
    return;
  }
  mount.appendChild(button);
}

function resolveInsertAnchor(
  mount: HTMLElement,
  site: PlayerChromeSite,
): Element | null {
  if (site === "youtube") {
    return (
      mount.querySelector(".ytp-settings-button") ??
      mount.querySelector(".ytp-fullscreen-button") ??
      mount.querySelector(".ytp-size-button")
    );
  }
  return (
    mount.querySelector('[data-a-target="player-settings-button"]') ??
    mount.querySelector('[data-a-target="player-fullscreen-button"]') ??
    mount.querySelector('button[aria-label*="Settings" i]') ??
    mount.querySelector('button[aria-label*="設定"]')
  );
}

async function toggleEnabled(): Promise<void> {
  const current = await loadSettings();
  await saveSettings({ enabled: !current.enabled });
}

function applyButtonState(
  button: HTMLButtonElement,
  uiLocale: UiLocale,
  enabled: boolean,
): void {
  const enabledKey = enabled ? "1" : "0";
  const needsMarkup =
    button.dataset.enabled !== enabledKey ||
    !button.querySelector(".fce-player-toggle-icon");
  const label = t(uiLocale, enabled ? "playerToggleOn" : "playerToggleOff");
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", enabled ? "true" : "false");
  button.dataset.enabled = enabledKey;
  if (!needsMarkup) {
    const badge = button.querySelector(".fce-player-toggle-badge");
    if (badge) {
      badge.textContent = enabled ? "ON" : "OFF";
    }
    return;
  }
  button.innerHTML = `${TOGGLE_ICON_SVG}<span class="fce-player-toggle-badge" aria-hidden="true">${enabled ? "ON" : "OFF"}</span>`;
}

function resolveControlsMount(site: PlayerChromeSite): HTMLElement | null {
  if (site === "youtube") {
    return (
      document.querySelector<HTMLElement>(".ytp-right-controls") ??
      document.querySelector<HTMLElement>(".ytp-chrome-controls")
    );
  }
  return (
    document.querySelector<HTMLElement>(
      ".player-controls__right-control-group",
    ) ??
    document.querySelector<HTMLElement>(
      "[data-a-target='player-controls'] .player-controls__right-control-group",
    ) ??
    document.querySelector<HTMLElement>(
      "[data-a-target='player-overlay-click-handler']",
    )?.parentElement ??
    null
  );
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .fce-player-toggle {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 100%;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: #fff;
      cursor: pointer;
      opacity: 0.92;
      vertical-align: top;
    }
    .fce-player-toggle:hover,
    .fce-player-toggle:focus-visible {
      opacity: 1;
    }
    .fce-player-toggle:focus-visible {
      outline: 2px solid #4ea1ff;
      outline-offset: 2px;
    }
    .fce-player-toggle-icon {
      width: 24px;
      height: 24px;
      display: block;
      flex-shrink: 0;
    }
    .fce-player-toggle-badge {
      position: absolute;
      right: 2px;
      bottom: 6px;
      font: 700 7px/1 system-ui, "Segoe UI", sans-serif;
      letter-spacing: 0.03em;
      padding: 2px 3px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.18);
      color: #fff;
      min-width: 18px;
      text-align: center;
      box-sizing: border-box;
      pointer-events: none;
    }
    .fce-player-toggle[data-enabled="1"] {
      color: #7ec2ff;
    }
    .fce-player-toggle[data-enabled="1"] .fce-player-toggle-badge {
      background: #4ea1ff;
      color: #061018;
    }
    .fce-player-toggle[data-enabled="0"] {
      opacity: 0.58;
      color: #d7dde5;
    }
    .fce-player-toggle[data-enabled="0"] .fce-player-toggle-badge {
      background: rgba(255, 255, 255, 0.12);
      color: #c5ccd6;
    }
    .fce-player-toggle--twitch {
      width: 40px;
      height: 40px;
      border-radius: 6px;
      padding: 2px;
    }
    .fce-player-toggle--twitch:hover {
      background: rgba(255, 255, 255, 0.12);
    }
  `;
  document.documentElement.appendChild(style);
}
