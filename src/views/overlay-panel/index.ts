import { bindCompose } from "../../shared/compose";
import type { MessageSegment, NormalizedMessage } from "../../core/message";
import { ensureLocale, t } from "../../shared/i18n";
import { NATIVE_CHAT_FRAME_ID } from "../../shared/dom-ids";
import { isSafeHttpsImageUrl } from "../../shared/safe-image-url";
import type { ExtensionSettings, PanelBounds } from "../../shared/settings";

const HOST_ID = "fce-overlay-panel-host";
const DEFAULT_PANEL_WIDTH_PX = 320;
const DEFAULT_PANEL_HEIGHT_PX = 480;
const MIN_PANEL_WIDTH_PX = 220;
const MIN_PANEL_HEIGHT_PX = 240;

export interface OverlayPanelController {
  mount(parent: HTMLElement): void;
  unmount(): void;
  setMessages(messages: NormalizedMessage[]): void;
  applySettings(settings: ExtensionSettings): void;
  /** Official chat URL for iframe mode; null falls back to custom list.
   * 公式チャット iframe。null のとき自前リストにフォールバック。 */
  setNativeChatUrl(url: string | null): void;
  focusCompose(): void;
  /** Reparent under fullscreen element when needed / 全画面要素配下へ再配置 */
  reparentForFullscreen(): void;
}

const NATIVE_CHAT_DISABLED_RE =
  /チャットは無効|chat is disabled|chat has been disabled|チャットをご利用いただけません/i;

