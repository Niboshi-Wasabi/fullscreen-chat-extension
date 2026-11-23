import type { NormalizedMessage } from "./message";

export type DelaySuspendReason = "pause" | "seek" | "ad";

export type DelayBufferState =
  { status: "active" } | { status: "suspended"; reason: DelaySuspendReason };

export type DelayCalibrationState =
  | { status: "idle" }
  | { status: "picking"; recordedAtMs: number }
  | {
      status: "suggested";
      recordedAtMs: number;
      messageId: string;
      messageReceivedAtMs: number;
      suggestedDelaySec: number;
    };

export interface LiveDelayBufferOptions {
  initialDelaySec?: number;
  maxEntries?: number;
  maxAgeMs?: number;
  getMaxVisible?: () => number;
  onRelease?: (released: NormalizedMessage[], releasedAtMs: number) => void;
  onVisibleUpdate?: (message: NormalizedMessage) => void;
}

export interface TimedBridgeMessage {
  message: NormalizedMessage;
  displayOrderMs: number;
  orderSeq: number;
}

/** Merge local live messages and released remote messages in display order without duplicates.
 * 視聴サイトのコメントと、遅延待ちが終わった相手サイトのコメントを表示時刻順に並べ、重複を除く。 */
export function mergeLiveBridgeMessages(
  localEntries: readonly TimedBridgeMessage[],
  remoteEntries: readonly TimedBridgeMessage[],
): NormalizedMessage[] {
  const combined: Array<{
    message: NormalizedMessage;
    displayOrderMs: number;
    orderSeq: number;
    sourceRank: 0 | 1;
  }> = [];
  for (const entry of localEntries) {
    combined.push({
      message: entry.message,
      displayOrderMs: entry.displayOrderMs,
      orderSeq: entry.orderSeq,
      sourceRank: 0,
    });
  }
  for (const entry of remoteEntries) {
    combined.push({
      message: entry.message,
      displayOrderMs: entry.displayOrderMs,
      orderSeq: entry.orderSeq,
      sourceRank: 1,
    });
  }
  combined.sort((left, right) => {
    if (left.displayOrderMs !== right.displayOrderMs) {
      return left.displayOrderMs - right.displayOrderMs;
    }
    if (left.orderSeq !== right.orderSeq) {
      return left.orderSeq - right.orderSeq;
    }
    return left.sourceRank - right.sourceRank;
  });
  const seen = new Set<string>();
  const merged: NormalizedMessage[] = [];
  for (const entry of combined) {
    const key = `${entry.message.site}:${entry.message.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(entry.message);
  }
  return merged;
}

export interface LiveDelayBuffer {
  ingest(message: NormalizedMessage, receivedAtMs: number): void;
  tick(nowMs: number): boolean;
  setDelaySec(nextSec: number): number;
  getDelaySec(): number;
  suspend(reason: DelaySuspendReason): void;
  resume(nowMs: number): void;
  reset(): void;
  getState(): DelayBufferState;
  getVisibleMessages(): NormalizedMessage[];
  getVisibleReceivedAtMs(messageId: string): number | null;
  markScene(nowMs: number): boolean;
  selectReaction(messageId: string): number | null;
  applySuggestedDelay(): number | null;
  cancelCalibration(): boolean;
  getCalibration(): DelayCalibrationState;
  getPendingCount(nowMs: number): number;
}

interface BufferedEntry {
  message: NormalizedMessage;
  receivedAtMs: number;
  released: boolean;
  skipped: boolean;
}

interface VisibleEntry {
  message: NormalizedMessage;
  receivedAtMs: number;
}

const MIN_DELAY_SEC = 0;
const MAX_DELAY_SEC = 120;
const DEFAULT_MAX_ENTRIES = 2000;
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;
const RESUME_WINDOW_MS = 2000;

function clampDelaySec(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_DELAY_SEC;
  }
  const clamped = Math.min(
    MAX_DELAY_SEC,
    Math.max(MIN_DELAY_SEC, Math.round(value)),
  );
  return clamped === 0 ? 0 : clamped;
}

/**
 * Compute candidate delay in seconds from scene-mark time and original chat arrival time.
 * 場面記録時刻と元の受信時刻から補正候補秒数を算出する。
 */
export function calculateSuggestedDelaySec(
  sceneRecordedAtMs: number,
  messageReceivedAtMs: number,
): number | null {
  if (
    !Number.isFinite(sceneRecordedAtMs) ||
    !Number.isFinite(messageReceivedAtMs)
  ) {
    return null;
  }
  return clampDelaySec((sceneRecordedAtMs - messageReceivedAtMs) / 1000);
}

/**
 * Wall-clock fixed-delay chat buffer with pause/seek/ad suspension and manual resume.
 * 実時刻を基準にした固定遅延バッファ。一時停止・シーク・広告で非表示にし、手動再開まで待機する。
 */
export function createLiveDelayBuffer(
  options: LiveDelayBufferOptions = {},
): LiveDelayBuffer {
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const maxAgeMs = Math.max(1000, options.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
  const getMaxVisible = options.getMaxVisible ?? (() => 100);

  let delaySec = clampDelaySec(options.initialDelaySec ?? 0);
  let state: DelayBufferState = { status: "active" };
  let calibration: DelayCalibrationState = { status: "idle" };
  let entries: BufferedEntry[] = [];
  const byId = new Map<string, BufferedEntry>();
  let visibleEntries: VisibleEntry[] = [];
  let visibleDirty = false;
  let newestReceivedAtMs = Number.NEGATIVE_INFINITY;

  function capVisible(): void {
    const limit = Math.max(1, Math.floor(getMaxVisible()));
    if (visibleEntries.length > limit) {
      visibleEntries = visibleEntries.slice(visibleEntries.length - limit);
    }
  }

  function findVisibleReceivedAtMs(messageId: string): number | null {
    if (state.status !== "active" || !messageId) {
      return null;
    }
    for (let index = visibleEntries.length - 1; index >= 0; index -= 1) {
      const entry = visibleEntries[index];
      if (entry && entry.message.id === messageId) {
        return entry.receivedAtMs;
      }
    }
    return null;
  }

  function pruneEntries(cutoffMs: number): void {
    if (entries.length === 0) {
      return;
    }
    const kept: BufferedEntry[] = [];
    for (const entry of entries) {
      if (entry.receivedAtMs < cutoffMs) {
        byId.delete(entry.message.id);
      } else {
        kept.push(entry);
      }
    }
    if (kept.length > maxEntries) {
      const overflow = kept.length - maxEntries;
      for (let index = 0; index < overflow; index += 1) {
        const dropped = kept[index];
        if (dropped) {
          byId.delete(dropped.message.id);
        }
      }
      entries = kept.slice(overflow);
      return;
    }
    entries = kept;
  }

  function releaseDue(nowMs: number): boolean {
    const changed = visibleDirty;
    visibleDirty = false;
    if (state.status !== "active") {
      return false;
    }
    const dueCutoffMs = nowMs - delaySec * 1000;
    const due: BufferedEntry[] = [];
    for (const entry of entries) {
      if (
        !entry.released &&
        !entry.skipped &&
        entry.receivedAtMs <= dueCutoffMs
      ) {
        due.push(entry);
      }
    }
    if (due.length === 0) {
      return changed;
    }
    due.sort((left, right) => left.receivedAtMs - right.receivedAtMs);
    const newlyReleased: NormalizedMessage[] = [];
    for (const entry of due) {
      entry.released = true;
      visibleEntries.push({
        message: entry.message,
        receivedAtMs: entry.receivedAtMs,
      });
      newlyReleased.push(entry.message);
    }
    capVisible();
    options.onRelease?.(newlyReleased, nowMs);
    return true;
  }

  return {
    ingest(message, receivedAtMs) {
      const safeReceivedAtMs = Number.isFinite(receivedAtMs)
        ? receivedAtMs
        : Date.now();
      const existing = byId.get(message.id);
      if (existing) {
        // React hydration can enrich the same row; keep original arrival time.
        // 段階描画による同一 ID 更新では元の受信時刻を保つ。
        existing.message = message;
        if (existing.released && state.status === "active") {
          const index = visibleEntries.findIndex(
            (item) => item.message.id === message.id,
          );
          if (index >= 0) {
            visibleEntries[index] = {
              message,
              receivedAtMs: existing.receivedAtMs,
            };
            visibleDirty = true;
            options.onVisibleUpdate?.(message);
          }
        }
        return;
      }
      const entry: BufferedEntry = {
        message,
        receivedAtMs: safeReceivedAtMs,
        released: false,
        skipped: false,
      };
      entries.push(entry);
      byId.set(message.id, entry);
      if (safeReceivedAtMs > newestReceivedAtMs) {
        newestReceivedAtMs = safeReceivedAtMs;
      }
      pruneEntries(newestReceivedAtMs - maxAgeMs);
    },
    tick(nowMs) {
      const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
      pruneEntries(safeNowMs - maxAgeMs);
      return releaseDue(safeNowMs);
    },
    setDelaySec(nextSec) {
      delaySec = Number.isFinite(nextSec) ? clampDelaySec(nextSec) : delaySec;
      return delaySec;
    },
    getDelaySec() {
      return delaySec;
    },
    suspend(reason) {
      state = { status: "suspended", reason };
      calibration = { status: "idle" };
      visibleEntries = [];
      visibleDirty = false;
    },
    resume(nowMs) {
      const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
      state = { status: "active" };
      calibration = { status: "idle" };
      visibleEntries = [];
      visibleDirty = false;
      pruneEntries(safeNowMs - maxAgeMs);
      const staleCutoffMs = safeNowMs - delaySec * 1000 - RESUME_WINDOW_MS;
      for (const entry of entries) {
        if (
          !entry.released &&
          !entry.skipped &&
          entry.receivedAtMs < staleCutoffMs
        ) {
          entry.skipped = true;
        }
      }
      releaseDue(safeNowMs);
    },
    reset() {
      entries = [];
      byId.clear();
      visibleEntries = [];
      visibleDirty = false;
      newestReceivedAtMs = Number.NEGATIVE_INFINITY;
      state = { status: "active" };
      calibration = { status: "idle" };
    },
    getState() {
      return state;
    },
    getVisibleMessages() {
      return visibleEntries.map((entry) => entry.message);
    },
    getVisibleReceivedAtMs: findVisibleReceivedAtMs,
    markScene(nowMs) {
      if (state.status !== "active") {
        return false;
      }
      const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
      calibration = {
        status: "picking",
        recordedAtMs: safeNowMs,
      };
      return true;
    },
    selectReaction(messageId) {
      if (state.status !== "active" || calibration.status === "idle") {
        return null;
      }
      const receivedAtMs = findVisibleReceivedAtMs(messageId);
      if (receivedAtMs === null) {
        return null;
      }
      const suggestedDelaySec = calculateSuggestedDelaySec(
        calibration.recordedAtMs,
        receivedAtMs,
      );
      if (suggestedDelaySec === null) {
        return null;
      }
      calibration = {
        status: "suggested",
        recordedAtMs: calibration.recordedAtMs,
        messageId,
        messageReceivedAtMs: receivedAtMs,
        suggestedDelaySec,
      };
      return suggestedDelaySec;
    },
    applySuggestedDelay() {
      if (state.status !== "active" || calibration.status !== "suggested") {
        return null;
      }
      delaySec = clampDelaySec(calibration.suggestedDelaySec);
      calibration = { status: "idle" };
      return delaySec;
    },
    cancelCalibration() {
      if (calibration.status === "idle") {
        return false;
      }
      calibration = { status: "idle" };
      return true;
    },
    getCalibration() {
      return { ...calibration };
    },
    getPendingCount(nowMs) {
      const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
      const cutoff = safeNowMs - maxAgeMs;
      let count = 0;
      for (const entry of entries) {
        if (!entry.released && !entry.skipped && entry.receivedAtMs >= cutoff) {
          count += 1;
        }
      }
      return count;
    },
  };
}
