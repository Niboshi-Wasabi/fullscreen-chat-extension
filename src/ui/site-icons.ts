/**
 * Brand-recognizable site marks for settings rows (monochrome brand tint).
 * Not official trademark assets — simplified silhouettes for identification only.
 * 設定行に表示するサイト識別マーク（ブランド色の単色シルエット）。公式商標アセットではない。
 */

export type SiteIconKind = "youtube-live" | "twitch";

interface SiteLogoLayer {
  readonly fill: string;
  readonly d: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const SITE_DISPLAY_NAMES: Record<SiteIconKind, string> = {
  "youtube-live": "YouTube",
  twitch: "Twitch",
};

const SITE_LOGO_LAYERS: Record<SiteIconKind, readonly SiteLogoLayer[]> = {
  "youtube-live": [
    {
      fill: "#ff0033",
      d: "M23.5 6.2a3.05 3.05 0 0 0-2.14-2.16C19.4 3.5 12 3.5 12 3.5s-7.4 0-9.36.54A3.05 3.05 0 0 0 .5 6.2 31.9 31.9 0 0 0 0 12a31.9 31.9 0 0 0 .5 5.8 3.05 3.05 0 0 0 2.14 2.16C4.6 20.5 12 20.5 12 20.5s7.4 0 9.36-.54a3.05 3.05 0 0 0 2.14-2.16A31.9 31.9 0 0 0 24 12a31.9 31.9 0 0 0-.5-5.8z",
    },
    {
      fill: "#ffffff",
      d: "M9.75 8.48 16.5 12l-6.75 3.52z",
    },
  ],
  twitch: [
    {
      fill: "#9146ff",
      d: "M3.8 1.5 1.5 5.1v15.2h4.9V24l3.7-2.7h4.4L22.5 14V1.5H3.8z",
    },
    {
      fill: "#ffffff",
      d: "M19.8 12.9l-3.1 3.1h-4.6l-3.7 2.8v-2.8H6.2V3.8h13.6v9.1z",
    },
    {
      fill: "#9146ff",
      d: "M15.8 7H14v5.4h1.8V7zm-4.9 0H9.1v5.4h1.8V7z",
    },
  ],
};

const ICONS: Record<SiteIconKind, string> = {
  "youtube-live": `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M23.5 6.2a3.05 3.05 0 0 0-2.14-2.16C19.4 3.5 12 3.5 12 3.5s-7.4 0-9.36.54A3.05 3.05 0 0 0 .5 6.2 31.9 31.9 0 0 0 0 12a31.9 31.9 0 0 0 .5 5.8 3.05 3.05 0 0 0 2.14 2.16C4.6 20.5 12 20.5 12 20.5s7.4 0 9.36-.54a3.05 3.05 0 0 0 2.14-2.16A31.9 31.9 0 0 0 24 12a31.9 31.9 0 0 0-.5-5.8zM9.75 15.52V8.48L16.5 12l-6.75 3.52z"/></svg>`,
  twitch: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3.8 1.5 1.5 5.1v15.2h4.9V24l3.7-2.7h4.4L22.5 14V1.5H3.8zm16 11.4-3.1 3.1h-4.6l-3.7 2.8v-2.8H6.2V3.8h13.6v9.1zM15.8 7H14v5.4h1.8V7zm-4.9 0H9.1v5.4h1.8V7z"/></svg>`,
};

/** Inline SVG markup for a site row icon / サイト行アイコンのインライン SVG */
export function siteIconSvg(kind: SiteIconKind): string {
  return ICONS[kind];
}

/** Accessible site display label / アクセシビリティ用のサイト表示名 */
export function siteDisplayName(kind: SiteIconKind): string {
  return SITE_DISPLAY_NAMES[kind];
}

/** Two-color DOM SVG logo mark built without innerHTML / innerHTML を使わず生成する 2 色ブランドロゴ SVG */
export function createSiteLogoSvg(
  kind: SiteIconKind,
  doc: Document = document,
): SVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg") as unknown as SVGElement;
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "fce-site-logo-svg");
  for (const layer of SITE_LOGO_LAYERS[kind]) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("fill", layer.fill);
    path.setAttribute("d", layer.d);
    svg.appendChild(path);
  }
  return svg;
}

/** Accessible platform logo badge element for mixed chat / 混合チャット用のプラットフォームロゴバッジ要素 */
export function createSiteBadge(
  kind: SiteIconKind,
  className: string,
  doc: Document = document,
): HTMLSpanElement {
  const badge = doc.createElement("span");
  badge.className = className;
  badge.dataset.site = kind;
  const label = siteDisplayName(kind);
  badge.setAttribute("role", "img");
  badge.setAttribute("aria-label", label);
  badge.title = label;
  badge.appendChild(createSiteLogoSvg(kind, doc));
  return badge;
}
