import { describe, expect, it, vi } from "vitest";
import {
  createArchiveSync,
  parseClockToSeconds,
} from "../../src/core/archive-sync";
import type { NormalizedMessage } from "../../src/core/message";
import { message } from "../helpers";

function setup() {
  const released: NormalizedMessage[] = [];
  const sync = createArchiveSync({
    getOffsetSec: () => 0,
    getMaxSkewSec: () => 2,
    onDue: (line) => released.push(line),
  });
  return { sync, released };
}

describe("archive synchronization", () => {
  it("releases live messages immediately and orders due archive lines once", () => {
    const { sync, released } = setup();
    sync.ingest(message({ id: "live" }));
    sync.ingest(message({ id: "later", videoOffsetSec: 2 }));
    sync.ingest(message({ id: "earlier", videoOffsetSec: 1 }));
    sync.onMediaTime(2, { seeked: false });
    sync.onMediaTime(2, { seeked: false });
    expect(released.map((line) => line.id)).toEqual([
      "live",
      "earlier",
      "later",
    ]);
  });

  it("does not flood old history after a forward seek and can replay after a rewind", () => {
    const { sync, released } = setup();
    for (const offset of [1, 9, 99, 100])
      sync.ingest(message({ id: String(offset), videoOffsetSec: offset }));
    sync.onMediaTime(100, { seeked: true });
    expect(released.map((line) => line.id)).toEqual(["99", "100"]);
    released.length = 0;
    sync.onMediaTime(10, { seeked: true });
    expect(released.map((line) => line.id)).toEqual(["9"]);
    sync.reset();
    expect(sync.size()).toBe(0);
    expect(sync.visibleUpTo(100)).toEqual([]);
  });

  it("applies a configurable offset without releasing future lines", () => {
    const released: NormalizedMessage[] = [];
    const sync = createArchiveSync({
      getOffsetSec: () => 3,
      getMaxSkewSec: () => 1,
      onDue: (line) => released.push(line),
    });
    sync.ingest(message({ id: "due", videoOffsetSec: 5 }));
    sync.ingest(message({ id: "future", videoOffsetSec: 6 }));
    sync.onMediaTime(2, { seeked: false });
    expect(released.map((line) => line.id)).toEqual(["due"]);
    expect(sync.visibleUpTo(2).map((line) => line.id)).toEqual(["due"]);
  });
});

it("releases a late scrape within maxSkew once, but skips expired and future lines", () => {
  const { sync, released } = setup();
  sync.onMediaTime(100, { seeked: false });
  sync.ingest(message({ id: "late", videoOffsetSec: 99.5 }));
  sync.ingest(message({ id: "expired", videoOffsetSec: 90 }));
  sync.ingest(message({ id: "future", videoOffsetSec: 110 }));
  sync.onMediaTime(100.1, { seeked: false });
  sync.onMediaTime(100.2, { seeked: false });
  expect(released.map((line) => line.id)).toEqual(["late"]);
});

it("treats large timeupdate jumps as seeks, pauses during seeking, and replays already-loaded scenes", () => {
  const released: NormalizedMessage[] = [];
  const onSeekJump = vi.fn();
  const sync = createArchiveSync({
    getOffsetSec: () => 0,
    getMaxSkewSec: () => 2,
    onDue: (line) => released.push(line),
    onSeekJump,
  });
  for (const sec of [10, 11, 100, 200, 300, 499, 500]) {
    sync.ingest(message({ id: `m-${sec}`, videoOffsetSec: sec }));
  }

  // Play at 11s -> releases m-10, m-11
  sync.onMediaTime(11, { seeked: false });
  expect(released.map((m) => m.id)).toEqual(["m-10", "m-11"]);
  released.length = 0;

  // Scrubbing while seeking=true clears board without emitting intermediate scrub positions
  sync.onMediaTime(200, { seeked: true, seeking: true });
  sync.onMediaTime(300, { seeked: true, seeking: true });
  expect(onSeekJump).toHaveBeenCalledTimes(2);
  expect(released).toEqual([]);

  // Large forward jump even without seeked=true does not dump 100/200/300
  sync.onMediaTime(500, { seeked: false });
  expect(released.map((m) => m.id)).toEqual(["m-499", "m-500"]);
  released.length = 0;

  // Returning to already-loaded 10s scene replays m-10 and m-11 as time advances
  sync.onMediaTime(10, { seeked: true, seeking: false });
  expect(released.map((m) => m.id)).toEqual(["m-10"]);
  sync.onMediaTime(11, { seeked: false });
  expect(released.map((m) => m.id)).toEqual(["m-10", "m-11"]);
});

it("parses replay clock timestamps and preserves negative pre-stream stamps", () => {
  expect(parseClockToSeconds("-0:47")).toBeUndefined();
  expect(parseClockToSeconds("-0:47", { allowNegative: true })).toBe(-47);
  expect(parseClockToSeconds("-28:41", { allowNegative: true })).toBe(-1721);
  expect(parseClockToSeconds("4:51", { allowNegative: true })).toBe(291);
  expect(parseClockToSeconds("1:02:05")).toBe(3725);

  const released: NormalizedMessage[] = [];
  const sync = createArchiveSync({
    getOffsetSec: () => 0,
    getMaxSkewSec: () => 2,
    onDue: (line) => released.push(line),
  });
  sync.ingest(message({ id: "early-pre", videoOffsetSec: -1721 }));
  sync.ingest(message({ id: "just-pre", videoOffsetSec: -1 }));
  sync.ingest(message({ id: "start", videoOffsetSec: 1 }));
  sync.onMediaTime(0, { seeked: true, initial: true });
  expect(released.map((m) => m.id)).toEqual(["just-pre"]);
  sync.onMediaTime(1, { seeked: false });
  expect(released.map((m) => m.id)).toEqual(["just-pre", "start"]);
});
