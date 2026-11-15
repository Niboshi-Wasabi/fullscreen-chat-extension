import { describe, expect, it, vi } from "vitest";
import { bindPageLifecycle } from "../../src/app/page-lifecycle";

function transition(target: EventTarget, type: string, persisted: boolean) {
  target.dispatchEvent(Object.assign(new Event(type), { persisted }));
}

describe("content resources across page history", () => {
  it("stops once per departure and resumes once per cached restore", () => {
    const target = new EventTarget();
    const stop = vi.fn();
    const start = vi.fn(() => stop);
    const unbind = bindPageLifecycle(start, target as Window);
    transition(target, "pageshow", false);
    expect(start).toHaveBeenCalledTimes(1);
    for (let round = 0; round < 3; round++) {
      transition(target, "pagehide", true);
      transition(target, "pagehide", true);
      expect(stop).toHaveBeenCalledTimes(round + 1);
      transition(target, "pageshow", true);
      transition(target, "pageshow", true);
      expect(start).toHaveBeenCalledTimes(round + 2);
    }
    unbind();
    unbind();
    transition(target, "pageshow", true);
    expect(start).toHaveBeenCalledTimes(4);
    expect(stop).toHaveBeenCalledTimes(4);
  });

  it("disposes permanently while suspended without starting again", () => {
    const target = new EventTarget();
    const stop = vi.fn();
    const start = vi.fn(() => stop);
    const unbind = bindPageLifecycle(start, target as Window);
    transition(target, "pagehide", false);
    unbind();
    transition(target, "pageshow", true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
