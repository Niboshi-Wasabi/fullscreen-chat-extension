import { describe, expect, it } from "vitest";
import { applyNgFilter, shouldDropMessage } from "../../src/core/filter";
import { message, settings } from "../helpers";

describe("NG filtering", () => {
  it("matches words without case sensitivity and keeps the viewer's own messages", () => {
    const filter = { ...settings().filter, ngWords: ["spam"] };
    expect(shouldDropMessage(message({ text: "SPAM here" }), filter)).toBe(
      true,
    );
    expect(
      shouldDropMessage(message({ text: "spam", isSelf: true }), filter),
    ).toBe(false);
  });

  it("treats invalid regular expressions as literals without crashing", () => {
    const filter = { ...settings().filter, ngWords: ["["], ngRegex: true };
    expect(shouldDropMessage(message({ text: "a[b" }), filter)).toBe(true);
    expect(shouldDropMessage(message({ text: "safe" }), filter)).toBe(false);
  });

  it("protects moderator commands but still respects an explicit blocked id", () => {
    const filter = { ...settings().filter, blockedUsers: ["blocked-id"] };
    expect(
      shouldDropMessage(
        message({ role: "moderator", isCommand: true }),
        filter,
      ),
    ).toBe(false);
    expect(
      shouldDropMessage(
        message({ role: "moderator", authorId: "BLOCKED-ID" }),
        filter,
      ),
    ).toBe(true);
    expect(shouldDropMessage(message({ isCommand: true }), filter)).toBe(true);
  });

  it("keeps the newest allowed messages and counts filtering plus truncation", () => {
    const input = [
      message({ id: "old" }),
      message({ id: "command", isCommand: true }),
      message({ id: "new" }),
    ];
    const result = applyNgFilter(input, {
      ...settings().filter,
      maxVisible: 1,
    });
    expect(result.visible.map((line) => line.id)).toEqual(["new"]);
    expect(result.droppedCount).toBe(2);
    expect(input).toHaveLength(3);
  });

  it("ignores empty NG words and matches blockedUsers against name or login even when id exists", () => {
    const filter = {
      ...settings().filter,
      ngWords: ["", "spam"],
      ngRegex: true,
      blockedUsers: ["SomeLogin", "DisplayName"],
      hideBots: true,
    };
    expect(shouldDropMessage(message({ text: "hello" }), filter)).toBe(false);
    expect(
      shouldDropMessage(
        message({ authorId: "u1", authorLogin: "somelogin", authorName: "A" }),
        filter,
      ),
    ).toBe(true);
    expect(
      shouldDropMessage(
        message({ authorId: "u2", authorName: "displayname" }),
        filter,
      ),
    ).toBe(true);
    expect(shouldDropMessage(message({ role: "bot" }), filter)).toBe(true);
    expect(shouldDropMessage(message({ authorName: "Nightbot" }), filter)).toBe(
      true,
    );
  });
});
