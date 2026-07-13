# Public Catalog Visual Redesign — Design

**Date:** 2026-07-13
**Status:** Approved (pending spec review)
**Reference inspiration:** Treinta's storefront (warm commercial aesthetic, mobile-first, business-owned identity) — visual language only. Mockups iterated with the user live in `.superpowers/brainstorm/21239-1783954262/content/` (v2 files are the approved ones).

## Goal

Deep visual reskin of the public storefront (`app/catalogo/[slug]/**` + `components/catalogo-public/**`). The UX recon showed our flows already exceed the reference (sticky cart, bottom sheets, 2-step quote checkout, coupons, abandoned carts, PWA, JSON-LD); the gap is 100% visual: stock shadcn chrome, ~15 inline brand `style={{}}` per component, no type ramp, no card shape language.

**Same components, same flows, new skin.** If a flow or an existing component test needs changing, we broke scope — with one deliberate exception (desktop filter sidebar, below).

**Out of scope:** admin catalog management UI, checkout logic, new `catalogo_config` fields, dark mode for the storefront (fixed light; dashboard keeps its own theming), full component rewrite (`catalogo-public-v2` fork was explicitly rejected).

## Design system ("warm commercial v2" — approved)

### Palette (brand-independent base)

| Token | Value | Use |
|---|---|---|
| `--cat-bg` | `#F7F1E8` | Page background (warm cream) |
| `--cat-surface` | `#FFFDF9` | Cards, bars, drawers (ivory) |
| `--cat-border` | `#E8DECF` | Borders, inactive chips |
| `--cat-chip` | `#F1EBE2` | Chip/stepper fills |
| `--cat-ink` | `#221C14` | Primary text (warm ink) |
| `--cat-muted` | `#95877A` | Secondary text |
| shadow | `rgba(120,90,40,.13)` base | Amber-tinted shadows, never gray |

Business brand color keeps flowing through the existing `--brand*` vars from `lib/catalogo/brand.ts` (`getBrandTheme()` WCAG-contrast derivation stays untouched). Semantic accents: WhatsApp CTAs always green (`#22c55e`), warm pastel badges (amber `#FFEDD5`/`#9A3412` for featured, green `#DCFCE7`/`#166534` for service/stock).

### Typography

- **Plus Jakarta Sans** 700/800 — headings, prices, buttons, chips. Prices always 800 with `letter-spacing: -0.02em` (most-looked-at element in a catalog).
- **Inter** 400/500/600 — product names, descriptions, UI text.
- Loaded via `next/font` **only in the catalog layout** — the dashboard must not pay those bytes.

### Shape & elevation

- Product cards: radius 24, photo "floating" inside (10px frame, photo radius 16), amber shadow, no gray border.
- Buttons/chips/steppers: pill (999px). Quick-add: 42px circle with brand-tinted shadow.
- Logo: 22px-radius squircle with ivory border, floating/overlapping the hero banner.
- Iconography: clean SVG (lucide) — **no emojis anywhere** (explicit user requirement: "professional ecommerce level").

## Per-surface decisions (approved section by section)

### Hero (both variants)

- With banner: full-bleed image, warm dark gradient overlay, floating squircle logo (-34px overlap), pill CTAs bottom-right.
- Without banner (majority of tenants): radial brand-color mesh over ivory — each store looks distinct with zero configuration.
- Business name in display 800 — the store is the protagonist, not the platform.
- **WhatsApp CTA always green and first**; Share becomes secondary outline pill.
- Trust badges (existing config data) render as warm bordered chips with SVG icons.

### Categories & filters (professional-ecommerce v2 — replaced the first proposal after user pushback)

- Categories: **photo circles** (60px, existing category image; brand-tinted monogram fallback), horizontal scroll, active ring in brand color. "Todo" circle first.
- Search: large pill input, sober icon, "Buscar productos" placeholder.
- Mobile: labeled **"Filtrar"** (with active-count badge) and **"Ordenar"** buttons (ML/Shopify pattern) opening the existing bottom sheet.
- **Desktop: persistent left filter sidebar** (categories with counts, price range, stock checkbox) — the one structural change in the redesign, explicitly accepted. MiniCart stays on the right; filters no longer render as a collapsible top panel on desktop.
- Active filters as removable outline chips under the bar (small UX addition, low risk).

### Cart & purchase surfaces

- Sticky mobile bar: **ink-dark** (`--cat-ink`) rounded bar floating over cream, brand-colored count badge, label **"Ver pedido"** (it's a quote request, not a paid checkout), price in display 800.
- Drawer: "Paso 1 de 2" indicator with progress bar (new — step position is invisible today), 52px thumbnails radius 12, pill steppers on chip fill, anchor-price strikethrough, expectation microcopy under the CTA ("el negocio te confirma precio y disponibilidad").
- Step 2 (details + coupon + consent), desktop MiniCart, item detail dialog and item page: same structure as today, reskinned by the system rules.

## Architecture

1. **Token layer**: `--cat-*` CSS vars defined at the catalog root (layout-level wrapper), alongside the existing `brandCssVars()` output. Mapped in `tailwind.config` (`bg-cat-surface`, `text-cat-ink`, `border-cat-border`, `shadow-cat`, …). Classes exist globally but only resolve inside the catalog root.
2. **Light-only**: tokens are fixed values at the catalog root; `.dark` is ignored inside the storefront. No dual-mode upkeep.
3. **Inline-style debt**: the ~15 per-component inline brand `style={{}}` usages get replaced by mapped Tailwind utilities consuming the vars (`bg-brand`, `text-brand`, `shadow-brand`, same convention as the `cat-*` tokens — no arbitrary-value classes). No visual logic in JS beyond what `getBrandTheme()` already computes.
4. **Fonts** via `next/font/google` in the catalog layout only, exposed as `--font-display` / `--font-body`.

## Delivery: 5 chained PRs (each shippable, ≤400 lines)

| PR | Content | Risk |
|---|---|---|
| 1 | Token layer + fonts + base background/typography + hero (both variants) | Low |
| 2 | Product cards + grid + category photo circles | Low |
| 3 | Filters: mobile Filtrar/Ordenar buttons + desktop sidebar + removable active-filter chips | Medium (only structural change) |
| 4 | Purchase surfaces: sticky bar, drawer (step indicator), MiniCart, item dialog, item page | Medium (touches the critical flow) |
| 5 | Polish: empty states, breadcrumbs, category landing, OG images aligned to new look | Low |

Ship order is fixed (later PRs consume PR 1 tokens). Merge strategy: stacked-to-main.

## Testing & verification

- **Existing component tests must pass unchanged** (aria-labels and logic don't move). A broken existing test = broken scope — except PR 3, which changes desktop filter placement and updates/adds its own tests (sidebar visible on desktop, sheet on mobile, remove-filter-from-chip).
- E2E Playwright suite (merged 2026-07-13) runs on every PR — the quote flow is the regression firewall.
- Per-PR visual verification with the running app at 390px and desktop widths.
- Lighthouse sanity on PR 1 and PR 4 (fonts and layout shifts are the two perf risks; `next/font` self-hosting mitigates the first).

## Risks

- **Font loading** adds weight to the storefront's first paint — mitigated by `next/font` subsetting and catalog-only loading.
- **Desktop sidebar (PR 3)** is the only place where structure changes; it lands isolated in its own PR so it can be reverted without dragging the reskin down.
- **Brand colors clashing with the warm base**: `getBrandTheme()` already guarantees WCAG contrast for brand-on-surface; the cream base was checked against the default blue and stays neutral enough for any hue.
