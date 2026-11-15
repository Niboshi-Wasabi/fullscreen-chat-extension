import type { NormalizedMessage } from "./message";

export interface ArchiveSyncOptions {
  getOffsetSec: () => number;
  getMaxSkewSec: () => number;
  onDue: (message: NormalizedMessage) => void;
}

/**
 * Release archive/VOD chat lines when the media clock reaches their offset.
 * 再生時刻が各コメントのオフセットに達したら解放する。
 */
export function createArchiveSync(options: ArchiveSyncOptions): {
  ingest(message: NormalizedMessage): void;
  onMediaTime(timeSec: number, meta: { seeked: boolean }): void;
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

      if (meta.seeked) {
        // After seek, only replay a short window so danmaku doesn't flood.
        // シーク後は短い窓だけ再生し、弾幕の洪水を防ぐ。
        cursorSec = target - Math.min(skew, 3);
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
        const lowerBound = meta.seeked
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

      // Cap burst on large forward jumps / 大きく飛ばしたときのバースト上限
      const burst = due.length > 48 ? due.slice(due.length - 48) : due;
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
