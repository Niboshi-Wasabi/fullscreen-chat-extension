import { describe, expect, it, vi } from "vitest";
import { createRuntimeController } from "../../src/app/runtime-controller";

describe("runtime lifetime across asynchronous starts", () => {
  it("aborts a pending activation immediately on restart and stop", async () => {
    const signals: AbortSignal[] = [];
    let release!: (dispose: () => void) => void;
    const runtime = createRuntimeController((signal) => {
      signals.push(signal);
      return signals.length === 1
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve(() => {});
    });
    const first = runtime.restart();
    await Promise.resolve();
    const second = runtime.restart();
    expect(signals[0]!.aborted).toBe(true);
    release(() => {});
    await Promise.all([first, second]);
    expect(signals[1]!.aborted).toBe(false);
    runtime.stop();
    expect(signals[1]!.aborted).toBe(true);
  });
  it("disposes a stale start before starting the latest request", async () => {
    let release!: (dispose: () => void) => void;
    const stale = vi.fn();
    const current = vi.fn();
    const start = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<() => void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(current);
    const runtime = createRuntimeController(start);
    const first = runtime.restart();
    await Promise.resolve();
    const second = runtime.restart();
    const third = runtime.restart();
    release(stale);
    await Promise.all([first, second, third]);
    expect(stale).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
    runtime.stop();
    runtime.stop();
    expect(current).toHaveBeenCalledTimes(1);
  });
  it("disposes a start that finishes after stop", async () => {
    let release!: (dispose: () => void) => void;
    const dispose = vi.fn();
    const runtime = createRuntimeController(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = runtime.restart();
    await Promise.resolve();
    runtime.stop();
    release(dispose);
    await pending;
    expect(dispose).toHaveBeenCalledTimes(1);
    await runtime.restart();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
