# Settings UI Design / 設定画面デザイン

Apply when designing or implementing **popup** and **options** (and related static pages such as privacy).  
ポップアップ、設定画面、プライバシーポリシーなどの関連ページを設計・実装するときに適用する。

Canonical type and icons (required):

- Font: [Google Sans Flex](https://fonts.google.com/specimen/Google+Sans+Flex?preview.script=Latn)
- Icons: [Google Fonts Icons / Material Symbols](https://fonts.google.com/icons)

Product settings inventory remains the schema source of truth: `docs/settings-inventory.md` / `src/shared/settings.ts`.  
Competitive product scores live in `docs/competitive-evaluation.md` and `docs/competitive-evaluation-hands-on.md`. This document owns **settings chrome UX**, not feature parity.

Evidence for the comparison below: PreMiD public docs + extension chrome patterns; local unpacked packages under `.tmp-extensions/` (Flusher, Stream Danmaku Overlay, Yochatto, YLCFS, Comment Viewer, Live Chat Popout).

---

## Competitive analysis → decisions / 競合比較 → 採用判断

### Snapshot / 一覧

| Product | Settings surface | Strength | Weakness for us |
|---------|------------------|----------|-----------------|
| **PreMiD** | Toolbar popup; settings as **icon + title + control** rows; conditional `if` rows; FA icons; dense dark chrome | Instant scanability; toggle-forward; hide irrelevant rows | Domain ≠ chat; not a multi-category options shell; FA ≠ our icon rule |
| **Yochatto** | Large panel: **left tab rail** (icon+label), search, section jump, undo/redo, theme flip, schema-driven rows | Best-in-class **navigation for many settings**; dark/light tokens | Purple Twitch-accent brand; CDN font soup; depth can overwhelm without search |
| **LiveChat Flusher** | **In-player gear** (YT-native menu) + `options_ui` **`open_in_tab: true`** long form (`section`/`dl`, radios, big notes, export/import) | Contextual day-to-day + deep page; honest docs under hard modes | Single long scroll; low visual hierarchy; table/radio heavy |
| **Stream Danmaku Overlay** | **Popup-only** (~260px): master toggle, range+**value badge**, **segmented** mode, conditional stack section | Lean essentials; clear enums; live numeric feedback | Too few settings for our inventory; rose→purple gradient (avoid) |
| **YLCFS** | Compact popup + separate settings page; switch-forward | Clear enable path; modest chrome | Shallow categories; YT-only product |
| **Comment Viewer** | Marketing mini-popup (one flip toggle + feature bullets + rate CTA) | Fast “on” | Not a settings product — **anti-pattern** for our key count |
| **Live Chat Popout** | Almost no UI (command-driven) | Zero friction for one action | Cannot host NG / modes / sites |

### What we take / 採用

1. **PreMiD row grammar** — every setting is `[icon] title (+ one-line hint) … control`. Boolean → switch. Conditional show/hide when a parent mode disables a child (e.g. danmaku knobs when site cannot danmaku).
2. **Yochatto options shell** — categorized **left sidebar** (icon + label) + main panel; light/dark tokens; when a category grows long, add an in-panel **section jump** or search (search is required once options feel “hard to find”, not on day one if categories stay ≤ ~7 and short).
3. **Flusher two-tier access** — toolbar **popup = essentials**; **options in a tab** (`open_in_tab: true`) = full schema. Keep complex mode explanations as **short expandable hints**, not Flusher-length note walls by default.
4. **SDO popup craft** — master enable first; **segmented control** for small enums (display mode); **range + live value badge** (`32px`, `60%`); disable/hide dependent blocks instead of leaving dead controls clickable.
5. **YLCFS / inventory** — popup order: enable → mode → sites → language → open options (no duplicates in options).

### What we adapt / 改変して取り込む

- Flusher **export / import / reset** → Post-MVP Tools section (secondary actions).
- Flusher **in-player gear** → related surface (panel gear / player button per inventory); **not** a substitute for options; keep chrome consistent with tokens when that surface is built.
- Yochatto **undo/redo / live preview** → Post-MVP; do not block MVP shell.
- PreMiD **Font Awesome** → **Material Symbols** only (project rule).
- Yochatto / PreMiD **Inter or CDN preview fonts** for chrome → **bundled Google Sans Flex** only.

### What we avoid / 避ける

- Comment Viewer–style **promo popup** as the only settings UI.
- Flusher-style **one endless undocumented scroll** as the primary options IA.
- SDO / Yochatto **purple–violet gradient / Twitch-purple default accent** as our brand (one own accent; no rose→purple header).
- Shipping **dozens of knobs in the toolbar popup** (Yochatto depth belongs in options / docked panel, not a 260px action popup).
- Cloning PreMiD / Yochatto / Flusher **assets, CSS, or trademarks**.

### Synthesis (one line) / 合成方針

**PreMiD visibility × Yochatto categorization × Flusher two-tier depth × SDO popup restraint** — with Google Sans Flex + Material Symbols and our own accent tokens.

---

## Goals / 目標

- A user finds any setting in under a few seconds without reading a wall of form labels.
- Primary actions (enable, mode, site toggles) are obvious in the popup; deep config lives on the options page.
- Visual hierarchy beats decoration. One accent, clear surfaces, generous hit targets.

---

## Layout / レイアウト

### Popup (toolbar) — SDO lean + YLCFS order

- Compact card, not a mini dashboard and not a Yochatto clone.
- Order: product title → master enable → display mode → site enables → **UI language** → link to options & GitHub repository.
- Width ≈ **480px** (`min` 440 / `max` 520). **No scroll** — only that essentials set; never grow past one viewport.
- Prefer **side-by-side** rows (`[icon] title … control`) for enums (mode segmented, language select). Stack only for wide textareas.
- **No duplicate controls** with options. Popup owns: `enabled`, `displayMode`, site toggles, `uiLocale`. Options owns deep display / compose / filter / archive / legal / shortcuts.
- Language is popup-only so a wrong-locale user can recover without hunting a deep page. Native labels; `Auto` stays i18n'd.
- One column. No nested marketing cards. No store-rating CTAs. No stats strips.

### Options (full page) — Yochatto shell + PreMiD rows

- Persistent **left sidebar** (categories) + **main panel** (active category).
- Sidebar items: Material Symbol + short label. Active item: accent + stronger weight (`aria-current="page"`).
- Main panel: page title, short subtitle (one sentence), then setting groups of PreMiD-style rows.
- Suggested categories (adjust only with inventory/PRD):

```text
General      — compose, shortcuts help
Display      — panel, danmaku, popout policy (mode is popup-only)
Filter       — NG, commands, caps
Archive      — VOD / chat-replay sync
Legal        — privacy link, danmaku disclaimer
```
（`enabled` / 表示モード / サイト / 言語はポップアップ専有）

- Prefer `options_ui.open_in_tab: true` (Flusher pattern) so the sidebar has room; document if changed.
- Narrow width: collapse sidebar to a top tab strip or select; no horizontal scroll.
- Growth path: if a single category exceeds ~10 rows, add subsection headings; if finding settings becomes hard, add **search** (Yochatto) before adding more top-level tabs.

---

## Setting rows / 設定行

Each control is a **row**, not a bare `<label>` stack (PreMiD grammar):

```text
[icon]  Title                         [control]
```

- **Let layout explain.** Prefer section headings, icons, segmented labels, value badges, and placeholders over secondary hint lines under every row.
- **No default row descriptions.** Add a one-line hint only when the control is unsafe or irreversible without it (rare). Do not repeat the section title or nav label in body copy.
- **Boolean** → toggle switch (not a raw checkbox).
- **Small enum** (2–4 values, e.g. display mode) → **segmented control** (SDO) **inline on the same row** as the title; do not place the control on a full-width row under the label.
- **Number / continuum** → range or number input with **live value badge** and unit (`sec`, `px`, `%`).
- **Long text** (NG list) → full-width textarea; use **placeholder** for format (“one per line”), not a hint paragraph.
- **Conditional rows** (PreMiD `if` / SDO disabled section): hide or clearly disable dependents when parent mode/site forbids them.
- Group related rows under a small section heading; skip a section heading when the page/nav title already names that single group.
- Destructive or rare actions (reset position, clear NG, import/export) stay secondary (text/outline), never primary.

---

## Typography / タイポグラフィ

**Face:** Google Sans Flex only for extension chrome (popup, options, privacy page UI chrome).  
Do not use Inter / Roboto / Arial / system-ui as the primary UI face for these surfaces.

| Role | Weight | Size (guide) | Use |
|------|--------|--------------|-----|
| App / page title | 600–700 | 22–28px | Options header, popup title |
| Sidebar label | 500–600 | 13–14px | Nav |
| Section heading | 600 | 15–16px | Group titles |
| Row title | 500–600 | 14px | Setting name |
| Description / hint | 400 | 12–13px | Secondary line under title |
| Control value / badge | 500–700 | 11–14px | Selects, inputs, range badges |

- Line-height ≈ 1.35–1.5 for body; tighter for dense nav.
- Japanese + Latin: if a weight looks uneven, prefer Medium (500) for JP body and Semibold for headings.
- Load strategy (privacy-first; contrast with Yochatto’s Google Fonts CDN for previews):
  1. **Prefer self-hosted / bundled `woff2`** under the extension package (no extra host permission).
  2. CDN (`fonts.googleapis.com` / `fonts.gstatic.com`) only if documented in settings-inventory and privacy policy, with matching host permissions.
- Keep CSS variables for family:

```css
--fce-font-ui: "Google Sans Flex", "Segoe UI", Meiryo, "Hiragino Sans", sans-serif;
```

Danmaku on the video surface may keep its own stack (already product-tuned); do not silently force Sans Flex onto danmaku unless product asks.

---

## Icons / アイコン

**Source:** [Material Symbols](https://fonts.google.com/icons) (Outlined as default; Rounded only if the whole UI commits to it).

- One icon library only — do not mix Font Awesome (PreMiD/Comment Viewer), emoji, or ad-hoc SVGs for settings chrome.
- Sidebar and setting rows: 20–24px optical size; stroke consistent (Outlined).
- Prefer ligature or variable font Material Symbols; if self-hosting, ship the subset needed.
- Suggested mapping (ligature names — adjust if renamed upstream):

| Area | Symbol |
|------|--------|
| General | `tune` / `settings` |
| Display | `desktop_windows` / `view_sidebar` |
| Danmaku | `subtitles` / `chat_bubble` |
| Popout | `open_in_new` |
| Filter | `filter_alt` |
| Archive / sync | `sync` / `movie` |
| YouTube Live | Brand silhouette (red play-in-rounded-rect) via `fce-site-icon--youtube-live` |
| Twitch | Brand silhouette (glitch) via `fce-site-icon--twitch` |
| Language | `translate` |
| Privacy / legal | `policy` / `gavel` |
| Save | `save` |
| Search (when added) | `search` |
| Back / close | `arrow_back` / `close` |

- Icons are supporting — never the only affordance. Always pair with a text label in the sidebar and on rows.
- **Site rows only:** use simplified brand-tinted silhouettes (`src/ui/site-icons.ts`) so services are scannable. Do not ship official trademark SVG packs or multicolored marketing logos. All other chrome stays Material Symbols.
- In-player master toggle (`src/views/player-chrome`): product mark + ON/OFF badge in the right control cluster beside the seek/progress strip (YT / Twitch). Not a substitute for the popup enable switch.

---

## Color & surfaces / 色と面

Aim for **high visibility** (PreMiD/Yochatto clarity), not purple-glow AI defaults and not Twitch `#9147ff` as our identity.

- Define tokens as CSS variables on `:root` / `[data-theme]`.
- Light and dark both required; default follow `prefers-color-scheme` unless user overrides (Yochatto-style theme control is optional later).
- One accent only (e.g. vivid blue or teal readable on both themes). Use accent for: active nav, toggles on, primary button, focus rings, segmented selected state.
- Surfaces:
  - Sidebar slightly different from main so structure reads instantly.
  - Setting groups as quiet sections — prefer spacing and headings over heavy cards/shadows.
  - Avoid multi-layer shadows, neon glow, rose→purple header gradients, and `rounded-full` pill spam.
- Contrast: body text and icons must meet readable contrast; disabled controls look disabled, not merely low-opacity text.

Suggested token names (values chosen at implementation time):

```text
--fce-bg, --fce-bg-elevated, --fce-bg-sidebar
--fce-fg, --fce-fg-muted
--fce-border
--fce-accent, --fce-accent-fg
--fce-danger
--fce-radius-sm, --fce-radius-md
--fce-space-1 … --fce-space-6
--fce-font-ui
```

---

## Motion / モーション

- Subtle only: nav active indicator, toggle knob, section enter opacity/translate ≤ 150–200ms.
- Respect `prefers-reduced-motion: reduce` (disable non-essential motion).
- No continuous animation in settings.

---

## Content & i18n / 文言

- Use existing `shared/i18n` keys; add keys when new chrome strings appear.
- Row title = short noun/verb phrase that stands alone; do not ship companion “hint” strings by default.
- JA/EN both required for user-visible settings chrome (per product i18n).
- Legal / danmaku disclaimer is content, not a setting hint — keep it only on Legal, with a link to `privacy.html`.

---

## Accessibility / アクセシビリティ

- Full keyboard reachability; visible focus ring using accent.
- Toggles: real `<input type="checkbox">` (visually styled) or `role="switch"` with `aria-checked`.
- Sidebar: `nav` with current page via `aria-current="page"`.
- Segmented controls: radiogroup semantics.
- Do not rely on color alone for on/off — toggle position/shape must differ.

---

## Implementation notes / 実装メモ

- Match existing project structure under `src/entrypoints/popup` and `options`; extract shared CSS tokens if both surfaces need them.
- Prefer semantic HTML + CSS variables over a large UI framework unless already adopted.
- Keep settings schema in `shared/settings.ts` / inventory as source of truth — UI groups map to schema, not the other way around.
- When this rule conflicts with a one-off marketing page rule, **settings chrome follows this file**.
- Re-check this comparison if a new direct rival ships a settings shell we adopt features from; update the snapshot table in the same PR as UI changes.

---

## Out of scope here / ここでは扱わない

- In-page overlay panel / danmaku chrome on YouTube/Twitch (separate product surfaces; may later share tokens).
- Extension toolbar icon asset design (store icon set may be a later asset pass).
- Feature decisions already owned by PRD / competitive-evaluation (this file does not reopen MVP scope).
- Copying PreMiD, Yochatto, Flusher, or other rivals’ assets, CSS, or trademarks.
