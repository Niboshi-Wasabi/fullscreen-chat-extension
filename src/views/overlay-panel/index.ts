import { bindCompose } from "../../shared/compose";
import type { DelaySuspendReason } from "../../core/live-delay-buffer";
import type {
  MessageSegment,
  NormalizedMessage,
  SiteKind,
} from "../../core/message";
import { getFeatureFlags } from "../../shared/feature-flags";
import { ensureLocale, t } from "../../shared/i18n";
import { NATIVE_CHAT_FRAME_ID } from "../../shared/dom-ids";
import { isAllowedNativeChatEmbedUrl } from "../../shared/runtime-messages";
import { isSafeHttpsImageUrl } from "../../shared/safe-image-url";
import type { ExtensionSettings, PanelBounds } from "../../shared/settings";
import { isTwitchVodPage } from "../../shared/site-ids";
import { createSiteBadge } from "../../ui/site-icons";

const HOST_ID = "fce-overlay-panel-host";
const DEFAULT_PANEL_WIDTH_PX = 320;
const DEFAULT_PANEL_HEIGHT_PX = 480;
const MIN_PANEL_WIDTH_PX = 220;
const MIN_PANEL_HEIGHT_PX = 240;

export interface OverlayBridgeSourceOption {
  tabId: number;
  site: SiteKind;
  channelLogin: string;
  label: string;
}

export interface OverlayBridgeCalibrationState {
  status: "idle" | "picking" | "suggested";
  selectedMessageId: string | null;
  suggestedDelaySec: number | null;
}

export interface OverlayBridgeState {
  supported: boolean;
  sources: OverlayBridgeSourceOption[];
  activeSource: OverlayBridgeSourceOption | null;
  delaySec: number;
  suspendedReason: DelaySuspendReason | null;
  calibration: OverlayBridgeCalibrationState;
}

export interface OverlayBridgeHooks {
  onRefreshSources: () => void;
  onSelectSource: (tabId: number | null) => void;
  onAdjustDelay: (deltaSec: number) => void;
  onResume: () => void;
  onDisconnect: () => void;
  onMarkScene: () => void;
  onSelectReaction: (messageId: string) => void;
  onApplySuggestedDelay: () => void;
  onCancelCalibration: () => void;
}

export interface OverlayPanelController {
  mount(parent: HTMLElement): void;
  unmount(): void;
  setMessages(messages: NormalizedMessage[]): void;
  applySettings(settings: ExtensionSettings): void;
  /** Official chat URL for iframe mode; null falls back to custom list.
   * 公式チャット iframe。null のとき自前リストにフォールバック。 */
  setNativeChatUrl(url: string | null): void;
  setBridgeState(state: OverlayBridgeState): void;
  focusCompose(): void;
  /** Reparent under fullscreen element when needed / 全画面要素配下へ再配置 */
  reparentForFullscreen(): void;
}

const NATIVE_CHAT_DISABLED_RE =
  /チャットは無効|chat is disabled|chat has been disabled|チャットをご利用いただけません/i;

