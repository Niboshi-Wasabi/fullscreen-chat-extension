import type { NormalizedMessage } from "../src/core/message";
import { DEFAULT_SETTINGS } from "../src/shared/settings";

export const settings = () => structuredClone(DEFAULT_SETTINGS);

export function message(
  overrides: Partial<NormalizedMessage> = {},
): NormalizedMessage {
  return {
    id: "synthetic-message",
    site: "youtube-live",
    authorName: "fixture-user",
    text: "hello",
    timestampMs: 0,
    role: "viewer",
    badges: [],
    isCommand: false,
    ...overrides,
  };
}
