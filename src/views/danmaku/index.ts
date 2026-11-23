import type {
  MessageSegment,
  NormalizedMessage,
  SiteKind,
} from "../../core/message";
import { isSafeHttpsImageUrl } from "../../shared/safe-image-url";
import type { ExtensionSettings } from "../../shared/settings";
import { createSiteBadge } from "../../ui/site-icons";

const HOST_ID = "fce-danmaku-host";
/** Horizontal gap (px) on the same track — keep tight so the screen fills.
 * 同一軌道の水平ギャップ。画面が埋まるよう詰める。 */
const HORIZONTAL_GAP_PX = 14;
/** Vertical pad between bands / 帯同士の縦余白 */
const VERTICAL_PAD_PX = 2;
/** Timeline sample step for collision (ms) / 衝突判定の時間刻み */
const COLLISION_SAMPLE_MS = 32;
/** Brief waits before accepting overlap when the screen is full.
 * 表示する位置が空いていないとき、重なりを許容するまでの再試行回数。 */
const MAX_CLEAR_ATTEMPTS = 4;
/** Extra delay (ms) per clear retry / 空き待ちの追加遅延 */
const CLEAR_RETRY_BASE_MS = 70;

export interface DanmakuController {
  mount(parent: HTMLElement): void;
  unmount(): void;
  push(message: NormalizedMessage): void;
  /** Update an in-flight row without starting another animation. */
  update(message: NormalizedMessage, visible: boolean): void;
  flush(messages: NormalizedMessage[]): void;
  clear(): void;
  clearSite?(site: SiteKind): void;
  applySettings(settings: ExtensionSettings): void;
  setMixedMode?(mixed: boolean): void;
  reparentForFullscreen(): void;
}

/**
 * One in-flight danmaku — geometry is measured from the real DOM node.
 * 画面を流れているコメント 1 件。位置と寸法は DOM 要素から実測する。
 */
interface ActiveDanmaku {
  id: string;
  site: SiteKind;
  messageId: string;
  element: HTMLElement;
  top: number;
  height: number;
  width: number;
  travel: number;
  startMs: number;
  durationMs: number;
  hostWidth: number;
}

/**
 * Danmaku that assigns each comment a Y from measured bounds + path collision.
 * 実測サイズと軌道衝突から、コメントごとに Y を割り当てる弾幕。
 */
