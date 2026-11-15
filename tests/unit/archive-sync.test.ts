import { describe, expect, it } from "vitest";
import { createArchiveSync } from "../../src/core/archive-sync";
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
