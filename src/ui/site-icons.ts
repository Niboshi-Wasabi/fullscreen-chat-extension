/**
 * Brand-recognizable site marks for settings rows (monochrome brand tint).
 * Not official trademark assets — simplified silhouettes for identification only.
 * 設定行向けのサイト識別マーク（ブランド色の単色シルエット）。公式商標アセットではない。
 */

export type SiteIconKind = "youtube-live" | "youtube-comments" | "twitch";

const ICONS: Record<SiteIconKind, string> = {
  "youtube-live": `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M23.5 6.2a3.05 3.05 0 0 0-2.14-2.16C19.4 3.5 12 3.5 12 3.5s-7.4 0-9.36.54A3.05 3.05 0 0 0 .5 6.2 31.9 31.9 0 0 0 0 12a31.9 31.9 0 0 0 .5 5.8 3.05 3.05 0 0 0 2.14 2.16C4.6 20.5 12 20.5 12 20.5s7.4 0 9.36-.54a3.05 3.05 0 0 0 2.14-2.16A31.9 31.9 0 0 0 24 12a31.9 31.9 0 0 0-.5-5.8zM9.75 15.52V8.48L16.5 12l-6.75 3.52z"/></svg>`,
  "youtube-comments": `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4.2 3h15.6A2.2 2.2 0 0 1 22 5.2v9.1a2.2 2.2 0 0 1-2.2 2.2H9.1L4 21V5.2A2.2 2.2 0 0 1 4.2 3z"/><path class="fce-site-icon-accent" d="M10.1 8.4v6.2L15.8 11.5 10.1 8.4z"/></svg>`,
  twitch: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3.8 1.5 1.5 5.1v15.2h4.9V24l3.7-2.7h4.4L22.5 14V1.5H3.8zm16 11.4-3.1 3.1h-4.6l-3.7 2.8v-2.8H6.2V3.8h13.6v9.1zM15.8 7H14v5.4h1.8V7zm-4.9 0H9.1v5.4h1.8V7z"/></svg>`,
};

/** Inline SVG markup for a site row icon / サイト行アイコンのインライン SVG */
export function siteIconSvg(kind: SiteIconKind): string {
  return ICONS[kind];
}
