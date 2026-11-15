import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mapTwitchRole,
  readTwitchBadgeIcons,
  readTwitchBadges,
} from "../../src/shared/twitch-role";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Twitch badge icons (ISS-024)", () => {
  it("reads alt and src from badge images", () => {
    const img = {
      getAttribute: (name: string) =>
        name === "alt" ? "サブスクライバーバッジ" : null,
      currentSrc: "https://static-cdn.jtvnw.net/badges/subscriber.png",
      src: "https://static-cdn.jtvnw.net/badges/subscriber.png",
    };
    const element = {
      querySelectorAll: () => [img],
      className: "",
    } as unknown as Element;

    expect(readTwitchBadgeIcons(element)).toEqual([
      {
        alt: "サブスクライバーバッジ",
        src: "https://static-cdn.jtvnw.net/badges/subscriber.png",
      },
    ]);
    expect(readTwitchBadges(element)).toEqual(["サブスクライバーバッジ"]);
    expect(mapTwitchRole(["subscriber"], element)).toBe("member");
  });

  it("keeps alt-only badges when the image src is empty", () => {
    const img = {
      getAttribute: (name: string) => (name === "alt" ? "VIP" : null),
      currentSrc: "",
      src: "",
    };
    const element = {
      querySelectorAll: () => [img],
      className: "",
    } as unknown as Element;
    expect(readTwitchBadgeIcons(element)).toEqual([{ alt: "VIP" }]);
  });
});