export function createOverlayPanel(options: {
  site?: SiteKind;
  onSend: (text: string) => Promise<boolean>;
  onPositionChange?: (position: PanelBounds) => void;
  /** Persist quick visual tweaks from the handle gear / パネルの歯車で変更した表示設定をすぐに保存する */
  onQuickPanelChange?: (patch: Partial<ExtensionSettings["panel"]>) => void;
  onOpenOptions?: () => void;
  /** Runs inside the menu click so Document PiP gets user activation.
   * Document PiP が操作を受け取れるよう、メニューのクリック内で呼ぶ。 */
  onPinOnTop?: () => void;
  /** Official iframe showed a disabled/unavailable chat page (ISS-022).
   * 公式 iframe がチャット無効ページを返したとき。 */
  onNativeChatRejected?: () => void;
  bridge?: OverlayBridgeHooks;
}): OverlayPanelController {
  let unbindCompose: (() => void) | null = null;
  let host: HTMLDivElement | null = null;
  let mountParent: HTMLElement | null = null;
  let panelEl: HTMLDivElement | null = null;
  let handleEl: HTMLDivElement | null = null;
  let gearButton: HTMLButtonElement | null = null;
  let gearMenu: HTMLDivElement | null = null;
  let opacityInput: HTMLInputElement | null = null;
  let fontInput: HTMLInputElement | null = null;
  let opacityAdjusting = false;
  let fontAdjusting = false;
  let bridgeGearRow: HTMLDivElement | null = null;
  let bridgeGearTitle: HTMLSpanElement | null = null;
  let bridgeSelectEl: HTMLSelectElement | null = null;
  let bridgeRefreshButton: HTMLButtonElement | null = null;
  let bridgeBarEl: HTMLDivElement | null = null;
  let bridgeChannelEl: HTMLSpanElement | null = null;
  let bridgeReadOnlyEl: HTMLSpanElement | null = null;
  let bridgeDelayEl: HTMLSpanElement | null = null;
  let bridgeDisconnectButton: HTMLButtonElement | null = null;
  let bridgeCalibrateEl: HTMLDivElement | null = null;
  let bridgeCalibrateStatusEl: HTMLSpanElement | null = null;
  let bridgeMarkButton: HTMLButtonElement | null = null;
  let bridgeApplyButton: HTMLButtonElement | null = null;
  let bridgeCancelButton: HTMLButtonElement | null = null;
  let bridgeMaskEl: HTMLDivElement | null = null;
  let bridgeMaskMessageEl: HTMLParagraphElement | null = null;
  let bridgeResumeButton: HTMLButtonElement | null = null;
  let bridgeMaskDisconnectButton: HTMLButtonElement | null = null;
  let lastSelectSignature = "";
  let bridgeState: OverlayBridgeState = {
    supported: false,
    sources: [],
    activeSource: null,
    delaySec: 0,
    suspendedReason: null,
    calibration: {
      status: "idle",
      selectedMessageId: null,
      suggestedDelaySec: null,
    },
  };
  let listEl: HTMLDivElement | null = null;
  const renderedRows = new Map<
    string,
    { el: HTMLElement; message: NormalizedMessage }
  >();
  let composeEl: HTMLFormElement | null = null;
  let inputEl: HTMLTextAreaElement | null = null;
  let sendButtonEl: HTMLButtonElement | null = null;
  let nativeFrame: HTMLIFrameElement | null = null;
  let nativeUrl: string | null = null;
  let settings: ExtensionSettings | null = null;
  let lastMessages: NormalizedMessage[] = [];
  let stopGearOutsideListener: (() => void) | null = null;
  let dragState: {
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null = null;
  let resizeState: {
    pointerId: number;
    edge: "e" | "s" | "se";
    startX: number;
    startY: number;
    origin: PanelBounds;
  } | null = null;
  const pendingPositions: PanelBounds[] = [];
  let positionBeforeSave: PanelBounds | undefined;
  let suppressNativePointer = false;
  let gearOpen = false;
  let resizeObserver: ResizeObserver | null = null;
  let stopGestureListeners: (() => void) | null = null;

  return {
    mount(parent) {
      mountParent = parent;
      const target = resolveHostTarget(parent);
      if (host && host.isConnected) {
        const reparented = host.parentElement !== target;
        if (reparented) {
          target.appendChild(host);
        }
        ensureHostParentPositioned(target);
        if (reparented && settings) {
          applyVisuals(settings);
        }
        return;
      }
      unmountInternal();
      host = document.createElement("div");
      host.id = HOST_ID;
      host.setAttribute("data-fce-view", "overlay-panel");

      panelEl = document.createElement("div");
      panelEl.className = "fce-panel";
      if (options.site) {
        panelEl.dataset.site = options.site;
      }

      handleEl = document.createElement("div");
      handleEl.className = "fce-panel-handle";
      handleEl.title = "Drag to move";

      const labelEl = document.createElement("span");
      labelEl.className = "fce-panel-handle-label";
      labelEl.textContent = "Chat";

      const handleActions = document.createElement("div");
      handleActions.className = "fce-panel-handle-actions";

      gearButton = document.createElement("button");
      gearButton.type = "button";
      gearButton.className = "fce-panel-gear";
      gearButton.setAttribute("aria-label", "Settings");
      gearButton.setAttribute("aria-expanded", "false");
      gearButton.title = "Settings";
      gearButton.textContent = "⚙";
      gearButton.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      gearButton.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && gearOpen) {
          setGearOpen(false);
        }
      });
      gearButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setGearOpen(!gearOpen);
      });

      const gripEl = document.createElement("span");
      gripEl.className = "fce-panel-handle-grip";
      gripEl.setAttribute("aria-hidden", "true");

      handleActions.append(gearButton, gripEl);
      handleEl.append(labelEl, handleActions);
      bindDragHandle(handleEl);

      const dragEdgeEl = document.createElement("div");
      dragEdgeEl.className = "fce-panel-drag-edge";
      dragEdgeEl.title = "Drag to move";
      bindDragHandle(dragEdgeEl);

      gearMenu = document.createElement("div");
      gearMenu.className = "fce-panel-gear-menu";
      gearMenu.hidden = true;
      gearMenu.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      gearMenu.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && gearOpen) {
          setGearOpen(false);
          gearButton?.focus();
        }
      });

      const opacityRow = document.createElement("label");
      opacityRow.className = "fce-panel-gear-row";
      const opacityTitle = document.createElement("span");
      opacityTitle.textContent = "Opacity";
      opacityInput = document.createElement("input");
      opacityInput.type = "range";
      opacityInput.min = "0.2";
      opacityInput.max = "1";
      opacityInput.step = "0.05";
      opacityInput.addEventListener("pointerdown", () => {
        opacityAdjusting = true;
      });
      opacityInput.addEventListener("input", () => {
        opacityAdjusting = true;
        const opacity = Number(opacityInput?.value ?? 0.85);
        panelEl?.style.setProperty("--fce-panel-opacity", String(opacity));
      });
      opacityInput.addEventListener("change", () => {
        opacityAdjusting = false;
        const opacity = Number(opacityInput?.value ?? 0.85);
        options.onQuickPanelChange?.({ opacity });
      });
      opacityInput.addEventListener("blur", () => {
        opacityAdjusting = false;
      });
      opacityRow.append(opacityTitle, opacityInput);

      const fontRow = document.createElement("label");
      fontRow.className = "fce-panel-gear-row";
      const fontTitle = document.createElement("span");
      fontTitle.textContent = "Font";
      fontInput = document.createElement("input");
      fontInput.type = "range";
      fontInput.min = "10";
      fontInput.max = "28";
      fontInput.step = "1";
      fontInput.addEventListener("pointerdown", () => {
        fontAdjusting = true;
      });
      fontInput.addEventListener("input", () => {
        fontAdjusting = true;
        const fontSizePx = Number(fontInput?.value ?? 14);
        panelEl?.style.setProperty("--fce-panel-font", `${fontSizePx}px`);
      });
      fontInput.addEventListener("change", () => {
        fontAdjusting = false;
        const fontSizePx = Number(fontInput?.value ?? 14);
        options.onQuickPanelChange?.({ fontSizePx });
      });
      fontInput.addEventListener("blur", () => {
        fontAdjusting = false;
      });
      fontRow.append(fontTitle, fontInput);

      const optionsButton = document.createElement("button");
      optionsButton.type = "button";
      optionsButton.className = "fce-panel-gear-options";
      optionsButton.textContent = "Options";
      optionsButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setGearOpen(false);
        options.onOpenOptions?.();
      });

      const pinButton = document.createElement("button");
      pinButton.type = "button";
      pinButton.className = "fce-panel-gear-pin";
      pinButton.textContent = "Pin on top";
      pinButton.hidden = true;
      pinButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.onPinOnTop?.();
        setGearOpen(false);
      });

      bridgeGearRow = document.createElement("div");
      bridgeGearRow.className = "fce-panel-gear-row fce-panel-bridge-row";
      bridgeGearRow.hidden = true;
      swallowPlayerEvents(bridgeGearRow);
      bridgeGearTitle = document.createElement("span");
      bridgeGearTitle.textContent = "Twitch tab";
      const bridgePicker = document.createElement("div");
      bridgePicker.className = "fce-panel-bridge-picker";
      bridgeSelectEl = document.createElement("select");
      bridgeSelectEl.className = "fce-panel-bridge-select";
      bridgeSelectEl.addEventListener("change", () => {
        const raw = bridgeSelectEl?.value ?? "";
        const parsed = raw ? Number(raw) : null;
        const nextTabId =
          parsed !== null && Number.isInteger(parsed) && parsed >= 0
            ? parsed
            : null;
        setGearOpen(false);
        options.bridge?.onSelectSource(nextTabId);
      });
      bridgeRefreshButton = document.createElement("button");
      bridgeRefreshButton.type = "button";
      bridgeRefreshButton.className = "fce-panel-bridge-refresh";
      bridgeRefreshButton.textContent = "↻";
      bridgeRefreshButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.bridge?.onRefreshSources();
      });
      bridgePicker.append(bridgeSelectEl, bridgeRefreshButton);
      bridgeGearRow.append(bridgeGearTitle, bridgePicker);

      gearMenu.append(
        opacityRow,
        fontRow,
        bridgeGearRow,
        pinButton,
        optionsButton,
      );

      bridgeBarEl = document.createElement("div");
      bridgeBarEl.className = "fce-panel-bridge-bar";
      bridgeBarEl.hidden = true;
      swallowPlayerEvents(bridgeBarEl);
      const bridgeInfo = document.createElement("div");
      bridgeInfo.className = "fce-panel-bridge-info";
      bridgeChannelEl = document.createElement("span");
      bridgeChannelEl.className = "fce-panel-bridge-channel";
      bridgeReadOnlyEl = document.createElement("span");
      bridgeReadOnlyEl.className = "fce-panel-bridge-badge";
      bridgeInfo.append(bridgeChannelEl, bridgeReadOnlyEl);

      const bridgeControls = document.createElement("div");
      bridgeControls.className = "fce-panel-bridge-controls";
      for (const delta of [-5, -1]) {
        bridgeControls.appendChild(createDelayStepButton(delta));
      }
      bridgeDelayEl = document.createElement("span");
      bridgeDelayEl.className = "fce-panel-bridge-delay";
      bridgeControls.appendChild(bridgeDelayEl);
      for (const delta of [1, 5]) {
        bridgeControls.appendChild(createDelayStepButton(delta));
      }
      bridgeDisconnectButton = document.createElement("button");
      bridgeDisconnectButton.type = "button";
      bridgeDisconnectButton.className = "fce-panel-bridge-disconnect";
      bridgeDisconnectButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.bridge?.onDisconnect();
      });
      bridgeControls.appendChild(bridgeDisconnectButton);
      bridgeBarEl.append(bridgeInfo, bridgeControls);

      bridgeCalibrateEl = document.createElement("div");
      bridgeCalibrateEl.className = "fce-panel-bridge-calibrate";
      bridgeCalibrateEl.hidden = true;
      swallowPlayerEvents(bridgeCalibrateEl);
      bridgeCalibrateStatusEl = document.createElement("span");
      bridgeCalibrateStatusEl.className = "fce-panel-bridge-calibrate-status";
      bridgeCalibrateStatusEl.setAttribute("aria-live", "polite");
      const bridgeCalibrateActions = document.createElement("div");
      bridgeCalibrateActions.className = "fce-panel-bridge-calibrate-actions";
      bridgeMarkButton = document.createElement("button");
      bridgeMarkButton.type = "button";
      bridgeMarkButton.className = "fce-panel-bridge-mark";
      bridgeMarkButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.bridge?.onMarkScene();
      });
      bridgeApplyButton = document.createElement("button");
      bridgeApplyButton.type = "button";
      bridgeApplyButton.className = "fce-panel-bridge-apply";
      bridgeApplyButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.bridge?.onApplySuggestedDelay();
      });
      bridgeCancelButton = document.createElement("button");
      bridgeCancelButton.type = "button";
      bridgeCancelButton.className = "fce-panel-bridge-cancel";
      bridgeCancelButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.bridge?.onCancelCalibration();
      });
      bridgeCalibrateActions.append(
        bridgeMarkButton,
        bridgeApplyButton,
        bridgeCancelButton,
      );
      bridgeCalibrateEl.append(bridgeCalibrateStatusEl, bridgeCalibrateActions);

      bridgeMaskEl = document.createElement("div");
      bridgeMaskEl.className = "fce-panel-bridge-mask";
      bridgeMaskEl.hidden = true;
      swallowPlayerEvents(bridgeMaskEl);
      bridgeMaskMessageEl = document.createElement("p");
      bridgeMaskMessageEl.className = "fce-panel-bridge-mask-text";
      const bridgeMaskActions = document.createElement("div");
      bridgeMaskActions.className = "fce-panel-bridge-mask-actions";
      bridgeResumeButton = document.createElement("button");
      bridgeResumeButton.type = "button";
      bridgeResumeButton.className = "fce-panel-bridge-resume";
      bridgeResumeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.bridge?.onResume();
      });
      bridgeMaskDisconnectButton = document.createElement("button");
      bridgeMaskDisconnectButton.type = "button";
      bridgeMaskDisconnectButton.className = "fce-panel-bridge-mask-disconnect";
      bridgeMaskDisconnectButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        options.bridge?.onDisconnect();
      });
      bridgeMaskActions.append(bridgeResumeButton, bridgeMaskDisconnectButton);
      bridgeMaskEl.append(bridgeMaskMessageEl, bridgeMaskActions);

      listEl = document.createElement("div");
      listEl.className = "fce-panel-list";
      listEl.setAttribute("role", "log");
      listEl.setAttribute("aria-live", "polite");
      const swallowListInteraction = (event: Event) => {
        if (hasActiveBridge()) {
          event.stopPropagation();
        }
      };
      listEl.addEventListener("pointerdown", swallowListInteraction);
      listEl.addEventListener("mousedown", swallowListInteraction);
      listEl.addEventListener("dblclick", swallowListInteraction);
      listEl.addEventListener("click", (event) => {
        if (hasActiveBridge()) {
          event.stopPropagation();
        }
        if (!isCalibrationPicking()) {
          return;
        }
        const messageId = resolveSelectableRowMessageIdFromTarget(event.target);
        if (!messageId) {
          return;
        }
        event.preventDefault();
        options.bridge?.onSelectReaction(messageId);
      });
      listEl.addEventListener("keydown", (event) => {
        if (!isCalibrationPicking()) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          options.bridge?.onCancelCalibration();
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          const messageId = resolveSelectableRowMessageIdFromTarget(
            event.target,
          );
          if (!messageId) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          options.bridge?.onSelectReaction(messageId);
        }
      });

      nativeFrame = document.createElement("iframe");
      nativeFrame.id = NATIVE_CHAT_FRAME_ID;
      nativeFrame.className = "fce-panel-native";
      nativeFrame.title = "Official chat";
      nativeFrame.allow = "clipboard-write; fullscreen";
      nativeFrame.setAttribute("aria-hidden", "true");
      nativeFrame.addEventListener("load", () => {
        if (!nativeFrame || !isNativeMode()) {
          return;
        }
        try {
          const text = nativeFrame.contentDocument?.body?.textContent ?? "";
          if (NATIVE_CHAT_DISABLED_RE.test(text)) {
            options.onNativeChatRejected?.();
          }
        } catch {
          // Cross-origin: cannot inspect; keep native mode.
          // クロスオリジンでは中身を見られないので公式枠のまま。
        }
      });

      composeEl = document.createElement("form");
      composeEl.className = "fce-panel-compose";

      inputEl = document.createElement("textarea");
      inputEl.className = "fce-panel-input";
      inputEl.rows = 2;
      inputEl.placeholder = "Message…";

      const sendButton = document.createElement("button");
      sendButton.type = "submit";
      sendButton.className = "fce-panel-send";
      sendButton.textContent = "Send";
      sendButtonEl = sendButton;

      composeEl.append(inputEl, sendButton);
      unbindCompose = bindCompose(
        composeEl,
        inputEl,
        (text) => options.onSend(text),
        undefined,
        () => settings?.uiLocale ?? "auto",
      );
      const resizeE = document.createElement("div");
      resizeE.className = "fce-panel-resize fce-panel-resize-e";
      resizeE.dataset.edge = "e";
      const resizeS = document.createElement("div");
      resizeS.className = "fce-panel-resize fce-panel-resize-s";
      resizeS.dataset.edge = "s";
      const resizeSe = document.createElement("div");
      resizeSe.className = "fce-panel-resize fce-panel-resize-se";
      resizeSe.dataset.edge = "se";
      for (const handle of [resizeE, resizeS, resizeSe]) {
        bindResizeHandle(handle);
      }

      panelEl.append(
        handleEl,
        dragEdgeEl,
        gearMenu,
        bridgeBarEl,
        bridgeCalibrateEl,
        bridgeMaskEl,
        listEl,
        nativeFrame,
        composeEl,
        resizeE,
        resizeS,
        resizeSe,
      );
      host.append(panelEl);
      injectStyles(host);
      target.appendChild(host);
      ensureHostParentPositioned(target);
      resizeObserver =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => {
              if (
                settings &&
                !dragState &&
                !resizeState &&
                (pendingPositions.length > 0 || settings.panel.position)
              ) {
                applyVisuals(settings);
              }
            })
          : null;
      resizeObserver?.observe(host);
      if (settings) {
        applyVisuals(settings);
      }
      syncBridgeUi();
      renderSurface();
      syncGearControls();
    },
    unmount() {
      unmountInternal();
    },
    setMessages(messages) {
      lastMessages = messages;
      if (panelEl && !options.site && messages[0]?.site) {
        panelEl.dataset.site = messages[0].site;
      }
      if (!listEl || isNativeMode()) {
        return;
      }
      renderListRows(messages);
    },
    applySettings(next) {
      const prev = settings;
      const prevLocale = settings?.uiLocale;
      const prevNative = isNativeMode();
      settings = next;
      applyVisuals(next);
      if (needsSurfaceRebuild(prev, next, prevNative, isNativeMode())) {
        renderSurface();
      } else {
        syncSurfaceVisualState();
      }
      syncGearControls();
      if (prevLocale !== next.uiLocale) {
        void ensureLocale(next.uiLocale)
          .then(() => {
            if (settings !== next) {
              return;
            }
            syncGearControls();
          })
          .catch((error: unknown) => {
            console.warn("[fce] panel locale failed", error);
          });
      }
    },
    setNativeChatUrl(url) {
      const normalized = url && isAllowedNativeChatEmbedUrl(url) ? url : null;
      if (normalized === nativeUrl) {
        return;
      }
      nativeUrl = normalized;
      renderSurface();
    },
    setBridgeState(next) {
      const prevActive =
        bridgeState.supported && bridgeState.activeSource !== null;
      bridgeState = next;
      const nextActive = next.supported && next.activeSource !== null;
      syncBridgeUi();
      if (prevActive !== nextActive) {
        renderSurface();
      }
    },
    focusCompose() {
      if (isNativeMode()) {
        nativeFrame?.focus();
        return;
      }
      inputEl?.focus();
    },
    reparentForFullscreen() {
      if (!host) {
        return;
      }
      const target = resolveHostTarget(
        (mountParent?.isConnected ? mountParent : null) ?? document.body,
      );
      const reparented = host.parentElement !== target;
      if (reparented) {
        target.appendChild(host);
      }
      ensureHostParentPositioned(target);
      if (reparented && settings) {
        applyVisuals(settings);
      }
    },
  };

  function trackGesture(
    onMove: (event: PointerEvent) => void,
    onEnd: (event: PointerEvent) => void,
  ): void {
    stopGestureListeners?.();
    const moveListener = (event: PointerEvent) => onMove(event);
    const endListener = (event: PointerEvent) => onEnd(event);
    window.addEventListener("pointermove", moveListener, true);
    window.addEventListener("pointerup", endListener, true);
    window.addEventListener("pointercancel", endListener, true);
    stopGestureListeners = () => {
      window.removeEventListener("pointermove", moveListener, true);
      window.removeEventListener("pointerup", endListener, true);
      window.removeEventListener("pointercancel", endListener, true);
      stopGestureListeners = null;
    };
  }

  function bindDragHandle(handle: HTMLElement): void {
    const swallowMouse = (event: Event) => {
      event.stopPropagation();
    };
    handle.addEventListener("mousedown", swallowMouse);
    handle.addEventListener("click", swallowMouse);

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !panelEl || !host) {
        return;
      }
      const panelRect = panelEl.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - panelRect.left,
        offsetY: event.clientY - panelRect.top,
      };
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Window listeners continue tracking even if pointer capture is rejected.
      }
      panelEl.dataset.dragging = "1";
      // Prevent iframe from eating the first move events / iframe が pointer を奪わないようにする
      suppressNativePointer = true;
      if (nativeFrame) {
        nativeFrame.style.pointerEvents = "none";
      }
      // Switch to free layout using current on-screen box / 現在の見た目から自由配置へ切替
      applyFreePosition({
        x: panelRect.left - hostRect.left,
        y: panelRect.top - hostRect.top,
        w: panelRect.width,
        h: panelRect.height,
      });
      trackGesture(onDragMove, endDrag);
      event.preventDefault();
      event.stopPropagation();
    });

    function onDragMove(event: PointerEvent): void {
      if (
        !dragState ||
        dragState.pointerId !== event.pointerId ||
        !panelEl ||
        !host
      ) {
        return;
      }
      event.stopPropagation();
      const hostRect = host.getBoundingClientRect();
      const width = panelEl.offsetWidth;
      const height = panelEl.offsetHeight;
      const rawX = event.clientX - hostRect.left - dragState.offsetX;
      const rawY = event.clientY - hostRect.top - dragState.offsetY;
      const next = clampPosition(
        { x: rawX, y: rawY, w: width, h: height },
        hostRect.width,
        hostRect.height,
      );
      applyFreePosition(next);
    }

    function endDrag(event: PointerEvent): void {
      if (!dragState || dragState.pointerId !== event.pointerId || !panelEl) {
        return;
      }
      event.stopPropagation();
      stopGestureListeners?.();
      dragState = null;
      panelEl.dataset.dragging = "0";
      if (nativeFrame) {
        nativeFrame.style.pointerEvents = "";
      }
      suppressNativePointer = false;
      const position = readCurrentPosition();
      if (position) {
        if (!pendingPositions.length)
          positionBeforeSave = settings?.panel.position;
        pendingPositions.push(position);
        options.onPositionChange?.(position);
      }
    }
  }

  function bindResizeHandle(handle: HTMLElement): void {
    const swallowMouse = (event: Event) => {
      event.stopPropagation();
    };
    handle.addEventListener("mousedown", swallowMouse);
    handle.addEventListener("click", swallowMouse);

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !panelEl || !host) {
        return;
      }
      const edge = handle.dataset.edge;
      if (edge !== "e" && edge !== "s" && edge !== "se") {
        return;
      }
      const panelRect = panelEl.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const origin = {
        x: panelRect.left - hostRect.left,
        y: panelRect.top - hostRect.top,
        w: panelRect.width,
        h: panelRect.height,
      };
      applyFreePosition(origin);
      resizeState = {
        pointerId: event.pointerId,
        edge,
        startX: event.clientX,
        startY: event.clientY,
        origin,
      };
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Window listeners continue tracking even if pointer capture is rejected.
      }
      panelEl.dataset.dragging = "1";
      suppressNativePointer = true;
      if (nativeFrame) {
        nativeFrame.style.pointerEvents = "none";
      }
      trackGesture(onResizeMove, endResize);
      event.preventDefault();
      event.stopPropagation();
    });

    function onResizeMove(event: PointerEvent): void {
      if (!resizeState || resizeState.pointerId !== event.pointerId || !host) {
        return;
      }
      event.stopPropagation();
      const hostRect = host.getBoundingClientRect();
      const dx = event.clientX - resizeState.startX;
      const dy = event.clientY - resizeState.startY;
      let nextW = resizeState.origin.w;
      let nextH = resizeState.origin.h;
      if (resizeState.edge === "e" || resizeState.edge === "se") {
        nextW = resizeState.origin.w + dx;
      }
      if (resizeState.edge === "s" || resizeState.edge === "se") {
        nextH = resizeState.origin.h + dy;
      }
      applyFreePosition(
        clampPosition(
          {
            x: resizeState.origin.x,
            y: resizeState.origin.y,
            w: nextW,
            h: nextH,
          },
          hostRect.width,
          hostRect.height,
        ),
      );
    }

    function endResize(event: PointerEvent): void {
      if (
        !resizeState ||
        resizeState.pointerId !== event.pointerId ||
        !panelEl
      ) {
        return;
      }
      event.stopPropagation();
      stopGestureListeners?.();
      resizeState = null;
      panelEl.dataset.dragging = "0";
      if (nativeFrame) {
        nativeFrame.style.pointerEvents = "";
      }
      suppressNativePointer = false;
      const position = readCurrentPosition();
      if (position) {
        if (!pendingPositions.length)
          positionBeforeSave = settings?.panel.position;
        pendingPositions.push(position);
        options.onPositionChange?.(position);
      }
    }
  }

  function isNativeMode(): boolean {
    return Boolean(settings?.panel.useNativeChat && nativeUrl);
  }

  function syncSurfaceVisualState(): void {
    if (!panelEl || !settings) {
      return;
    }
    const effectiveNative = isNativeMode();
    panelEl.dataset.idleFade =
      settings.panel.idleFade && !effectiveNative ? "1" : "0";
    panelEl.dataset.native = effectiveNative ? "1" : "0";
  }

  function renderSurface(): void {
    if (!listEl || !composeEl || !nativeFrame) {
      return;
    }
    const native = isNativeMode();
    const isBridgeActive =
      bridgeState.supported && bridgeState.activeSource !== null;
    const isVodReadOnly =
      (options.site === "twitch" || panelEl?.dataset.site === "twitch") &&
      isTwitchVodPage();
    syncSurfaceVisualState();
    listEl.hidden = native;
    composeEl.hidden =
      native ||
      isVodReadOnly ||
      isBridgeActive ||
      settings?.compose.enabled === false;
    nativeFrame.hidden = !native;
    nativeFrame.setAttribute("aria-hidden", native ? "false" : "true");
    nativeFrame.style.pointerEvents = suppressNativePointer ? "none" : "";

    if (native) {
      if (nativeFrame.dataset.src !== nativeUrl && nativeUrl) {
        nativeFrame.src = nativeUrl;
        nativeFrame.dataset.src = nativeUrl;
      }
      return;
    }

    if (nativeFrame.src && nativeFrame.src !== "about:blank") {
      nativeFrame.src = "about:blank";
      delete nativeFrame.dataset.src;
    }
    renderedRows.clear();
    listEl.replaceChildren();
    if (lastMessages.length > 0) {
      renderListRows(lastMessages);
    }
  }

  function hasActiveBridge(): boolean {
    return bridgeState.supported && bridgeState.activeSource !== null;
  }

  function isCalibrationPicking(): boolean {
    return (
      hasActiveBridge() &&
      bridgeState.suspendedReason === null &&
      bridgeState.calibration.status !== "idle"
    );
  }

  function syncRowPickingState(
    row: HTMLElement,
    message: NormalizedMessage,
  ): void {
    const remoteSourceSite = bridgeState.activeSource?.site ?? null;
    if (
      !isCalibrationPicking() ||
      remoteSourceSite === null ||
      message.site !== remoteSourceSite
    ) {
      delete row.dataset.selectable;
      delete row.dataset.selected;
      row.removeAttribute("role");
      row.removeAttribute("tabindex");
      row.removeAttribute("aria-pressed");
      return;
    }
    const selected =
      bridgeState.calibration.status === "suggested" &&
      bridgeState.calibration.selectedMessageId === message.id;
    row.dataset.selectable = "1";
    row.dataset.selected = selected ? "1" : "0";
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.setAttribute("aria-pressed", selected ? "true" : "false");
  }

  function syncListPickingState(): void {
    for (const entry of renderedRows.values()) {
      syncRowPickingState(entry.el, entry.message);
    }
  }

  function renderListRows(messages: NormalizedMessage[]): void {
    if (!listEl) {
      return;
    }
    const showSiteBadge = hasActiveBridge();
    const maxVisible = settings?.filter.maxVisible ?? 500;
    const rawBounded = messages.slice(-maxVisible);
    const seen = new Set<string>();
    const boundedReversed: NormalizedMessage[] = [];
    for (let index = rawBounded.length - 1; index >= 0; index -= 1) {
      const item = rawBounded[index];
      if (!item) {
        continue;
      }
      const key = `${item.site}:${item.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      boundedReversed.push(item);
    }
    const bounded = boundedReversed.reverse();

    const wasNearBottom =
      listEl.children.length === 0 ||
      listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight <= 24;

    for (const [key, entry] of renderedRows) {
      if (!seen.has(key)) {
        entry.el.remove();
        renderedRows.delete(key);
      }
    }

    for (let index = 0; index < bounded.length; index += 1) {
      const message = bounded[index]!;
      const key = `${message.site}:${message.id}`;
      let entry = renderedRows.get(key);
      if (!entry) {
        const el = renderRow(message, settings, showSiteBadge);
        entry = { el, message };
        renderedRows.set(key, entry);
      } else if (!sameRenderedMessage(entry.message, message)) {
        const nextEl = renderRow(message, settings, showSiteBadge);
        if (entry.el.parentElement === listEl) {
          listEl.replaceChild(nextEl, entry.el);
        }
        entry.el = nextEl;
        entry.message = message;
      } else {
        entry.message = message;
      }
      syncRowPickingState(entry.el, message);
      if (listEl.children[index] !== entry.el) {
        listEl.insertBefore(entry.el, listEl.children[index] ?? null);
      }
    }

    while (listEl.children.length > bounded.length) {
      listEl.children[bounded.length]?.remove();
    }

    if (wasNearBottom) {
      listEl.scrollTop = listEl.scrollHeight;
    }
  }

  function applyVisuals(next: ExtensionSettings): void {
    if (!host || !panelEl) {
      return;
    }
    if (!opacityAdjusting && document.activeElement !== opacityInput) {
      panelEl.style.setProperty(
        "--fce-panel-opacity",
        String(next.panel.opacity),
      );
    }
    if (!fontAdjusting && document.activeElement !== fontInput) {
      panelEl.style.setProperty(
        "--fce-panel-font",
        `${next.panel.fontSizePx}px`,
      );
    }
    syncSurfaceVisualState();
    panelEl.style.pointerEvents = next.panel.allowPointer ? "auto" : "none";

    // Receiving chat reapplies settings; do not undo an in-progress gesture.
    if (dragState || resizeState) return;
    if (pendingPositions.length) {
      const acknowledged = pendingPositions.findIndex((position) =>
        samePosition(next.panel.position, position),
      );
      if (acknowledged >= 0) {
        pendingPositions.splice(0, acknowledged + 1);
        positionBeforeSave = next.panel.position;
      } else if (!samePosition(next.panel.position, positionBeforeSave)) {
        pendingPositions.length = 0;
      }
    }
    const position = pendingPositions.at(-1) ?? next.panel.position;
    if (position) {
      applyFreePosition(position);
      return;
    }

    // Anchored default layout until the user drags / ドラッグ前はアンカー配置
    panelEl.dataset.layout = "anchored";
    panelEl.dataset.anchor = next.panel.anchor;
    panelEl.style.left = "";
    panelEl.style.top = "";
    panelEl.style.right = "";
    panelEl.style.bottom = "";
    panelEl.style.width = `${Math.round(next.panel.widthRatio * 100)}%`;
    panelEl.style.height = "";
    panelEl.style.maxWidth = "420px";
  }

  function applyFreePosition(position: PanelBounds): void {
    if (!panelEl || !host) {
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const clamped = clampPosition(position, hostRect.width, hostRect.height);
    panelEl.dataset.layout = "free";
    panelEl.dataset.anchor = "";
    panelEl.style.right = "auto";
    panelEl.style.bottom = "auto";
    panelEl.style.left = `${clamped.x}px`;
    panelEl.style.top = `${clamped.y}px`;
    panelEl.style.width = `${clamped.w}px`;
    panelEl.style.height = `${clamped.h}px`;
    panelEl.style.maxWidth = "none";
  }

  function readCurrentPosition(): PanelBounds | null {
    if (!panelEl || !host) {
      return null;
    }
    const panelRect = panelEl.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    return clampPosition(
      {
        x: panelRect.left - hostRect.left,
        y: panelRect.top - hostRect.top,
        w: panelRect.width,
        h: panelRect.height,
      },
      hostRect.width,
      hostRect.height,
    );
  }

  function setGearOpen(open: boolean): void {
    gearOpen = open;
    stopGearOutsideListener?.();
    if (gearMenu) {
      gearMenu.hidden = !open;
    }
    if (gearButton) {
      gearButton.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (open) {
      if (bridgeState.supported) {
        options.bridge?.onRefreshSources();
      }
      const onOutside = (event: PointerEvent) => {
        const target = event.target as Node | null;
        if (
          target &&
          (gearMenu?.contains(target) || gearButton?.contains(target))
        ) {
          return;
        }
        setGearOpen(false);
      };
      document.addEventListener("pointerdown", onOutside, true);
      stopGearOutsideListener = () => {
        document.removeEventListener("pointerdown", onOutside, true);
        stopGearOutsideListener = null;
      };
    }
  }

  function syncGearControls(): void {
    if (!settings) {
      return;
    }
    const locale = settings.uiLocale;
    if (inputEl) {
      inputEl.placeholder = t(locale, "composePlaceholder");
    }
    if (sendButtonEl) {
      sendButtonEl.textContent = t(locale, "composeSend");
    }
    if (gearButton) {
      const label = t(locale, "panelGear");
      gearButton.title = label;
      gearButton.setAttribute("aria-label", label);
    }
    if (opacityInput) {
      if (!opacityAdjusting && document.activeElement !== opacityInput) {
        opacityInput.value = String(settings.panel.opacity);
      }
      const row = opacityInput.closest(".fce-panel-gear-row");
      const title = row?.querySelector("span");
      if (title) {
        title.textContent = t(locale, "panelOpacity");
      }
    }
    if (fontInput) {
      if (!fontAdjusting && document.activeElement !== fontInput) {
        fontInput.value = String(settings.panel.fontSizePx);
      }
      const row = fontInput.closest(".fce-panel-gear-row");
      const title = row?.querySelector("span");
      if (title) {
        title.textContent = t(locale, "panelFont");
      }
    }
    const optionsButton = gearMenu?.querySelector<HTMLButtonElement>(
      ".fce-panel-gear-options",
    );
    if (optionsButton) {
      optionsButton.textContent = t(locale, "openOptions");
    }
    const pinButton = gearMenu?.querySelector<HTMLButtonElement>(
      ".fce-panel-gear-pin",
    );
    if (pinButton) {
      pinButton.textContent = t(locale, "panelPinOnTop");
      // Without Document PiP the button would only open a normal popout.
      // Document PiP が無いと、押しても通常の別窓にしかならない。
      pinButton.hidden =
        !settings.popout.alwaysOnTop || !getFeatureFlags().documentPip;
    }
    syncBridgeUi();
  }

  function createDelayStepButton(deltaSec: number): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fce-panel-bridge-step";
    button.textContent = deltaSec > 0 ? `+${deltaSec}` : String(deltaSec);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.bridge?.onAdjustDelay(deltaSec);
    });
    return button;
  }

  function syncBridgeUi(): void {
    const locale = settings?.uiLocale ?? "auto";
    const localSiteLabel = options.site === "twitch" ? "Twitch" : "YouTube";
    const peerSiteLabel = options.site === "twitch" ? "YouTube" : "Twitch";
    const sourceLabelText = t(locale, "bridgeSourceLabel").replace(
      "{site}",
      peerSiteLabel,
    );
    const isActive = hasActiveBridge();
    const isSuspended = isActive && bridgeState.suspendedReason !== null;
    const calibration = bridgeState.calibration;
    const isCalibrateVisible = isActive && !isSuspended;
    const isPicking = isCalibrateVisible && calibration.status !== "idle";
    const isSuggested =
      isCalibrateVisible &&
      calibration.status === "suggested" &&
      calibration.suggestedDelaySec !== null;
    if (panelEl) {
      panelEl.dataset.bridge = isActive ? "1" : "0";
      panelEl.dataset.calibrating = isPicking ? "1" : "0";
    }
    if (bridgeGearRow) {
      bridgeGearRow.hidden = !bridgeState.supported;
    }
    if (bridgeGearTitle) {
      bridgeGearTitle.textContent = sourceLabelText;
    }
    if (bridgeRefreshButton) {
      const refreshLabel = t(locale, "bridgeRefresh");
      bridgeRefreshButton.title = refreshLabel;
      bridgeRefreshButton.setAttribute("aria-label", refreshLabel);
    }
    if (bridgeSelectEl) {
      const offLabel = t(locale, "bridgeSourceNone").replace(
        "{site}",
        localSiteLabel,
      );
      const emptyLabel = t(locale, "bridgeNoSources").replace(
        "{site}",
        peerSiteLabel,
      );
      const merged: OverlayBridgeSourceOption[] = [...bridgeState.sources];
      if (
        bridgeState.activeSource &&
        !merged.some(
          (source) => source.tabId === bridgeState.activeSource?.tabId,
        )
      ) {
        merged.push(bridgeState.activeSource);
      }
      const activeValue = bridgeState.activeSource
        ? String(bridgeState.activeSource.tabId)
        : "";
      const signature = [
        offLabel,
        emptyLabel,
        activeValue,
        ...merged.map((source) => `${source.tabId}:${source.label}`),
      ].join("|");
      if (signature !== lastSelectSignature) {
        lastSelectSignature = signature;
        const fragment = document.createDocumentFragment();
        const offOption = document.createElement("option");
        offOption.value = "";
        offOption.textContent = offLabel;
        fragment.appendChild(offOption);
        if (merged.length === 0) {
          const emptyOption = document.createElement("option");
          emptyOption.value = "__empty__";
          emptyOption.disabled = true;
          emptyOption.textContent = emptyLabel;
          fragment.appendChild(emptyOption);
        } else {
          for (const source of merged) {
            const option = document.createElement("option");
            option.value = String(source.tabId);
            option.textContent = source.label;
            fragment.appendChild(option);
          }
        }
        bridgeSelectEl.replaceChildren(fragment);
      }
      bridgeSelectEl.value = activeValue;
      bridgeSelectEl.setAttribute("aria-label", sourceLabelText);
    }
    if (bridgeBarEl) {
      bridgeBarEl.hidden = !isActive;
    }
    if (bridgeChannelEl) {
      bridgeChannelEl.textContent = bridgeState.activeSource?.label ?? "";
    }
    if (bridgeReadOnlyEl) {
      bridgeReadOnlyEl.textContent = t(locale, "bridgeReadOnly");
    }
    if (bridgeDelayEl) {
      const formatted = `+${bridgeState.delaySec}s`;
      bridgeDelayEl.textContent = formatted;
      bridgeDelayEl.title = `${t(locale, "bridgeDelayLabel")}: ${formatted}`;
    }
    const disconnectLabel = t(locale, "bridgeDisconnect");
    if (bridgeDisconnectButton) {
      bridgeDisconnectButton.textContent = disconnectLabel;
    }
    if (bridgeMaskDisconnectButton) {
      bridgeMaskDisconnectButton.textContent = disconnectLabel;
    }
    if (bridgeResumeButton) {
      bridgeResumeButton.textContent = t(locale, "bridgeResume");
    }
    if (bridgeMaskEl) {
      bridgeMaskEl.hidden = !isSuspended;
    }
    if (bridgeMaskMessageEl && isSuspended) {
      const key =
        bridgeState.suspendedReason === "pause"
          ? "bridgePausedPause"
          : bridgeState.suspendedReason === "seek"
            ? "bridgePausedSeek"
            : "bridgePausedAd";
      bridgeMaskMessageEl.textContent = t(locale, key);
    }
    if (bridgeCalibrateEl) {
      bridgeCalibrateEl.hidden = !isCalibrateVisible;
    }
    if (bridgeCalibrateStatusEl) {
      if (isSuggested) {
        bridgeCalibrateStatusEl.hidden = false;
        bridgeCalibrateStatusEl.textContent = t(
          locale,
          "bridgeSuggestEstimate",
        ).replace("{sec}", String(calibration.suggestedDelaySec));
      } else if (isPicking) {
        bridgeCalibrateStatusEl.hidden = false;
        bridgeCalibrateStatusEl.textContent = t(locale, "bridgePickReaction");
      } else {
        bridgeCalibrateStatusEl.hidden = true;
        bridgeCalibrateStatusEl.textContent = "";
      }
    }
    if (bridgeMarkButton) {
      bridgeMarkButton.hidden = !isCalibrateVisible || isSuggested;
      bridgeMarkButton.textContent = t(locale, "bridgeMarkScene");
    }
    if (bridgeApplyButton) {
      bridgeApplyButton.hidden = !isSuggested;
      bridgeApplyButton.textContent = t(locale, "bridgeApply");
    }
    if (bridgeCancelButton) {
      bridgeCancelButton.hidden = !isPicking;
      bridgeCancelButton.textContent = t(locale, "bridgeCancel");
    }
    syncListPickingState();
  }

  function unmountInternal(): void {
    stopGearOutsideListener?.();
    stopGestureListeners?.();
    opacityAdjusting = false;
    fontAdjusting = false;
    resizeObserver?.disconnect();
    resizeObserver = null;
    unbindCompose?.();
    unbindCompose = null;
    if (nativeFrame) {
      nativeFrame.src = "about:blank";
    }
    host?.remove();
    host = null;
    panelEl = null;
    handleEl = null;
    gearButton = null;
    gearMenu = null;
    opacityInput = null;
    fontInput = null;
    bridgeGearRow = null;
    bridgeGearTitle = null;
    bridgeSelectEl = null;
    bridgeRefreshButton = null;
    bridgeBarEl = null;
    bridgeChannelEl = null;
    bridgeReadOnlyEl = null;
    bridgeDelayEl = null;
    bridgeDisconnectButton = null;
    bridgeCalibrateEl = null;
    bridgeCalibrateStatusEl = null;
    bridgeMarkButton = null;
    bridgeApplyButton = null;
    bridgeCancelButton = null;
    bridgeMaskEl = null;
    bridgeMaskMessageEl = null;
    bridgeResumeButton = null;
    bridgeMaskDisconnectButton = null;
    lastSelectSignature = "";
    renderedRows.clear();
    listEl = null;
    composeEl = null;
    inputEl = null;
    sendButtonEl = null;
    nativeFrame = null;
    dragState = null;
    resizeState = null;
    pendingPositions.length = 0;
    positionBeforeSave = undefined;
    suppressNativePointer = false;
    gearOpen = false;
  }
}

function needsSurfaceRebuild(
  prev: ExtensionSettings | null,
  next: ExtensionSettings,
  prevNative: boolean,
  nextNative: boolean,
): boolean {
  if (!prev) {
    return true;
  }
  return (
    prevNative !== nextNative ||
    prev.panel.useNativeChat !== next.panel.useNativeChat ||
    prev.panel.showAuthor !== next.panel.showAuthor ||
    prev.panel.showBadges !== next.panel.showBadges ||
    prev.compose.enabled !== next.compose.enabled ||
    prev.filter.maxVisible !== next.filter.maxVisible
  );
}

function samePosition(
  a: PanelBounds | undefined,
  b: PanelBounds | undefined,
): boolean {
  return (
    a === b ||
    Boolean(a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h)
  );
}

function clampPosition(
  position: PanelBounds,
  hostWidth: number,
  hostHeight: number,
): PanelBounds {
  const width = Math.min(
    Math.max(
      MIN_PANEL_WIDTH_PX,
      Math.round(position.w || DEFAULT_PANEL_WIDTH_PX),
    ),
    Math.max(MIN_PANEL_WIDTH_PX, Math.round(hostWidth)),
  );
  const height = Math.min(
    Math.max(
      MIN_PANEL_HEIGHT_PX,
      Math.round(position.h || DEFAULT_PANEL_HEIGHT_PX),
    ),
    Math.max(MIN_PANEL_HEIGHT_PX, Math.round(hostHeight)),
  );
  const maxX = Math.max(0, Math.floor(hostWidth - width));
  const maxY = Math.max(0, Math.floor(hostHeight - height));
  return {
    x: Math.min(Math.max(0, Math.round(position.x)), maxX),
    y: Math.min(Math.max(0, Math.round(position.y)), maxY),
    w: width,
    h: height,
  };
}

function resolveHostTarget(fallback: HTMLElement): HTMLElement {
  const fullscreenElement = document.fullscreenElement;
  return (
    (fullscreenElement instanceof HTMLElement ? fullscreenElement : null) ??
    fallback
  );
}

function ensureHostParentPositioned(parent: HTMLElement): void {
  if (parent === document.body || parent === document.documentElement) {
    return;
  }
  if (window.getComputedStyle(parent).position === "static") {
    parent.style.position = "relative";
  }
}

function appendMessageBody(
  body: HTMLElement,
  message: NormalizedMessage,
): void {
  const segments: MessageSegment[] = message.segments?.length
    ? message.segments
    : [{ type: "text", text: message.text }];
  for (const segment of segments) {
    if (segment.type === "text") {
      if (!segment.text) {
        continue;
      }
      body.appendChild(document.createTextNode(segment.text));
      continue;
    }
    if (!isSafeHttpsImageUrl(segment.src)) {
      body.appendChild(
        document.createTextNode(segment.alt ? `:${segment.alt}:` : "✦"),
      );
      continue;
    }
    const img = document.createElement("img");
    img.className = "fce-panel-emoji";
    img.src = segment.src;
    img.alt = segment.alt || "emoji";
    img.title = segment.alt || "";
    img.loading = "lazy";
    img.decoding = "async";
    body.appendChild(img);
  }
}

function formatVodOffsetClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}

function appendBadgesNode(
  row: HTMLElement,
  message: NormalizedMessage,
  settings: ExtensionSettings | null,
): void {
  if (settings?.panel.showBadges === false) {
    return;
  }
  const safeIcons =
    message.badgeIcons?.filter(
      (icon) => icon.src && isSafeHttpsImageUrl(icon.src),
    ) ?? [];
  const iconAlts = new Set(safeIcons.map((icon) => icon.alt));
  const textBadges = message.badges.filter((badge) => !iconAlts.has(badge));
  if (safeIcons.length === 0 && textBadges.length === 0) {
    return;
  }
  const badge = document.createElement("span");
  badge.className = "fce-panel-badges";
  for (const icon of safeIcons) {
    const img = document.createElement("img");
    img.className = "fce-panel-badge-icon";
    img.src = icon.src;
    img.alt = icon.alt;
    img.title = icon.alt;
    img.loading = "lazy";
    img.decoding = "async";
    badge.appendChild(img);
  }
  if (textBadges.length > 0) {
    if (safeIcons.length > 0) {
      badge.appendChild(document.createTextNode(" · "));
    }
    badge.appendChild(document.createTextNode(textBadges.join(" · ")));
  }
  row.appendChild(badge);
}

function renderRow(
  message: NormalizedMessage,
  settings: ExtensionSettings | null,
  showSiteBadge = false,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "fce-panel-row";
  row.dataset.messageId = message.id;
  row.dataset.site = message.site;
  if (showSiteBadge) {
    row.appendChild(createSiteBadge(message.site, "fce-panel-site-badge"));
  }
  if (message.site === "twitch") {
    if (message.videoOffsetSec !== undefined) {
      const time = document.createElement("span");
      time.className = "fce-panel-time";
      time.textContent = formatVodOffsetClock(message.videoOffsetSec);
      row.appendChild(time);
    }
    appendBadgesNode(row, message, settings);
    if (settings?.panel.showAuthor !== false) {
      const author = document.createElement("span");
      author.className = "fce-panel-author";
      if (message.authorColor) {
        author.style.color = message.authorColor;
      }
      author.textContent = message.authorName;
      if (
        message.authorLogin &&
        !message.authorName
          .toLowerCase()
          .includes(message.authorLogin.toLowerCase())
      ) {
        const login = document.createElement("span");
        login.className = "fce-panel-author-login";
        login.textContent = ` (${message.authorLogin})`;
        author.appendChild(login);
      }
      row.appendChild(author);
      const sep = document.createElement("span");
      sep.className = "fce-panel-sep";
      sep.textContent = ": ";
      row.appendChild(sep);
    }
  } else {
    if (settings?.panel.showAuthor !== false) {
      const author = document.createElement("span");
      author.className = "fce-panel-author";
      author.textContent = message.authorName;
      row.appendChild(author);
    }
    appendBadgesNode(row, message, settings);
  }
  const body = document.createElement("span");
  body.className = "fce-panel-text";
  appendMessageBody(body, message);
  row.appendChild(body);
  return row;
}

function sameRenderedMessage(
  left: NormalizedMessage,
  right: NormalizedMessage,
): boolean {
  if (left === right) {
    return true;
  }
  if (
    left.site !== right.site ||
    left.authorName !== right.authorName ||
    left.authorLogin !== right.authorLogin ||
    left.authorColor !== right.authorColor ||
    left.text !== right.text ||
    left.videoOffsetSec !== right.videoOffsetSec
  ) {
    return false;
  }
  if (
    left.badges.length !== right.badges.length ||
    left.badges.some((badge, index) => badge !== right.badges[index])
  ) {
    return false;
  }
  const leftIcons = left.badgeIcons ?? [];
  const rightIcons = right.badgeIcons ?? [];
  if (
    leftIcons.length !== rightIcons.length ||
    leftIcons.some((icon, index) => {
      const other = rightIcons[index];
      return !other || icon.alt !== other.alt || icon.src !== other.src;
    })
  ) {
    return false;
  }
  const leftSegments = left.segments ?? [];
  const rightSegments = right.segments ?? [];
  if (leftSegments.length !== rightSegments.length) {
    return false;
  }
  return leftSegments.every((segment, index) => {
    const other = rightSegments[index];
    if (!other || segment.type !== other.type) {
      return false;
    }
    if (segment.type === "text" && other.type === "text") {
      return segment.text === other.text;
    }
    if (segment.type === "emoji" && other.type === "emoji") {
      return segment.src === other.src && segment.alt === other.alt;
    }
    return false;
  });
}

function resolveSelectableRowMessageIdFromTarget(
  target: EventTarget | null,
): string | null {
  let current: unknown = target;
  while (current && typeof current === "object") {
    const candidate = current as {
      closest?: (
        selector: string,
      ) => { dataset?: Record<string, string> } | null;
      parentElement?: unknown;
      dataset?: Record<string, string>;
    };
    if (typeof candidate.closest === "function") {
      const matched = candidate.closest(".fce-panel-row[data-message-id]");
      return matched?.dataset?.selectable === "1"
        ? matched.dataset.messageId || null
        : null;
    }
    if (candidate.dataset?.messageId) {
      return candidate.dataset.selectable === "1"
        ? candidate.dataset.messageId
        : null;
    }
    current = candidate.parentElement ?? null;
  }
  return null;
}

function swallowPlayerEvents(element: HTMLElement): void {
  const stop = (event: Event) => {
    event.stopPropagation();
  };
  element.addEventListener("pointerdown", stop);
  element.addEventListener("mousedown", stop);
  element.addEventListener("click", stop);
  element.addEventListener("dblclick", stop);
}

function injectStyles(host: HTMLElement): void {
  const style = document.createElement("style");
  style.textContent = `
    #${HOST_ID} {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      box-sizing: border-box;
      pointer-events: none;
      z-index: 2147483000;
    }
    #${HOST_ID} .fce-panel {
      position: absolute;
      display: flex;
      flex-direction: column;
      background: rgba(15, 15, 18, var(--fce-panel-opacity, 0.85));
      color: #f5f5f5;
      font-size: var(--fce-panel-font, 14px);
      border-radius: 8px;
      overflow: hidden;
      pointer-events: auto;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
      box-sizing: border-box;
    }
    #${HOST_ID} .fce-panel[data-layout="anchored"] {
      top: 8%;
      bottom: 12%;
      width: 22%;
      max-width: 420px;
      min-width: 180px;
    }
    #${HOST_ID} .fce-panel[data-layout="anchored"][data-site="youtube-live"][data-native="1"] {
      min-width: 260px;
    }
    #${HOST_ID} .fce-panel[data-layout="anchored"][data-anchor="right"] {
      right: 1.5%;
      left: auto;
    }
    #${HOST_ID} .fce-panel[data-layout="anchored"][data-anchor="left"] {
      left: 1.5%;
      right: auto;
    }
    #${HOST_ID} .fce-panel[data-layout="free"] {
      min-width: ${MIN_PANEL_WIDTH_PX}px;
      min-height: ${MIN_PANEL_HEIGHT_PX}px;
    }
    #${HOST_ID} .fce-panel[data-dragging="1"] {
      opacity: 0.92;
      user-select: none;
    }
    #${HOST_ID} .fce-panel[data-idle-fade="1"]:not(:hover):not([data-dragging="1"]):not([data-calibrating="1"]) {
      opacity: 0.55;
      transition: opacity 160ms ease;
    }
    #${HOST_ID} .fce-panel[data-native="1"] {
      background: rgba(15, 15, 18, 0.35);
    }
    #${HOST_ID} .fce-panel[data-site="twitch"] {
      background: rgba(24, 24, 27, var(--fce-panel-opacity, 0.85));
      color: #efeff1;
      font-family: Inter, Roobert, "Helvetica Neue", Helvetica, Arial, sans-serif;
      border: 1px solid rgba(255,255,255,0.1);
    }
    #${HOST_ID} .fce-panel[data-site="twitch"] .fce-panel-handle {
      background: rgba(24, 24, 27, 0.96);
    }
    #${HOST_ID} .fce-panel[data-site="twitch"] .fce-panel-gear-row input[type="range"] {
      accent-color: #9147ff;
    }
    #${HOST_ID} .fce-panel[data-site="twitch"] .fce-panel-send {
      background: #9147ff;
      color: #ffffff;
    }
    #${HOST_ID} .fce-panel[data-site="twitch"] .fce-panel-list {
      padding: 8px 12px;
      gap: 6px;
    }
    #${HOST_ID} .fce-panel-row[data-site="twitch"] {
      line-height: 1.45;
    }
    #${HOST_ID} .fce-panel-time {
      color: #adadb8;
      font-size: 0.85em;
      font-variant-numeric: tabular-nums;
      margin-right: 6px;
    }
    #${HOST_ID} .fce-panel-row[data-site="twitch"] .fce-panel-badges {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      vertical-align: -0.2em;
      margin-right: 4px;
    }
    #${HOST_ID} .fce-panel-row[data-site="twitch"] .fce-panel-badge-icon {
      width: 1.25em;
      height: 1.25em;
      margin-inline: 0;
    }
    #${HOST_ID} .fce-panel-row[data-site="twitch"] .fce-panel-emoji {
      width: 1.45em;
      height: 1.45em;
      vertical-align: middle;
    }
    #${HOST_ID} .fce-panel-row[data-site="twitch"] .fce-panel-author {
      font-weight: 700;
      margin-right: 0;
      color: #bf94ff;
    }
    #${HOST_ID} .fce-panel-author-login {
      font-weight: 400;
    }
    #${HOST_ID} .fce-panel-sep {
      color: #efeff1;
    }
    #${HOST_ID} .fce-panel-handle {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 10px;
      cursor: grab;
      background: rgba(0,0,0,0.35);
      border-bottom: 1px solid rgba(255,255,255,0.1);
      user-select: none;
      touch-action: none;
    }
    #${HOST_ID} .fce-panel-handle:active {
      cursor: grabbing;
    }
    #${HOST_ID} .fce-panel-handle-label {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      opacity: 0.9;
    }
    #${HOST_ID} .fce-panel-handle-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    #${HOST_ID} .fce-panel-handle-grip {
      width: 14px;
      height: 10px;
      background:
        linear-gradient(currentColor 0 0) 0 0 / 100% 2px no-repeat,
        linear-gradient(currentColor 0 0) 0 4px / 100% 2px no-repeat,
        linear-gradient(currentColor 0 0) 0 8px / 100% 2px no-repeat;
      opacity: 0.55;
    }
    #${HOST_ID} .fce-panel-gear {
      border: 0;
      background: transparent;
      color: inherit;
      font-size: 14px;
      line-height: 1;
      padding: 2px 4px;
      border-radius: 4px;
      cursor: pointer;
      opacity: 0.85;
    }
    #${HOST_ID} .fce-panel-gear:hover,
    #${HOST_ID} .fce-panel-gear:focus-visible {
      opacity: 1;
      background: rgba(255,255,255,0.12);
    }
    #${HOST_ID} .fce-panel-gear-menu {
      display: grid;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      background: rgba(12,12,16,0.92);
    }
    #${HOST_ID} .fce-panel-gear-menu[hidden] {
      display: none !important;
    }
    #${HOST_ID} .fce-panel-gear-row {
      display: grid;
      grid-template-columns: 64px 1fr;
      gap: 8px;
      align-items: center;
      font-size: 12px;
    }
    #${HOST_ID} .fce-panel-gear-row input[type="range"] {
      width: 100%;
      accent-color: #3ea6ff;
    }
    #${HOST_ID} .fce-panel-gear-options,
    #${HOST_ID} .fce-panel-gear-pin {
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 8px;
      cursor: pointer;
    }
    #${HOST_ID} .fce-panel-gear-options:hover,
    #${HOST_ID} .fce-panel-gear-pin:hover {
      background: rgba(255,255,255,0.08);
    }
    #${HOST_ID} .fce-panel-gear-pin[hidden] {
      display: none !important;
    }
    #${HOST_ID} .fce-panel-bridge-row[hidden],
    #${HOST_ID} .fce-panel-bridge-bar[hidden],
    #${HOST_ID} .fce-panel-bridge-calibrate[hidden],
    #${HOST_ID} .fce-panel-bridge-calibrate-status[hidden],
    #${HOST_ID} .fce-panel-bridge-mark[hidden],
    #${HOST_ID} .fce-panel-bridge-apply[hidden],
    #${HOST_ID} .fce-panel-bridge-cancel[hidden],
    #${HOST_ID} .fce-panel-bridge-mask[hidden] {
      display: none !important;
    }
    #${HOST_ID} .fce-panel-bridge-picker {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    #${HOST_ID} .fce-panel-bridge-select {
      flex: 1;
      min-width: 0;
      border: 1px solid rgba(255,255,255,0.24);
      border-radius: 4px;
      background: #18181b;
      color: #f5f5f5;
      font: inherit;
      font-size: 12px;
      padding: 3px 6px;
    }
    #${HOST_ID} .fce-panel-bridge-refresh {
      border: 1px solid rgba(255,255,255,0.24);
      border-radius: 4px;
      background: #18181b;
      color: #f5f5f5;
      font: inherit;
      font-size: 12px;
      padding: 3px 7px;
      cursor: pointer;
    }
    #${HOST_ID} .fce-panel-bridge-bar {
      flex: 0 0 auto;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 4px 6px;
      padding: 6px 10px;
      background: rgba(109, 40, 217, 0.28);
      border-bottom: 1px solid rgba(255,255,255,0.14);
      font-size: 11px;
      color: #ffffff;
    }
    #${HOST_ID} .fce-panel-bridge-info {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    #${HOST_ID} .fce-panel-bridge-channel {
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 120px;
    }
    #${HOST_ID} .fce-panel-bridge-badge {
      padding: 1px 6px;
      border-radius: 999px;
      background: #6d28d9;
      color: #ffffff;
      font-size: 10px;
      font-weight: 600;
      white-space: nowrap;
    }
    #${HOST_ID} .fce-panel-bridge-controls {
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    #${HOST_ID} .fce-panel-bridge-step,
    #${HOST_ID} .fce-panel-bridge-disconnect,
    #${HOST_ID} .fce-panel-bridge-mask-disconnect {
      border: 1px solid rgba(255,255,255,0.26);
      border-radius: 4px;
      background: rgba(24,24,27,0.88);
      color: #ffffff;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      cursor: pointer;
    }
    #${HOST_ID} .fce-panel-bridge-step:hover,
    #${HOST_ID} .fce-panel-bridge-disconnect:hover,
    #${HOST_ID} .fce-panel-bridge-mask-disconnect:hover,
    #${HOST_ID} .fce-panel-bridge-refresh:hover {
      background: rgba(255,255,255,0.16);
    }
    #${HOST_ID} .fce-panel-bridge-delay {
      min-width: 32px;
      text-align: center;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    #${HOST_ID} .fce-panel-bridge-calibrate {
      flex: 0 0 auto;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 4px 6px;
      padding: 5px 10px;
      background: rgba(15, 15, 18, 0.72);
      border-bottom: 1px solid rgba(255,255,255,0.12);
      font-size: 11px;
      color: #f5f5f5;
    }
    #${HOST_ID} .fce-panel-bridge-calibrate-status {
      flex: 1 1 auto;
      min-width: 0;
      font-weight: 600;
      color: #ddd6fe;
    }
    #${HOST_ID} .fce-panel-bridge-calibrate-actions {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
    }
    #${HOST_ID} .fce-panel-bridge-mark,
    #${HOST_ID} .fce-panel-bridge-cancel {
      border: 1px solid rgba(255,255,255,0.26);
      border-radius: 4px;
      background: rgba(24,24,27,0.88);
      color: #ffffff;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      cursor: pointer;
    }
    #${HOST_ID} .fce-panel-bridge-apply {
      border: 1px solid rgba(255,255,255,0.28);
      border-radius: 4px;
      background: #7c3aed;
      color: #ffffff;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      cursor: pointer;
    }
    #${HOST_ID} .fce-panel-bridge-mark:hover,
    #${HOST_ID} .fce-panel-bridge-cancel:hover {
      background: rgba(255,255,255,0.16);
    }
    #${HOST_ID} .fce-panel-bridge-apply:hover {
      background: #6d28d9;
    }
    #${HOST_ID} .fce-panel-bridge-mask {
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      padding: 8px 10px;
      background: rgba(109, 40, 217, 0.22);
      border-bottom: 1px solid rgba(255,255,255,0.14);
      text-align: left;
      color: #f5f5f5;
    }
    #${HOST_ID} .fce-panel-site-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.25em;
      height: 1.25em;
      margin-right: 5px;
      vertical-align: -0.22em;
      flex-shrink: 0;
    }
    #${HOST_ID} .fce-panel-site-badge svg {
      display: block;
      width: 100%;
      height: 100%;
      filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.75));
    }
    #${HOST_ID} .fce-panel-bridge-mask-text {
      margin: 0;
      font-size: 12px;
      line-height: 1.5;
    }
    #${HOST_ID} .fce-panel-bridge-mask-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #${HOST_ID} .fce-panel-bridge-resume {
      border: 0;
      border-radius: 6px;
      background: #6d28d9;
      color: #ffffff;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 14px;
      cursor: pointer;
    }
    #${HOST_ID} .fce-panel-bridge-resume:hover {
      background: #7c3aed;
    }
    #${HOST_ID} .fce-panel-drag-edge {
      display: none;
    }
    #${HOST_ID} .fce-panel[data-native="1"] .fce-panel-drag-edge {
      display: block;
      position: absolute;
      top: 0;
      left: 0;
      right: 118px;
      height: 8px;
      z-index: 4;
      cursor: grab;
      touch-action: none;
    }
    #${HOST_ID} .fce-panel[data-native="1"][data-site="youtube-live"] .fce-panel-drag-edge {
      right: 70px;
      height: 8px;
    }
    #${HOST_ID} .fce-panel[data-native="1"] .fce-panel-drag-edge:active {
      cursor: grabbing;
    }
    #${HOST_ID} .fce-panel[data-native="1"] .fce-panel-handle {
      position: absolute;
      top: 4px;
      right: 6px;
      z-index: 4;
      height: 32px;
      padding: 0 8px 0 12px;
      gap: 8px;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.24);
      background: rgba(20,20,24,0.88);
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      backdrop-filter: blur(4px);
      box-sizing: border-box;
    }
    #${HOST_ID} .fce-panel[data-native="1"][data-site="youtube-live"] .fce-panel-handle {
      top: 10px;
      right: 6px;
      height: 28px;
      padding: 0 6px 0 8px;
      gap: 4px;
    }
    #${HOST_ID} .fce-panel[data-native="1"] .fce-panel-handle-label {
      display: none;
    }
    #${HOST_ID} .fce-panel[data-native="1"] .fce-panel-handle-actions {
      gap: 8px;
    }
    #${HOST_ID} .fce-panel[data-native="1"] .fce-panel-handle-grip {
      order: 1;
      width: 18px;
      opacity: 0.85;
    }
    #${HOST_ID} .fce-panel[data-native="1"] .fce-panel-gear {
      order: 2;
    }
    #${HOST_ID} .fce-panel[data-native="1"] .fce-panel-gear-menu {
      position: absolute;
      top: 40px;
      left: 0;
      right: 0;
      z-index: 5;
      box-shadow: 0 8px 20px rgba(0,0,0,0.45);
    }
    #${HOST_ID} .fce-panel[data-native="1"][data-site="youtube-live"] .fce-panel-gear-menu {
      top: 48px;
    }
    #${HOST_ID} .fce-panel[data-native="1"] .fce-panel-resize-e {
      top: 40px;
    }
    #${HOST_ID} .fce-panel[data-native="1"][data-site="youtube-live"] .fce-panel-resize-e {
      top: 48px;
    }
    #${HOST_ID} .fce-panel-list {
      flex: 1;
      overflow-y: auto;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    #${HOST_ID} .fce-panel-list[hidden],
    #${HOST_ID} .fce-panel-compose[hidden],
    #${HOST_ID} .fce-panel-native[hidden] {
      display: none !important;
    }
    #${HOST_ID} .fce-panel-native {
      flex: 1;
      width: 100%;
      border: 0;
      background: #0e0e10;
    }
    #${HOST_ID} .fce-panel-row {
      line-height: 1.35;
      word-break: break-word;
    }
    #${HOST_ID} .fce-panel-row[data-selectable="1"] {
      cursor: pointer;
      border-radius: 4px;
      padding: 2px 4px;
      margin: -2px -4px;
      transition: background 120ms ease;
    }
    #${HOST_ID} .fce-panel-row[data-selectable="1"]:hover,
    #${HOST_ID} .fce-panel-row[data-selectable="1"]:focus-visible {
      background: rgba(124, 58, 237, 0.25);
      outline: 1px solid rgba(196, 181, 253, 0.7);
    }
    #${HOST_ID} .fce-panel-row[data-selected="1"] {
      background: rgba(124, 58, 237, 0.42);
      outline: 1px solid #c4b5fd;
    }
    #${HOST_ID} .fce-panel-badge-icon,
    #${HOST_ID} .fce-panel-emoji {
      width: 1.1em;
      height: 1.1em;
      vertical-align: -0.15em;
      margin-inline: 0.1em;
      object-fit: contain;
    }
    #${HOST_ID} .fce-panel-author {
      font-weight: 600;
      margin-right: 6px;
      color: #9ecbff;
    }
    #${HOST_ID} .fce-panel-compose {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px 8px;
      padding: 8px;
      border-top: 1px solid rgba(255,255,255,0.12);
      background: rgba(0,0,0,0.25);
    }
    #${HOST_ID} .fce-panel-compose .fce-panel-input {
      grid-column: 1;
    }
    #${HOST_ID} .fce-panel-compose .fce-panel-send {
      grid-column: 2;
      align-self: end;
    }
    #${HOST_ID} .fce-panel-input {
      flex: 1;
      resize: none;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.2);
      background: rgba(0,0,0,0.35);
      color: inherit;
      padding: 6px 8px;
      font: inherit;
    }
    #${HOST_ID} .fce-panel-send {
      border: 0;
      border-radius: 6px;
      padding: 0 12px;
      background: #3ea6ff;
      color: #0b0b0c;
      font-weight: 600;
      cursor: pointer;
    }
    #${HOST_ID} .fce-panel-resize {
      position: absolute;
      z-index: 3;
      touch-action: none;
    }
    #${HOST_ID} .fce-panel-resize-e {
      top: 18px;
      right: 0;
      width: 8px;
      bottom: 14px;
      cursor: ew-resize;
    }
    #${HOST_ID} .fce-panel-resize-s {
      left: 8px;
      right: 14px;
      bottom: 0;
      height: 8px;
      cursor: ns-resize;
    }
    #${HOST_ID} .fce-panel-resize-se {
      right: 0;
      bottom: 0;
      width: 14px;
      height: 14px;
      cursor: nwse-resize;
      background:
        linear-gradient(135deg, transparent 55%, rgba(255,255,255,0.55) 55%, rgba(255,255,255,0.55) 70%, transparent 70%),
        linear-gradient(135deg, transparent 75%, rgba(255,255,255,0.4) 75%);
    }
  `;
  host.appendChild(style);
}