export function createDanmakuView(): DanmakuController {
  let host: HTMLDivElement | null = null;
  let mountParent: HTMLElement | null = null;
  let settings: ExtensionSettings | null = null;
  let mixedMode = false;
  let acceptCounter = 0;
  let seq = 0;
  const active = new Map<string, ActiveDanmaku>();
  const pendingItems = new Map<
    HTMLElement,
    { messageId: string; site: SiteKind }
  >();
  const latestMessages = new Map<string, NormalizedMessage>();
  const timers = new Map<number, SiteKind>();

  return {
    mount(parent) {
      mountParent = parent;
      const target =
        (document.fullscreenElement instanceof HTMLElement
          ? document.fullscreenElement
          : null) ?? parent;
      if (host?.isConnected) {
        if (host.parentElement !== target) {
          target.appendChild(host);
        }
        ensureHostFillsPlayer(target);
        return;
      }
      unmount();
      host = document.createElement("div");
      host.id = HOST_ID;
      host.setAttribute("data-fce-view", "danmaku");
      applyHostChrome(host);
      target.appendChild(host);
      ensureHostFillsPlayer(target);
    },
    unmount,
    clear: clearBoard,
    clearSite,
    push(message) {
      if (!host || !settings) return;
      latestMessages.set(messageKey(message), message);
      void spawn(message, false, 0);
    },
    update(message, visible) {
      const key = messageKey(message);
      if (visible) {
        if (latestMessages.has(key)) latestMessages.set(key, message);
      } else latestMessages.delete(key);
      for (const [element, pending] of pendingItems) {
        if (pending.site !== message.site || pending.messageId !== message.id) {
          continue;
        }
        if (!visible) {
          pendingItems.delete(element);
          element.remove();
        } else if (settings) {
          element.replaceChildren();
          fillDanmakuContent(element, message, settings, mixedMode);
        }
      }
      for (const [id, item] of active) {
        if (item.site !== message.site || item.messageId !== message.id) {
          continue;
        }
        if (!visible) {
          item.element.remove();
          active.delete(id);
        } else if (settings) {
          item.element.replaceChildren();
          fillDanmakuContent(item.element, message, settings, mixedMode);
          item.width = Math.max(item.element.offsetWidth, 1);
          item.height = Math.max(item.element.offsetHeight, 1);
        }
      }
    },
    flush(messages) {
      if (!host || !settings) return;
      // Stagger more on large dumps so collision can settle between spawns.
      // 大量投入時は間隔を空け、コメント同士の重なりを判定できるようにする。
      const recent = messages.slice(-48);
      recent.forEach((message, index) => {
        latestMessages.set(messageKey(message), message);
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          void spawn(message, true, 0);
        }, index * 45);
        timers.set(timer, message.site);
      });
    },
    applySettings(next) {
      settings = next;
    },
    setMixedMode(mixed) {
      mixedMode = mixed;
    },
    reparentForFullscreen() {
      if (!host) {
        return;
      }
      const target = resolveDanmakuParent(
        mountParent?.isConnected ? mountParent : null,
      );
      if (host.parentElement !== target) {
        target.appendChild(host);
      }
      ensureHostFillsPlayer(target);
      applyHostChrome(host);
    },
  };

  async function spawn(
    message: NormalizedMessage,
    fromFlush: boolean,
    attempt: number,
  ): Promise<void> {
    const key = messageKey(message);
    if (!host || !settings) {
      latestMessages.delete(key);
      return;
    }
    // Background tabs pause requestAnimationFrame; skip spawning so nodes never pile up.
    if (typeof document !== "undefined" && document.hidden) {
      latestMessages.delete(key);
      return;
    }
    const mount = host;
    const latest = latestMessages.get(key);
    if (!latest) return;
    message = latest;
    const modeAllows =
      settings.displayMode === "danmaku" ||
      (settings.danmakuOverlayOnPanel && settings.danmaku.enabled);
    if (!modeAllows && !settings.danmaku.enabled) {
      latestMessages.delete(key);
      return;
    }

    if (!fromFlush && !message.isSelf && attempt === 0) {
      acceptCounter += 1;
      if (!shouldAcceptByDensity(settings.danmaku.density, acceptCounter)) {
        latestMessages.delete(key);
        return;
      }
    }

    const hostHeight = Math.max(host.clientHeight, 1);
    const hostWidth = Math.max(host.clientWidth, 1);
    if (hostWidth < 40 || hostHeight < 40) {
      if (attempt >= MAX_CLEAR_ATTEMPTS) {
        latestMessages.delete(key);
        return;
      }
      scheduleRetry(message, fromFlush, attempt + 1, 120);
      return;
    }

    pruneActive();

    const fontSize = Math.max(settings.danmaku.fontSizePx, 16);
    const durationSec = Math.max(settings.danmaku.speed, 2);
    const durationMs = Math.round(durationSec * 1000);

    // Measure first (hidden) so allocation uses real width/height.
    // 先に隠して実寸を測り、その値で座標を決める。
    const item = document.createElement("div");
    item.className = "fce-danmaku-item";
    item.dataset.site = message.site;
    if (message.isSelf) {
      item.dataset.self = "1";
    }
    fillDanmakuContent(item, message, settings, mixedMode);
    item.style.cssText = [
      "position:absolute",
      "top:0",
      "left:0",
      "visibility:hidden",
      "pointer-events:none",
      `font-size:${fontSize}px`,
      "font-weight:700",
      'font-family:"Segoe UI Semibold","Segoe UI",Meiryo,"Hiragino Sans",sans-serif',
      "line-height:1.15",
      "white-space:nowrap",
      "display:inline-flex",
      "align-items:center",
      "gap:0.15em",
    ].join(";");
    host.appendChild(item);
    pendingItems.set(item, { messageId: message.id, site: message.site });

    await waitForLayout(item);
    pendingItems.delete(item);

    if (!host || host !== mount || !item.isConnected || !settings) {
      if (host === mount) latestMessages.delete(key);
      item.remove();
      return;
    }
    const current = latestMessages.get(key);
    if (!current) {
      item.remove();
      return;
    }
    if (current !== message) {
      message = current;
      item.replaceChildren();
      fillDanmakuContent(item, message, settings, mixedMode);
    }

    const width = Math.max(item.offsetWidth, 1);
    const height = Math.max(item.offsetHeight, fontSize);
    const travel = hostWidth + width + HORIZONTAL_GAP_PX;
    const safeBottom = Math.min(
      Math.max(settings.danmaku.safeZoneBottomRatio, 0),
      0.25,
    );
    const topPad = Math.round(hostHeight * 0.02);
    const usableBottom = Math.max(
      topPad + height,
      Math.round(hostHeight * (1 - safeBottom)),
    );

    const now = performance.now();
    const placement = findBestTop({
      now,
      topPad,
      usableBottom,
      height,
      width,
      travel,
      durationMs,
      hostWidth,
      preferTop: Boolean(message.isSelf),
    });

    // Prefer a free track; if the board is full, retry briefly then allow overlap.
    // 空き軌道を優先。満杯なら短く待ってから重なりを許容する。
    if (!placement.clear && attempt < MAX_CLEAR_ATTEMPTS) {
      item.remove();
      scheduleRetry(
        message,
        fromFlush,
        attempt + 1,
        CLEAR_RETRY_BASE_MS + attempt * 40,
      );
      return;
    }
    const top = placement.top;

    const id = `d-${seq++}-${key}`;
    item.style.cssText = [
      "position:absolute",
      `top:${Math.round(top)}px`,
      "left:100%",
      `font-size:${fontSize}px`,
      "font-weight:700",
      'font-family:"Segoe UI Semibold","Segoe UI",Meiryo,"Hiragino Sans",sans-serif',
      "line-height:1.15",
      `opacity:${settings.danmaku.opacity}`,
      "white-space:nowrap",
      "display:inline-flex",
      "align-items:center",
      "gap:0.15em",
      "color:#fff",
      "visibility:visible",
      "will-change:transform",
      "transform:translateX(0)",
      "pointer-events:none",
      message.isSelf ? "color:#ffe08a" : "",
      settings.danmaku.outline
        ? "text-shadow:0 0 2px #000,0 0 3px #000,1px 1px 0 #000,-1px -1px 0 #000"
        : "",
      `transition:transform ${durationSec}s linear`,
    ].join(";");

    const record: ActiveDanmaku = {
      id,
      site: message.site,
      messageId: message.id,
      element: item,
      top,
      height,
      width,
      travel,
      startMs: now,
      durationMs,
      hostWidth,
    };
    active.set(id, record);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!item.isConnected) {
          return;
        }
        item.style.transform = `translateX(-${travel}px)`;
      });
    });

    const expiry = window.setTimeout(() => {
      timers.delete(expiry);
      active.delete(id);
      latestMessages.delete(key);
      item.remove();
    }, durationMs + 320);
    timers.set(expiry, message.site);
  }

  /**
   * Pick Y from measured height: free path if possible, else least overlap.
   * 実測高さで Y を選ぶ。空きがあればそこ、なければ重なり最小。
   */
  function findBestTop(input: {
    now: number;
    topPad: number;
    usableBottom: number;
    height: number;
    width: number;
    travel: number;
    durationMs: number;
    hostWidth: number;
    preferTop: boolean;
  }): { top: number; clear: boolean } {
    // Step ≈ comment height so bands pack tightly across the player.
    // コメント高さに近い刻みで、画面を密に埋める。
    const maxTop = input.usableBottom - input.height;
    if (maxTop < input.topPad)
      return { top: input.topPad, clear: active.size === 0 };
    const count = Math.max(
      1,
      Math.min(
        settings?.danmaku.maxLines ?? 40,
        Math.floor(
          (input.usableBottom - input.topPad) /
            (input.height + VERTICAL_PAD_PX),
        ),
      ),
    );
    const candidates = Array.from({ length: count }, (_, index) =>
      count === 1
        ? input.topPad
        : input.topPad + (index * (maxTop - input.topPad)) / (count - 1),
    );
    if (!input.preferTop) {
      for (let index = 1; index < candidates.length - 1; index += 2) {
        const swapWith = Math.min(index + 1, candidates.length - 1);
        const tmp = candidates[index]!;
        candidates[index] = candidates[swapWith]!;
        candidates[swapWith] = tmp;
      }
    }

    let bestTop = candidates[0] ?? input.topPad;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const top of candidates) {
      const score = collisionScore({
        now: input.now,
        top,
        height: input.height,
        width: input.width,
        travel: input.travel,
        durationMs: input.durationMs,
        hostWidth: input.hostWidth,
      });
      if (score === 0) {
        return { top, clear: true };
      }
      if (score < bestScore) {
        bestScore = score;
        bestTop = top;
      }
    }
    return { top: bestTop, clear: false };
  }

  /** 0 = clear path; higher = more predicted overlap samples.
   * 0 なら空き。大きいほど予測上の重なりが多い。 */
  function collisionScore(candidate: {
    now: number;
    top: number;
    height: number;
    width: number;
    travel: number;
    durationMs: number;
    hostWidth: number;
  }): number {
    let score = 0;
    for (const other of active.values()) {
      score += pathsCollisionWeight(
        candidate,
        other,
        candidate.now,
        candidate.hostWidth,
      );
    }
    return score;
  }

  function scheduleRetry(
    message: NormalizedMessage,
    fromFlush: boolean,
    attempt: number,
    delayMs: number,
  ): void {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      void spawn(message, fromFlush, attempt);
    }, delayMs);
    timers.set(timer, message.site);
  }

  function pruneActive(): void {
    const now = performance.now();
    for (const [id, item] of active) {
      if (
        !item.element.isConnected ||
        now - item.startMs > item.durationMs + 400
      ) {
        active.delete(id);
      }
    }
  }

  function clearSite(site: SiteKind): void {
    for (const [timer, timerSite] of timers) {
      if (timerSite !== site) continue;
      window.clearTimeout(timer);
      timers.delete(timer);
    }
    for (const [element, pending] of pendingItems) {
      if (pending.site !== site) continue;
      pendingItems.delete(element);
      element.remove();
    }
    for (const [id, item] of active) {
      if (item.site !== site) continue;
      item.element.remove();
      active.delete(id);
    }
    for (const [key, msg] of latestMessages) {
      if (msg.site === site) {
        latestMessages.delete(key);
      }
    }
  }

  function clearBoard(): void {
    for (const timer of timers.keys()) {
      window.clearTimeout(timer);
    }
    timers.clear();
    for (const element of pendingItems.keys()) {
      element.remove();
    }
    pendingItems.clear();
    for (const item of active.values()) {
      item.element.remove();
    }
    active.clear();
    latestMessages.clear();
  }

  function messageKey(message: Pick<NormalizedMessage, "id" | "site">): string {
    return `${message.site ?? ""}:${message.id}`;
  }

  function unmount(): void {
    clearBoard();
    host?.remove();
    host = null;
    mixedMode = false;
    acceptCounter = 0;
  }
}

