import type { MessageSegment, NormalizedMessage } from "../../core/message";
import type { ExtensionSettings } from "../../shared/settings";

const HOST_ID = "fce-danmaku-host";
/** Horizontal gap (px) on the same track — keep tight so the screen fills.
 * 同一軌道の水平ギャップ。画面が埋まるよう詰める。 */
const HORIZONTAL_GAP_PX = 14;
/** Vertical pad between bands / 帯同士の縦余白 */
const VERTICAL_PAD_PX = 2;
/** Timeline sample step for collision (ms) / 衝突判定の時間刻み */
const COLLISION_SAMPLE_MS = 32;
/** Brief waits before accepting overlap when the screen is full.
 * 画面が満杯のとき、重なり許容までに待つ短い回数。 */
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
  applySettings(settings: ExtensionSettings): void;
  reparentForFullscreen(): void;
}

/**
 * One in-flight danmaku — geometry is measured from the real DOM node.
 * 飛行中の 1 本。幾何は実 DOM から測る。
 */
interface ActiveDanmaku {
  id: string;
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
  let settings: ExtensionSettings | null = null;
  let acceptCounter = 0;
  let seq = 0;
  const active = new Map<string, ActiveDanmaku>();
  const pendingItems = new Map<HTMLElement, string>();
  const latestMessages = new Map<string, NormalizedMessage>();
  const timers = new Set<number>();

  return {
    mount(parent) {
      if (host?.isConnected) {
        if (host.parentElement !== parent) {
          parent.appendChild(host);
        }
        ensureHostFillsPlayer(parent);
        return;
      }
      unmount();
      host = document.createElement("div");
      host.id = HOST_ID;
      host.setAttribute("data-fce-view", "danmaku");
      applyHostChrome(host);
      parent.appendChild(host);
      ensureHostFillsPlayer(parent);
    },
    unmount,
    push(message) {
      if (!host || !settings) return;
      latestMessages.set(message.id, message);
      void spawn(message, false, 0);
    },
    update(message, visible) {
      if (visible) {
        if (latestMessages.has(message.id))
          latestMessages.set(message.id, message);
      } else latestMessages.delete(message.id);
      for (const [element, messageId] of pendingItems) {
        if (messageId !== message.id) continue;
        if (!visible) element.remove();
        else if (settings) {
          element.replaceChildren();
          fillDanmakuContent(element, message, settings);
        }
      }
      for (const [id, item] of active) {
        if (item.messageId !== message.id) continue;
        if (!visible) {
          item.element.remove();
          active.delete(id);
        } else if (settings) {
          item.element.replaceChildren();
          fillDanmakuContent(item.element, message, settings);
          item.width = Math.max(item.element.offsetWidth, 1);
          item.height = Math.max(item.element.offsetHeight, 1);
        }
      }
    },
    flush(messages) {
      if (!host || !settings) return;
      // Stagger more on large dumps so collision can settle between spawns.
      // 大量投入時は間隔を空け、衝突判定が落ち着くようにする。
      const recent = messages.slice(-48);
      recent.forEach((message, index) => {
        latestMessages.set(message.id, message);
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          void spawn(message, true, 0);
        }, index * 45);
        timers.add(timer);
      });
    },
    applySettings(next) {
      settings = next;
    },
    reparentForFullscreen() {
      if (!host) {
        return;
      }
      const target = resolveDanmakuParent();
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
    if (!host || !settings) {
      latestMessages.delete(message.id);
      return;
    }
    const mount = host;
    const latest = latestMessages.get(message.id);
    if (!latest) return;
    message = latest;
    const modeAllows =
      settings.displayMode === "danmaku" ||
      (settings.danmakuOverlayOnPanel && settings.danmaku.enabled);
    if (!modeAllows && !settings.danmaku.enabled) {
      latestMessages.delete(message.id);
      return;
    }

    if (!fromFlush && !message.isSelf && attempt === 0) {
      acceptCounter += 1;
      if (!shouldAcceptByDensity(settings.danmaku.density, acceptCounter)) {
        latestMessages.delete(message.id);
        return;
      }
    }

    const hostHeight = Math.max(host.clientHeight, 1);
    const hostWidth = Math.max(host.clientWidth, 1);
    if (hostWidth < 40 || hostHeight < 40) {
      scheduleRetry(message, fromFlush, attempt, 120);
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
    if (message.isSelf) {
      item.dataset.self = "1";
    }
    fillDanmakuContent(item, message, settings);
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
    pendingItems.set(item, message.id);

    await waitForLayout(item);
    pendingItems.delete(item);

    if (!host || host !== mount || !item.isConnected || !settings) {
      if (host === mount) latestMessages.delete(message.id);
      item.remove();
      return;
    }
    const current = latestMessages.get(message.id);
    if (!current) {
      item.remove();
      return;
    }
    if (current !== message) {
      message = current;
      item.replaceChildren();
      fillDanmakuContent(item, message, settings);
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

    const id = `d-${seq++}-${message.id}`;
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
      message.isSelf ? "color:#ffe08a;" : "",
      settings.danmaku.outline
        ? "text-shadow:0 0 2px #000,0 0 3px #000,1px 1px 0 #000,-1px -1px 0 #000"
        : "",
      `transition:transform ${durationSec}s linear`,
    ].join(";");

    const record: ActiveDanmaku = {
      id,
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
      latestMessages.delete(message.id);
      item.remove();
    }, durationMs + 320);
    timers.add(expiry);
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
    timers.add(timer);
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

  function unmount(): void {
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
    timers.clear();
    for (const item of active.values()) {
      item.element.remove();
    }
    active.clear();
    pendingItems.clear();
    latestMessages.clear();
    host?.remove();
    host = null;
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
): void {
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

function resolveDanmakuParent(): HTMLElement {
  const fullscreenElement = document.fullscreenElement;
  if (fullscreenElement instanceof HTMLElement) {
    return fullscreenElement;
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
