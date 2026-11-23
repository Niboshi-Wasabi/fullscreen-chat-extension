import { describe, expect, it, vi } from "vitest";
import {
  calculateSuggestedDelaySec,
  createLiveDelayBuffer,
  mergeLiveBridgeMessages,
} from "../../src/core/live-delay-buffer";
import { message } from "../helpers";

describe("live delay buffer", () => {
  it("releases immediately when delay is 0s and holds until due when delayed", () => {
    const buffer = createLiveDelayBuffer({ initialDelaySec: 0 });
    buffer.ingest(message({ id: "t0", site: "twitch", text: "GG" }), 10_000);
    expect(buffer.tick(10_000)).toBe(true);
    expect(buffer.getVisibleMessages().map((item) => item.id)).toEqual(["t0"]);

    expect(buffer.setDelaySec(8)).toBe(8);
    buffer.ingest(message({ id: "t1", site: "twitch", text: "Nice!" }), 12_000);
    buffer.ingest(
      message({ id: "t2", site: "twitch", text: "Clutch" }),
      11_000,
    );

    expect(buffer.tick(18_999)).toBe(false);
    expect(buffer.getPendingCount(18_999)).toBe(2);

    // At 19_000, t2 (received 11_000 + 8_000) becomes due while t1 waits.
    expect(buffer.tick(19_000)).toBe(true);
    expect(buffer.getVisibleMessages().map((item) => item.id)).toEqual([
      "t0",
      "t2",
    ]);

    // At 20_000, t1 becomes due.
    expect(buffer.tick(20_000)).toBe(true);
    expect(buffer.getVisibleMessages().map((item) => item.id)).toEqual([
      "t0",
      "t2",
      "t1",
    ]);
    expect(buffer.getPendingCount(20_000)).toBe(0);
  });

  it("clamps delay between 0s and 120s and updates visible list on delay decrease", () => {
    const buffer = createLiveDelayBuffer({ initialDelaySec: 200 });
    expect(buffer.getDelaySec()).toBe(120);
    expect(buffer.setDelaySec(-10)).toBe(0);

    buffer.setDelaySec(15);
    buffer.ingest(message({ id: "m1", site: "twitch" }), 10_000);
    expect(buffer.tick(18_000)).toBe(false);

    buffer.setDelaySec(5);
    expect(buffer.tick(18_000)).toBe(true);
    expect(buffer.getVisibleMessages().map((item) => item.id)).toEqual(["m1"]);
  });

  it("clears visible lines on pause/seek/ad suspend and skips stale backlog on manual resume", () => {
    const buffer = createLiveDelayBuffer({ initialDelaySec: 8 });
    buffer.ingest(message({ id: "before", site: "twitch" }), 10_000);
    expect(buffer.tick(18_000)).toBe(true);
    expect(buffer.getVisibleMessages()).toHaveLength(1);

    for (const reason of ["pause", "seek", "ad"] as const) {
      buffer.suspend(reason);
      expect(buffer.getState()).toEqual({ status: "suspended", reason });
      expect(buffer.getVisibleMessages()).toEqual([]);
      expect(buffer.tick(100_000)).toBe(false);
    }

    buffer.suspend("pause");
    // Arrived long ago during pause — should be skipped on resume at 60_000.
    buffer.ingest(message({ id: "stale", site: "twitch" }), 30_000);
    // Due just inside the 2s resume window (60_000 - 8_000 - 1_500 = 50_500).
    buffer.ingest(message({ id: "in-window", site: "twitch" }), 50_500);
    // Still inside the 8s delay window — should wait until 63_000.
    buffer.ingest(message({ id: "future", site: "twitch" }), 55_000);

    buffer.resume(60_000);
    expect(buffer.getState()).toEqual({ status: "active" });
    expect(buffer.getVisibleMessages().map((item) => item.id)).toEqual([
      "in-window",
    ]);

    expect(buffer.tick(62_999)).toBe(false);
    expect(buffer.tick(63_000)).toBe(true);
    expect(buffer.getVisibleMessages().map((item) => item.id)).toEqual([
      "in-window",
      "future",
    ]);
  });

  it("preserves original arrival time and updates text/segments on same-id hydration", () => {
    const buffer = createLiveDelayBuffer({ initialDelaySec: 5 });
    buffer.ingest(
      message({ id: "row-1", site: "twitch", text: "partial" }),
      10_000,
    );
    // Hydration arrives 4s later — must NOT shift due time from 15_000 to 19_000.
    buffer.ingest(
      message({
        id: "row-1",
        site: "twitch",
        text: "partial :KEKW:",
        segments: [
          { type: "text", text: "partial " },
          {
            type: "emoji",
            alt: "KEKW",
            src: "https://cdn.example.test/kekw.png",
          },
        ],
      }),
      14_000,
    );

    expect(buffer.tick(15_000)).toBe(true);
    expect(buffer.getVisibleMessages()[0]?.text).toBe("partial :KEKW:");

    // Post-release hydration updates visible line in place on next tick.
    buffer.ingest(
      message({ id: "row-1", site: "twitch", text: "final" }),
      16_000,
    );
    expect(buffer.tick(16_000)).toBe(true);
    expect(buffer.getVisibleMessages()[0]?.text).toBe("final");
  });

  it("prunes entries beyond maxEntries and maxAgeMs and bounds visible messages", () => {
    const buffer = createLiveDelayBuffer({
      initialDelaySec: 0,
      maxEntries: 3,
      maxAgeMs: 10_000,
      getMaxVisible: () => 2,
    });
    buffer.ingest(message({ id: "1", site: "twitch" }), 1_000);
    buffer.ingest(message({ id: "2", site: "twitch" }), 2_000);
    buffer.ingest(message({ id: "3", site: "twitch" }), 3_000);
    buffer.ingest(message({ id: "4", site: "twitch" }), 4_000);

    expect(buffer.tick(4_000)).toBe(true);
    expect(buffer.getVisibleMessages().map((item) => item.id)).toEqual([
      "3",
      "4",
    ]);

    buffer.ingest(message({ id: "5", site: "twitch" }), 20_000);
    expect(buffer.getPendingCount(20_000)).toBe(1);
  });

  it("calculates rounded and clamped delay candidates using original receivedAtMs", () => {
    expect(calculateSuggestedDelaySec(21_500, 10_000)).toBe(12);
    expect(calculateSuggestedDelaySec(21_499, 10_000)).toBe(11);
    expect(calculateSuggestedDelaySec(160_000, 10_000)).toBe(120);
    const clampedZeroFromNegative = calculateSuggestedDelaySec(22_000, 22_400);
    expect(Object.is(clampedZeroFromNegative, 0)).toBe(true);
    expect(calculateSuggestedDelaySec(22_000, 25_000)).toBe(0);
    expect(calculateSuggestedDelaySec(Number.NaN, 10_000)).toBeNull();
  });

  it("suggests delay from already-visible and hydrated rows while keeping current non-zero delay until applied", () => {
    const buffer = createLiveDelayBuffer({ initialDelaySec: 10 });
    buffer.ingest(message({ id: "r1", site: "twitch", text: "nice" }), 10_000);
    expect(buffer.tick(20_000)).toBe(true);

    // Same-id hydration 4s later must not shift original arrival time.
    buffer.ingest(
      message({ id: "r1", site: "twitch", text: "nice :PogChamp:" }),
      14_000,
    );
    expect(buffer.tick(20_000)).toBe(true);
    expect(buffer.getVisibleReceivedAtMs("r1")).toBe(10_000);

    expect(buffer.markScene(22_000)).toBe(true);
    expect(buffer.getCalibration()).toEqual({
      status: "picking",
      recordedAtMs: 22_000,
    });

    expect(buffer.selectReaction("r1")).toBe(12);
    // Current delay remains 10s until explicitly applied.
    expect(buffer.getDelaySec()).toBe(10);
    expect(buffer.getCalibration()).toEqual({
      status: "suggested",
      recordedAtMs: 22_000,
      messageId: "r1",
      messageReceivedAtMs: 10_000,
      suggestedDelaySec: 12,
    });

    // Unknown ID does not corrupt calibration or alter delay.
    expect(buffer.selectReaction("missing")).toBeNull();
    expect(buffer.getCalibration()).toMatchObject({
      status: "suggested",
      messageId: "r1",
      suggestedDelaySec: 12,
    });

    expect(buffer.applySuggestedDelay()).toBe(12);
    expect(buffer.getDelaySec()).toBe(12);
    expect(buffer.getCalibration()).toEqual({ status: "idle" });
  });

  it("handles late-arriving reactions without early release and supports switching candidates", () => {
    const buffer = createLiveDelayBuffer({ initialDelaySec: 10 });
    buffer.ingest(message({ id: "earlier", site: "twitch" }), 10_000);
    buffer.ingest(message({ id: "late", site: "twitch" }), 18_000);
    expect(buffer.tick(22_000)).toBe(true);
    expect(buffer.getVisibleMessages().map((m) => m.id)).toEqual(["earlier"]);

    expect(buffer.markScene(22_000)).toBe(true);
    // Still pending under +10s delay: must not release early or be selectable yet.
    expect(buffer.tick(27_999)).toBe(false);
    expect(buffer.selectReaction("late")).toBeNull();

    // Becomes visible at normal timing (18_000 + 10_000 = 28_000).
    expect(buffer.tick(28_000)).toBe(true);
    expect(buffer.getVisibleMessages().map((m) => m.id)).toEqual([
      "earlier",
      "late",
    ]);

    // Pick earlier first, then re-pick the late-arriving reaction directly.
    expect(buffer.selectReaction("earlier")).toBe(12);
    expect(buffer.selectReaction("late")).toBe(4);
    expect(buffer.getDelaySec()).toBe(10);

    // Another reaction received AFTER scene mark clamps safely to 0s.
    buffer.ingest(message({ id: "post-mark", site: "twitch" }), 25_000);
    expect(buffer.tick(35_000)).toBe(true);
    expect(buffer.selectReaction("post-mark")).toBe(0);

    // Applying +4s allows pending rows that are now due to release on next tick.
    expect(buffer.selectReaction("late")).toBe(4);
    buffer.ingest(message({ id: "waiting", site: "twitch" }), 30_000);
    expect(buffer.tick(35_000)).toBe(false);
    expect(buffer.applySuggestedDelay()).toBe(4);
    expect(buffer.tick(35_000)).toBe(true);
    expect(buffer.getVisibleMessages().map((m) => m.id)).toContain("waiting");
  });

  it("keeps current delay when calibration is cancelled before apply", () => {
    const buffer = createLiveDelayBuffer({ initialDelaySec: 10 });
    buffer.ingest(message({ id: "r1", site: "twitch" }), 10_000);
    buffer.tick(20_000);

    expect(buffer.markScene(22_000)).toBe(true);
    expect(buffer.selectReaction("r1")).toBe(12);
    expect(buffer.cancelCalibration()).toBe(true);
    expect(buffer.cancelCalibration()).toBe(false);
    expect(buffer.getCalibration()).toEqual({ status: "idle" });
    expect(buffer.applySuggestedDelay()).toBeNull();
    expect(buffer.getDelaySec()).toBe(10);
  });

  it("discards calibration and stale candidates on pause, seek, ad, and reset", () => {
    for (const reason of ["pause", "seek", "ad"] as const) {
      const buffer = createLiveDelayBuffer({ initialDelaySec: 10 });
      buffer.ingest(message({ id: "old", site: "twitch" }), 10_000);
      buffer.tick(20_000);
      expect(buffer.markScene(22_000)).toBe(true);
      expect(buffer.selectReaction("old")).toBe(12);

      buffer.suspend(reason);
      expect(buffer.getCalibration()).toEqual({ status: "idle" });
      expect(buffer.applySuggestedDelay()).toBeNull();
      expect(buffer.markScene(23_000)).toBe(false);
      expect(buffer.selectReaction("old")).toBeNull();
      expect(buffer.getDelaySec()).toBe(10);

      buffer.resume(25_000);
      expect(buffer.getCalibration()).toEqual({ status: "idle" });
      expect(buffer.applySuggestedDelay()).toBeNull();
      expect(buffer.markScene(26_000)).toBe(true);
      // Pre-suspend message is no longer visible after suspend/resume.
      expect(buffer.selectReaction("old")).toBeNull();
    }

    const buffer = createLiveDelayBuffer({ initialDelaySec: 10 });
    buffer.ingest(message({ id: "old", site: "twitch" }), 10_000);
    buffer.tick(20_000);
    buffer.markScene(22_000);
    buffer.selectReaction("old");
    buffer.reset();
    expect(buffer.getCalibration()).toEqual({ status: "idle" });
    expect(buffer.applySuggestedDelay()).toBeNull();
    buffer.markScene(24_000);
    expect(buffer.selectReaction("old")).toBeNull();
    expect(buffer.getDelaySec()).toBe(10);
  });

  it("invokes onRelease and onVisibleUpdate and merges local and remote entries in order without cross-site ID collisions", () => {
    const onRelease = vi.fn();
    const onVisibleUpdate = vi.fn();
    const buffer = createLiveDelayBuffer({
      initialDelaySec: 5,
      onRelease,
      onVisibleUpdate,
    });

    buffer.ingest(
      message({ id: "same-1", site: "twitch", text: "tw" }),
      10_000,
    );
    expect(buffer.tick(14_999)).toBe(false);
    expect(onRelease).not.toHaveBeenCalled();

    expect(buffer.tick(15_000)).toBe(true);
    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "same-1", site: "twitch", text: "tw" })],
      15_000,
    );

    buffer.ingest(
      message({ id: "same-1", site: "twitch", text: "tw hydrated" }),
      15_500,
    );
    expect(onVisibleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "same-1", text: "tw hydrated" }),
    );

    const localYt = message({
      id: "same-1",
      site: "youtube-live",
      text: "yt1",
    });
    const localYtLater = message({
      id: "yt-2",
      site: "youtube-live",
      text: "yt2",
    });
    const remoteTw = buffer.getVisibleMessages()[0]!;

    const merged = mergeLiveBridgeMessages(
      [
        { message: localYt, displayOrderMs: 12_000, orderSeq: 1 },
        { message: localYtLater, displayOrderMs: 16_000, orderSeq: 3 },
      ],
      [
        { message: remoteTw, displayOrderMs: 15_000, orderSeq: 2 },
        { message: remoteTw, displayOrderMs: 15_000, orderSeq: 4 },
      ],
    );
    expect(merged.map((entry) => `${entry.site}:${entry.id}`)).toEqual([
      "youtube-live:same-1",
      "twitch:same-1",
      "youtube-live:yt-2",
    ]);
  });
});