/**
 * Predict left/right edges over time from measured width + travel.
 * 実測幅と移動距離から、時刻ごとの左右端を予測する。
 */
function edgeAt(
  startMs: number,
  durationMs: number,
  travel: number,
  width: number,
  hostWidth: number,
  timeMs: number,
): { left: number; right: number } {
  const progress = Math.min(
    1,
    Math.max(0, (timeMs - startMs) / Math.max(durationMs, 1)),
  );
  const left = hostWidth - progress * travel;
  return { left, right: left + width };
}

function verticallyOverlaps(
  topA: number,
  heightA: number,
  topB: number,
  heightB: number,
): boolean {
  return (
    topA < topB + heightB + VERTICAL_PAD_PX &&
    topB < topA + heightA + VERTICAL_PAD_PX
  );
}

function pathsCollisionWeight(
  candidate: {
    now: number;
    top: number;
    height: number;
    width: number;
    travel: number;
    durationMs: number;
  },
  other: ActiveDanmaku,
  now: number,
  hostWidth: number,
): number {
  if (
    !verticallyOverlaps(
      candidate.top,
      candidate.height,
      other.top,
      other.height,
    )
  ) {
    return 0;
  }

  const end = now + candidate.durationMs;
  const otherEnd = other.startMs + other.durationMs;
  const overlapStart = Math.max(now, other.startMs);
  const overlapEnd = Math.min(end, otherEnd);
  if (overlapStart > overlapEnd) {
    return 0;
  }

  let hits = 0;
  for (
    let time = overlapStart;
    time <= overlapEnd;
    time += COLLISION_SAMPLE_MS
  ) {
    const a = edgeAt(
      now,
      candidate.durationMs,
      candidate.travel,
      candidate.width,
      hostWidth,
      time,
    );
    const b = edgeAt(
      other.startMs,
      other.durationMs,
      other.travel,
      other.width,
      other.hostWidth || hostWidth,
      time,
    );
    if (
      a.left < b.right + HORIZONTAL_GAP_PX &&
      b.left < a.right + HORIZONTAL_GAP_PX
    ) {
      hits += 1;
    }
  }
  return hits;
}

