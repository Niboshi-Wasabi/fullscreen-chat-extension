import { segmentsToPlainText, type MessageSegment } from "../core/message";

/**
 * Walk a chat body node into text + emoji image segments.
 * チャット本文ノードをテキスト＋絵文字画像の断片へ分解する。
 */
export function extractMessageContent(root: Element | null): {
  text: string;
  segments: MessageSegment[];
} {
  const segments: MessageSegment[] = [];
  if (!root) {
    return { text: "", segments };
  }
  walk(root, segments);
  const merged = mergeAdjacentText(segments);
  const text = segmentsToPlainText(merged);
  return { text, segments: merged };
}

function walk(node: Node, out: MessageSegment[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent ?? "";
    if (value) {
      out.push({ type: "text", text: value });
    }
    return;
  }
  if (!(node instanceof Element)) {
    return;
  }

  if (node instanceof HTMLImageElement) {
    const src = node.currentSrc || node.src || "";
    const alt =
      node.getAttribute("shared-tooltip-text") ||
      node.getAttribute("alt") ||
      node.getAttribute("aria-label") ||
      "emoji";
    if (src) {
      out.push({ type: "emoji", src, alt });
    } else if (alt) {
      out.push({ type: "text", text: `:${alt}:` });
    }
    return;
  }

  // YouTube custom emoji / sticker wrappers often nest the <img>.
  // YT カスタム絵文字はラッパー内に img があることが多い。
  if (
    node.matches(
      "img, yt-live-chat-emoji, .emoji, .chat-image, .chat-line__message--emote",
    ) ||
    node.tagName.toLowerCase().includes("emoji")
  ) {
    const img =
      node instanceof HTMLImageElement ? node : node.querySelector("img");
    if (img) {
      walk(img, out);
      return;
    }
  }

  node.childNodes.forEach((child) => walk(child, out));
}

function mergeAdjacentText(segments: MessageSegment[]): MessageSegment[] {
  const merged: MessageSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (segment.type === "text" && last?.type === "text") {
      last.text += segment.text;
      continue;
    }
    merged.push(
      segment.type === "text"
        ? { type: "text", text: segment.text }
        : { ...segment },
    );
  }
  return merged.filter(
    (segment) => segment.type === "emoji" || segment.text.length > 0,
  );
}
