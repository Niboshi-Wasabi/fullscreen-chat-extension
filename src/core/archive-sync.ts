import type { NormalizedMessage } from "./message";

/** Parse `MM:SS` or `H:MM:SS` playback timestamp (preserving negative pre-stream stamps when enabled).
 * `MM:SS` または `H:MM:SS` の再生位置文字列を秒へ変換する。 */
export function parseClockToSeconds(
  value: string,
  options?: { allowNegative?: boolean },
): number | undefined {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  if (negative && !options?.allowNegative) {
    return undefined;
  }
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const match = unsigned.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return undefined;
  }
  const total =
    match[3] !== undefined
      ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      : Number(match[1]) * 60 + Number(match[2]);
  return negative ? -total : total;
}

export interface ArchiveSyncOptions {
  getOffsetSec: () => number;
  getMaxSkewSec: () => number;
  onDue: (message: NormalizedMessage) => void;
  onSeekJump?: () => void;
}

/**
 * Release archive/VOD chat lines when the media clock reaches their offset.
 * 再生時刻が各コメントのオフセットに達したら解放する。
 */
export function createArchiveSync(options: ArchiveSyncOptions): {
  ingest(message: NormalizedMessage): void;
  onMediaTime(
    timeSec: number,
    meta: { seeked: boolean; seeking?: boolean; initial?: boolean },
  ): void;
  /** Messages with offset <= media+offset (for panel history).
   * パネル履歴用。再生位置までのメッセージ。 */
  visibleUpTo(timeSec: number): NormalizedMessage[];
  reset(): void;
  size(): number;
} {
  const byId = new Map<string, NormalizedMessage>();
  const releasedIds = new Set<string>();
  let cursorSec = Number.NEGATIVE_INFINITY;

  return {
    ingest(message) {
      if (message.videoOffsetSec === undefined) {
        options.onDue(message);
        return;
      }
      byId.set(message.id, message);
      // Immediate catch-up if media is already past this line.
      // すでに再生位置を過ぎていればすぐ出す。
      // (Caller should also drive onMediaTime; this helps late scrapes.)
    },
    onMediaTime(timeSec, meta) {
      const target = timeSec + options.getOffsetSec();
      const skew = Math.max(0.25, options.getMaxSkewSec());
      const isJump =
        meta.seeked ||
        (cursorSec !== Number.NEGATIVE_INFINITY &&
          (target < cursorSec - 1 ||
            target - cursorSec > Math.max(skew * 2, 5)));

      if (meta.seeking) {
        options.onSeekJump?.();
        cursorSec = target;
        return;
      }

      if (isJump) {
        if (!meta.initial) {
          options.onSeekJump?.();
        }
        // After seek/jump, only replay a short window so danmaku doesn't flood.
        // シーク後は再生するコメントを短い時間幅に絞り、弾幕が一度に表示されすぎるのを防ぐ。
        cursorSec = target - Math.min(skew, 2);
        for (const id of [...releasedIds]) {
          const message = byId.get(id);
          if (!message || (message.videoOffsetSec ?? 0) > cursorSec) {
            releasedIds.delete(id);
          }
        }
      }

      const due: NormalizedMessage[] = [];
      for (const message of byId.values()) {
        const offset = message.videoOffsetSec;
        if (offset === undefined || releasedIds.has(message.id)) {
          continue;
        }
        const lowerBound = isJump
          ? cursorSec
          : Math.min(cursorSec, target - skew);
        if (offset > lowerBound && offset <= target) {
          due.push(message);
        }
      }
      due.sort(
        (left, right) =>
          (left.videoOffsetSec ?? 0) - (right.videoOffsetSec ?? 0),
      );

      // Cap seek bursts tightly so rapid jumps never flood the screen.
      // シーク時はバースト上限をさらに抑え、連打時も画面が埋まらないようにする。
      const maxBurst = isJump ? 6 : 36;
      const burst =
        due.length > maxBurst ? due.slice(due.length - maxBurst) : due;
      for (const message of due) releasedIds.add(message.id);
      for (const message of burst) {
        options.onDue(message);
      }
      cursorSec = Math.max(cursorSec, target);
    },
    visibleUpTo(timeSec) {
      const target = timeSec + options.getOffsetSec();
      return [...byId.values()]
        .filter(
          (message) =>
            message.videoOffsetSec !== undefined &&
            message.videoOffsetSec <= target,
        )
        .sort(
          (left, right) =>
            (left.videoOffsetSec ?? 0) - (right.videoOffsetSec ?? 0),
        );
    },
    reset() {
      byId.clear();
      releasedIds.clear();
      cursorSec = Number.NEGATIVE_INFINITY;
    },
    size() {
      return byId.size;
    },
  };
}