function waitForLayout(element: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      // Emoji images may still be decoding — one extra frame helps width settle.
      // 絵文字画像のデコード待ちのためもう 1 フレーム見る。
      requestAnimationFrame(() => resolve());
      void element.offsetWidth;
    });
  });
}

function fillDanmakuContent(
  item: HTMLElement,
  message: NormalizedMessage,
  settings: ExtensionSettings,
  mixedMode = false,
): void {
  if (mixedMode) {
    const siteBadge = createSiteBadge(message.site, "fce-danmaku-site");
    siteBadge.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "width:0.95em",
      "height:0.95em",
      "margin-right:0.15em",
      "flex-shrink:0",
      "filter:drop-shadow(0 1px 2px rgba(0,0,0,0.85))",
    ].join(";");
    const svg = siteBadge.firstElementChild as SVGElement | null;
    if (svg) {
      svg.style.display = "block";
      svg.style.width = "100%";
      svg.style.height = "100%";
    }
    item.appendChild(siteBadge);
  }
  if (settings.danmaku.showAuthor) {
    const author = document.createElement("span");
    author.className = "fce-danmaku-author";
    author.textContent = `${message.authorName}:`;
    item.appendChild(author);
  }

  const segments = message.segments?.length
    ? message.segments
    : ([{ type: "text", text: message.text }] as MessageSegment[]);

  for (const segment of segments) {
    if (segment.type === "text") {
      if (!segment.text) {
        continue;
      }
      const span = document.createElement("span");
      span.textContent = segment.text;
      item.appendChild(span);
      continue;
    }
    if (!isSafeHttpsImageUrl(segment.src)) {
      const fallback = document.createElement("span");
      fallback.textContent = segment.alt ? `:${segment.alt}:` : "✦";
      item.appendChild(fallback);
      continue;
    }
    const img = document.createElement("img");
    img.className = "fce-danmaku-emoji";
    img.src = segment.src;
    img.alt = segment.alt;
    img.draggable = false;
    img.decoding = "async";
    const emojiSize = Math.max(settings.danmaku.fontSizePx + 4, 22);
    img.style.cssText = [
      `height:${emojiSize}px`,
      "width:auto",
      "display:inline-block",
      "vertical-align:middle",
      "object-fit:contain",
    ].join(";");
    item.appendChild(img);
  }
}

