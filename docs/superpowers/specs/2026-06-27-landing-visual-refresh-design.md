# Landing Visual Refresh — Design

**Date:** 2026-06-27
**Status:** Approved (pending spec review)
**Reference inspiration:** whaticket.com (clean, airy SaaS style — visual/structure only, NOT its social-proof model)

## Goal

Improve the STApp landing page (`app/page.tsx` + `components/landing/*`) by borrowing three things from whaticket.com:

- **(a) Visual polish** — cleaner, airier layout with more breathing room.
- **(b) Real product screenshots** — replace synthetic div-based mockups with real captures.
- **(c) Structure** — a tighter, more intentional section rhythm.

Explicitly **out of scope:** fabricated social proof (fake testimonials/metrics/logos). This contradicts a standing project decision (honesty over inflated conversion). The empty `testimonials.tsx` scaffold stays empty until real testimonials exist.

## Constraints & current state

- The landing is icon-driven (Lucide) + text. Brand color is blue (`--primary` = `hsl(221.2 83.2% 53.3%)`, ~blue-600). Cool off-white canvas, dark mode enabled, radius 8px. **Palette is not changing.**
- Only real product imagery today: 4 narrow phone-crop screenshots in `public/screenshots/` (dashboard, ordenes, clientes, inventario), used by `download-app.tsx`. No wide desktop captures exist.
- Synthetic mockups live in two places: `hero.tsx` (`MockupSlider` → `BrowserFrame`/`PhoneFrame` divs) and `download-app.tsx` (`PhoneCarousel` shell — but it already loads real screenshots inside).
- Playwright infra is ready for automated capture: auth `storageState`, `ROUTES` map, `settle()`, and a `seed.ts` fixture. Multi-tenant: capture must run against a real QA tenant URL (`STAPP_TEST_URL`), not localhost.

## Delivery strategy

Hybrid, two phases. Phase 1 ships visible improvement immediately (code-only, no new assets). Phase 2 builds the real-screenshot pipeline in parallel and swaps mockups for captures.

---

## Phase 1 — Visual (a) + Structure (c) · code-only

Guiding principle: **less noise, more air** (the essence of Whaticket).

### 1.1 Cleaner hero (`components/landing/hero.tsx`)

- Remove the floating tech-icons background (`FloatingIconsBackground`) and the grid-pattern overlay. Keep a single subtle gradient.
- Increase headline scale and vertical spacing for more breathing room.
- Keep the synthetic `MockupSlider` in Phase 1 (replaced in Phase 2).

### 1.2 Consistent section rhythm

- Standardize vertical spacing and max-widths across landing sections.
- Add a small "eyebrow" label above each section title for the editorial feel.

### 1.3 Mid-page CTA band

- Add one simple repeated CTA band between mid sections (today CTAs only exist in hero / pricing / download).

### 1.4 Section order

Current order is reasonable. Key change: **move "Descargá la app" (`download-app.tsx`) higher** so real product imagery appears sooner. Testimonials scaffold stays in place (empty, honest).

Proposed order:
`Hero → Features → Comparison → UseCasesGrid → DownloadApp → (mid CTA band) → PricingSection → BlogTeaser → FAQ → Footer`
(Testimonials remains mounted but renders null until populated.)

### Phase 1 acceptance

- Hero background reduced to a single subtle gradient (no floating icons, no grid).
- All landing sections share consistent spacing tokens and eyebrow labels.
- One mid-page CTA band present.
- Section order updated per above.
- No new image assets required. Dark mode and reduced-motion behavior preserved.

---

## Phase 2 — Real screenshots (b) · reuses Playwright

### 2.1 Capture script

- New `e2e/screenshots.capture.ts` using the authenticated fixture + `ROUTES`.
- Capture at wide desktop viewport (1440px) → `public/screenshots/desktop/*.png` for the key screens (dashboard, ordenes, inventario, POS, caja — final list TBD with product).
- Runs against `STAPP_TEST_URL` (QA tenant), gated by credentials like the rest of the suite.

### 2.2 Swap synthetic mockups for real captures

- Replace the hero `BrowserFrame` synthetic content with real desktop screenshots inside a clean browser frame (mirror the pattern `download-app.tsx` already uses for the phone).
- Interleave 1–2 real screenshots inside `features.tsx`.

### 2.3 Dependency

- Requires a QA tenant with **good-looking demo data** (`STAPP_TEST_URL`). User confirmed no usable data today, so Phase 2 begins by preparing that seed.

### Phase 2 acceptance

- `e2e/screenshots.capture.ts` produces consistent wide captures into `public/screenshots/desktop/`.
- Hero shows a real screenshot inside a browser frame instead of synthetic divs.
- At least one real screenshot embedded in Features.
- Captures are regenerable by re-running the script.

---

## Risks / open questions

- **Demo data quality** drives Phase 2 entirely; ugly seed data = ugly screenshots. Needs product input on what a "good-looking taller" looks like.
- Exact list of screens to capture is TBD (resolve at Phase 2 planning).
- Keep an eye on bundle/LCP: large hero screenshots must be optimized (`next/image`, correct sizes) so the cleaner hero doesn't regress performance.
