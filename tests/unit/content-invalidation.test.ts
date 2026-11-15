import { afterEach, expect, it, vi } from "vitest";

const resources = vi.hoisted(() => ({
  observe: vi.fn(),
  ng: vi.fn(),
  focus: vi.fn(),
}));
vi.mock("../../src/adapters/youtube-live", () => ({
  isYouTubeLiveChatContext: () => true,
  observeYouTubeLiveChatIframe: resources.observe,
}));
vi.mock("../../src/app/native-chat-ng", () => ({
  startNativeChatNgHider: resources.ng,
}));
vi.mock("../../src/shared/native-compose-focus", () => ({
  bindNativeComposeFocus: resources.focus,
}));
afterEach(() => vi.unstubAllGlobals());

it("permanently stops an invalidated content instance before reinjection", async () => {
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  vi.stubGlobal("defineContentScript", (definition: unknown) => definition);
  const stops = [vi.fn(), vi.fn(), vi.fn()];
  resources.observe.mockReturnValue(stops[0]);
  resources.ng.mockReturnValue(stops[1]);
  resources.focus.mockReturnValue(stops[2]);
  const definition = (await import("../../src/entrypoints/content"))
    .default as unknown as {
    main: (context: { onInvalidated: (dispose: () => void) => void }) => void;
  };
  const callbacks: (() => void)[] = [];
  const context = {
    onInvalidated: (dispose: () => void) => callbacks.push(dispose),
  };
  definition.main(context);
  expect(callbacks).toHaveLength(1);
  target.dispatchEvent(
    Object.assign(new Event("pagehide"), { persisted: true }),
  );
  callbacks[0]!();
  target.dispatchEvent(
    Object.assign(new Event("pageshow"), { persisted: true }),
  );
  expect(resources.observe).toHaveBeenCalledTimes(1);
  for (const stop of stops) expect(stop).toHaveBeenCalledTimes(1);
  definition.main(context);
  expect(resources.observe).toHaveBeenCalledTimes(2);
  callbacks[1]!();
  for (const stop of stops) expect(stop).toHaveBeenCalledTimes(2);
});
