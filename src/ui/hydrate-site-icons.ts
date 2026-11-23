import { siteIconSvg, type SiteIconKind } from "./site-icons";

const SITE_ICON_KINDS = new Set<SiteIconKind>(["youtube-live", "twitch"]);

function isSiteIconKind(value: string): value is SiteIconKind {
  return SITE_ICON_KINDS.has(value as SiteIconKind);
}

/** Fill `[data-site-icon]` placeholders with brand SVGs / プレースホルダにサイトの SVG アイコンを追加する */
export function hydrateSiteIcons(root: ParentNode = document): void {
  const nodes = root.querySelectorAll<HTMLElement>("[data-site-icon]");
  for (const node of nodes) {
    const kind = node.dataset.siteIcon ?? "";
    if (!isSiteIconKind(kind)) {
      continue;
    }
    node.classList.add("fce-site-icon", `fce-site-icon--${kind}`);
    node.setAttribute("aria-hidden", "true");
    node.innerHTML = siteIconSvg(kind);
  }
}