export function createOverlayPanel(options: {
  onSend: (text: string, replyToId?: string) => Promise<boolean>;
  onPositionChange?: (position: PanelBounds) => void;
  /** Persist quick visual tweaks from the handle gear / ハンドルギアからの見た目即時保存 */
  onQuickPanelChange?: (patch: Partial<ExtensionSettings["panel"]>) => void;
  onOpenOptions?: () => void;
  /** Official iframe showed a disabled/unavailable chat page (ISS-022).
   * 公式 iframe がチャット無効ページを返したとき。 */
  onNativeChatRejected?: () => void;
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
  let listEl: HTMLDivElement | null = null;
  let composeEl: HTMLFormElement | null = null;
  let inputEl: HTMLTextAreaElement | null = null;
  let replyHintEl: HTMLElement | null = null;
  let nativeFrame: HTMLIFrameElement | null = null;
  let nativeUrl: string | null = null;
  let settings: ExtensionSettings | null = null;
  let lastMessages: NormalizedMessage[] = [];
  let replyToId: string | null = null;
  let replyToAuthor: string | null = null;
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

  return {
    mount(parent) {
      mountParent = parent;
      if (host && host.isConnected) {
        if (host.parentElement !== parent) {
          parent.appendChild(host);
        }
        return;
      }
      unmountInternal();
      host = document.createElement("div");
      host.id = HOST_ID;
      host.setAttribute("data-fce-view", "overlay-panel");

      panelEl = document.createElement("div");
      panelEl.className = "fce-panel";

      handleEl = document.createElement("div");
      handleEl.className = "fce-panel-handle";
      handleEl.tabIndex = 0;
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
      gearButton.title = "Settings";
      gearButton.textContent = "⚙";
      gearButton.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
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

      gearMenu = document.createElement("div");
      gearMenu.className = "fce-panel-gear-menu";
      gearMenu.hidden = true;
      gearMenu.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
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
      opacityInput.addEventListener("input", () => {
        const opacity = Number(opacityInput?.value ?? 0.85);
        options.onQuickPanelChange?.({ opacity });
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
      fontInput.addEventListener("input", () => {
        const fontSizePx = Number(fontInput?.value ?? 14);
        options.onQuickPanelChange?.({ fontSizePx });
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

      gearMenu.append(opacityRow, fontRow, optionsButton);

      listEl = document.createElement("div");
      listEl.className = "fce-panel-list";
      listEl.setAttribute("role", "log");
      listEl.setAttribute("aria-live", "polite");

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

      replyHintEl = document.createElement("div");
      replyHintEl.className = "fce-panel-reply-hint";
      replyHintEl.hidden = true;
      const replyLabel = document.createElement("span");
      replyLabel.className = "fce-panel-reply-label";
      const replyCancel = document.createElement("button");
      replyCancel.type = "button";
      replyCancel.className = "fce-panel-reply-cancel";
      replyCancel.textContent = "×";
      replyCancel.addEventListener("click", (event) => {
        event.preventDefault();
        clearReplyTarget();
      });
      replyHintEl.append(replyLabel, replyCancel);

      inputEl = document.createElement("textarea");
      inputEl.className = "fce-panel-input";
      inputEl.rows = 2;
      inputEl.placeholder = "Message…";
      inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && replyToId) {
          clearReplyTarget();
        }
      });

      const sendButton = document.createElement("button");
      sendButton.type = "submit";
      sendButton.className = "fce-panel-send";
      sendButton.textContent = "Send";

      composeEl.append(replyHintEl, inputEl, sendButton);
      let submittedReply: string | null = null;
      unbindCompose = bindCompose(
        composeEl,
        inputEl,
        (text) => {
          submittedReply = replyToId;
          return options.onSend(text, replyToId ?? undefined);
        },
        () => {
          if (replyToId === submittedReply) clearReplyTarget();
        },
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
        gearMenu,
        listEl,
        nativeFrame,
        composeEl,
        resizeE,
        resizeS,
        resizeSe,
      );
      host.append(panelEl);
      injectStyles(host);
      parent.appendChild(host);
      if (settings) {
        applyVisuals(settings);
      }
      renderSurface();
      syncGearControls();
    },
    unmount() {
      unmountInternal();
    },
    setMessages(messages) {
      lastMessages = messages;
      if (!listEl || isNativeMode()) {
        return;
      }
      listEl.replaceChildren();
      for (const message of messages) {
        listEl.appendChild(
          renderRow(message, settings, {
            onReply: message.canReply
              ? () => {
                  setReplyTarget(message);
                }
              : undefined,
          }),
        );
      }
      listEl.scrollTop = listEl.scrollHeight;
    },
    applySettings(next) {
      settings = next;
      applyVisuals(next);
      renderSurface();
      syncGearControls();
      void ensureLocale(next.uiLocale).then(() => {
        if (settings !== next) {
          return;
        }
        renderSurface();
        syncGearControls();
      });
    },
    setNativeChatUrl(url) {
      nativeUrl = url;
      renderSurface();
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
      const fullscreenElement = document.fullscreenElement;
      const target =
        (fullscreenElement instanceof HTMLElement ? fullscreenElement : null) ??
        (mountParent?.isConnected ? mountParent : null) ??
        document.body;
      if (host.parentElement !== target) {
        target.appendChild(host);
      }
    },
  };

  function bindDragHandle(handle: HTMLElement): void {
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
      handle.setPointerCapture(event.pointerId);
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
      event.preventDefault();
    });

    handle.addEventListener("pointermove", (event) => {
      if (
        !dragState ||
        dragState.pointerId !== event.pointerId ||
        !panelEl ||
        !host
      ) {
        return;
      }
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
    });

    const endDrag = (event: PointerEvent) => {
      if (!dragState || dragState.pointerId !== event.pointerId || !panelEl) {
        return;
      }
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
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  function bindResizeHandle(handle: HTMLElement): void {
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
      handle.setPointerCapture(event.pointerId);
      panelEl.dataset.dragging = "1";
      suppressNativePointer = true;
      if (nativeFrame) {
        nativeFrame.style.pointerEvents = "none";
      }
      event.preventDefault();
      event.stopPropagation();
    });

    handle.addEventListener("pointermove", (event) => {
      if (!resizeState || resizeState.pointerId !== event.pointerId || !host) {
        return;
      }
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
    });

    const endResize = (event: PointerEvent) => {
      if (
        !resizeState ||
        resizeState.pointerId !== event.pointerId ||
        !panelEl
      ) {
        return;
      }
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
    };
    handle.addEventListener("pointerup", endResize);
    handle.addEventListener("pointercancel", endResize);
  }

  function isNativeMode(): boolean {
    return Boolean(settings?.panel.useNativeChat && nativeUrl);
  }

  function renderSurface(): void {
    if (!listEl || !composeEl || !nativeFrame) {
      return;
    }
    const native = isNativeMode();
    listEl.hidden = native;
    composeEl.hidden = native;
    nativeFrame.hidden = !native;
    nativeFrame.setAttribute("aria-hidden", native ? "false" : "true");
    if (suppressNativePointer) {
      nativeFrame.style.pointerEvents = "none";
    }

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
    if (inputEl) {
      inputEl.style.display = settings?.compose.enabled === false ? "none" : "";
    }
    if (listEl && lastMessages.length > 0) {
      listEl.replaceChildren();
      for (const message of lastMessages) {
        listEl.appendChild(
          renderRow(message, settings, {
            onReply: message.canReply
              ? () => {
                  setReplyTarget(message);
                }
              : undefined,
          }),
        );
      }
      listEl.scrollTop = listEl.scrollHeight;
    }
  }

  function applyVisuals(next: ExtensionSettings): void {
    if (!host || !panelEl) {
      return;
    }
    panelEl.style.setProperty(
      "--fce-panel-opacity",
      String(next.panel.opacity),
    );
    panelEl.style.setProperty("--fce-panel-font", `${next.panel.fontSizePx}px`);
    panelEl.dataset.idleFade =
      next.panel.idleFade && !next.panel.useNativeChat ? "1" : "0";
    panelEl.dataset.native = next.panel.useNativeChat ? "1" : "0";
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
    if (gearMenu) {
      gearMenu.hidden = !open;
    }
    if (gearButton) {
      gearButton.setAttribute("aria-expanded", open ? "true" : "false");
    }
  }

  function syncGearControls(): void {
    if (!settings) {
      return;
    }
    const locale = settings.uiLocale;
    if (gearButton) {
      const label = t(locale, "panelGear");
      gearButton.title = label;
      gearButton.setAttribute("aria-label", label);
    }
    if (opacityInput) {
      opacityInput.value = String(settings.panel.opacity);
      const row = opacityInput.closest(".fce-panel-gear-row");
      const title = row?.querySelector("span");
      if (title) {
        title.textContent = t(locale, "panelOpacity");
      }
    }
    if (fontInput) {
      fontInput.value = String(settings.panel.fontSizePx);
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
  }

  function unmountInternal(): void {
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
    listEl = null;
    composeEl = null;
    inputEl = null;
    replyHintEl = null;
    nativeFrame = null;
    dragState = null;
    resizeState = null;
    pendingPositions.length = 0;
    positionBeforeSave = undefined;
    suppressNativePointer = false;
    gearOpen = false;
    replyToId = null;
    replyToAuthor = null;
  }

  function setReplyTarget(message: NormalizedMessage): void {
    replyToId = message.id;
    replyToAuthor = message.authorName;
    syncReplyHint();
    inputEl?.focus();
  }

  function clearReplyTarget(): void {
    replyToId = null;
    replyToAuthor = null;
    syncReplyHint();
  }

  function syncReplyHint(): void {
    if (!replyHintEl) {
      return;
    }
    const label = replyHintEl.querySelector(".fce-panel-reply-label");
    if (!replyToId || !replyToAuthor) {
      replyHintEl.hidden = true;
      if (label) {
        label.textContent = "";
      }
      if (inputEl && settings) {
        inputEl.placeholder = t(settings.uiLocale, "composePlaceholder");
      }
      return;
    }
    replyHintEl.hidden = false;
    if (label) {
      const locale = settings?.uiLocale ?? "auto";
      label.textContent = `${t(locale, "replyTo")} @${replyToAuthor}`;
    }
  }
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
  const maxX = Math.max(0, hostWidth - width);
  const maxY = Math.max(0, hostHeight - height);
  return {
    x: Math.min(Math.max(0, Math.round(position.x)), maxX),
    y: Math.min(Math.max(0, Math.round(position.y)), maxY),
    w: width,
    h: height,
  };
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

function renderRow(
  message: NormalizedMessage,
  settings: ExtensionSettings | null,
  actions?: { onReply?: () => void },
): HTMLElement {
  const row = document.createElement("div");
  row.className = "fce-panel-row";
  if (settings?.panel.showAuthor !== false) {
    const author = document.createElement("span");
    author.className = "fce-panel-author";
    author.textContent = message.authorName;
    row.appendChild(author);
  }
  if (settings?.panel.showBadges !== false) {
    const safeIcons =
      message.badgeIcons?.filter(
        (icon) => icon.src && isSafeHttpsImageUrl(icon.src),
      ) ?? [];
    const iconAlts = new Set(safeIcons.map((icon) => icon.alt));
    const textBadges = message.badges.filter(
      (badge) => badge !== "replyable" && !iconAlts.has(badge),
    );
    if (safeIcons.length > 0 || textBadges.length > 0) {
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
  }
  const body = document.createElement("span");
  body.className = "fce-panel-text";
  appendMessageBody(body, message);
  row.appendChild(body);
  if (actions?.onReply) {
    const reply = document.createElement("button");
    reply.type = "button";
    reply.className = "fce-panel-reply";
    reply.textContent = settings
      ? t(settings.uiLocale, "replyAction")
      : "Reply";
    reply.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      actions.onReply?.();
    });
    row.appendChild(reply);
  }
  return row;
}

function injectStyles(host: HTMLElement): void {
  const style = document.createElement("style");
  style.textContent = `
    #${HOST_ID} {
      position: absolute;
      inset: 0;
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
    #${HOST_ID} .fce-panel[data-idle-fade="1"]:not(:hover):not([data-dragging="1"]) {
      opacity: 0.55;
      transition: opacity 160ms ease;
    }
    #${HOST_ID} .fce-panel[data-native="1"] {
      background: rgba(15, 15, 18, 0.35);
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
    #${HOST_ID} .fce-panel-gear-options {
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
    #${HOST_ID} .fce-panel-gear-options:hover {
      background: rgba(255,255,255,0.08);
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
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 2px 8px;
      align-items: start;
    }
    #${HOST_ID} .fce-panel-badge-icon,
    #${HOST_ID} .fce-panel-emoji {
      width: 1.1em;
      height: 1.1em;
      vertical-align: -0.15em;
      margin-inline: 0.1em;
      object-fit: contain;
    }
    #${HOST_ID} .fce-panel-badges,
    #${HOST_ID} .fce-panel-author {
      grid-column: 1 / -1;
    }
    #${HOST_ID} .fce-panel-text { grid-column: 1; }
    #${HOST_ID} .fce-panel-reply {
      grid-column: 2;
      grid-row: 2;
      border: 0;
      background: transparent;
      color: #9ec1ff;
      font: inherit;
      font-size: 11px;
      cursor: pointer;
      padding: 0;
    }
    #${HOST_ID} .fce-panel-reply-hint {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
      color: #9ec1ff;
    }
    #${HOST_ID} .fce-panel-reply-cancel {
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
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
    #${HOST_ID} .fce-panel-compose .fce-panel-reply-hint {
      grid-column: 1 / -1;
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