function applyHostChrome(host: HTMLElement): void {
  host.style.cssText = [
    "position:absolute",
    "inset:0",
    "width:100%",
    "height:100%",
    "overflow:hidden",
    "pointer-events:none",
    "z-index:2147482990",
  ].join(";");
}

function resolveDanmakuParent(preferred: HTMLElement | null): HTMLElement {
  const fullscreenElement = document.fullscreenElement;
  if (fullscreenElement instanceof HTMLElement) {
    return fullscreenElement;
  }
  if (preferred) {
    return preferred;
  }
  return (
    document.querySelector<HTMLElement>(".html5-video-player") ??
    document.querySelector<HTMLElement>("#movie_player") ??
    document.querySelector<HTMLElement>(".video-player__container") ??
    document.querySelector<HTMLElement>("[data-a-target='video-player']") ??
    document.body
  );
}

function ensureHostFillsPlayer(parent: HTMLElement): void {
  if (parent === document.body || parent === document.documentElement) {
    return;
  }
  const style = window.getComputedStyle(parent);
  if (style.position === "static") {
    parent.style.position = "relative";
  }
}

function shouldAcceptByDensity(
  density: ExtensionSettings["danmaku"]["density"],
  acceptCounter: number,
): boolean {
  if (density === "high") {
    return true;
  }
  if (acceptCounter <= 2) {
    return true;
  }
  const keepEvery = density === "low" ? 3 : 2;
  return acceptCounter % keepEvery === 0;
}
