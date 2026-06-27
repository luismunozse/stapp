# Landing Visual Refresh — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the STApp landing cleaner and airier (Whaticket-inspired) without new image assets — clean hero background, consistent section eyebrows, a mid-page CTA band, and a tighter section order.

**Architecture:** Pure React/Tailwind edits to `app/page.tsx` and `components/landing/*`. Two small new presentational components (`SectionEyebrow`, `CtaBand`). No data-layer or API changes. Phase 2 (real screenshots) is a separate plan.

**Tech Stack:** Next.js (App Router), React, Tailwind CSS, framer-motion (`LazyMotion`/`m`), lucide-react, Playwright (E2E), vitest (unit — not used here; no jsdom/testing-library in repo).

## Global Constraints

- Spanish UI copy is the existing product language — all user-facing strings on the landing stay in **neutral Rioplatense Spanish** (matches current voseo copy: "Probá", "Empezá"). Identifiers/comments in English.
- Brand palette is fixed: do NOT change color tokens. `--primary` ≈ blue-600. Use existing tokens (`text-primary`, `bg-primary`, `text-primary-foreground`, etc.).
- Preserve dark mode and `prefers-reduced-motion` behavior in every edit.
- No fabricated social proof. Do not populate `testimonials.tsx`; it stays mounted and renders null.
- No new image assets in Phase 1.
- Verification reality: visual/decorative changes are verified by `npm run build` + `npm run lint` + a visual check. Only structural/behavioral changes (CTA band presence, section order) get a Playwright assertion. This is intentional — we do not write pixel-assertion theater.

---

### Task 1: Clean hero background + more air

**Files:**
- Modify: `components/landing/hero.tsx` (remove `FloatingIconsBackground` usage + definition + the `floatingIcons` array + grid overlay; keep subtle gradient; bump top spacing/headline)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new (internal visual change only).

- [ ] **Step 1: Remove the grid-pattern overlay and the floating-icons render**

In `components/landing/hero.tsx`, inside the `<section>` (currently around lines 580–589), delete these two blocks, keeping ONLY the gradient div:

Delete the grid overlay:
```tsx
{/* Grid pattern overlay */}
<div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:24px_24px]" />
```

Delete the floating-icons render:
```tsx
{/* Floating tech icons background */}
<FloatingIconsBackground />
```

Keep the gradient div but soften it to a single subtle wash:
```tsx
{/* Background gradient */}
<div className="absolute inset-0 bg-gradient-to-b from-primary/[0.04] via-background to-background dark:from-background dark:via-background dark:to-background" />
```

- [ ] **Step 2: Delete the now-unused `FloatingIconsBackground` function and `floatingIcons` array**

Remove the entire `floatingIcons` constant (currently lines ~53–116) and the `FloatingIconsBackground` function component (currently lines ~118–146). They are no longer referenced.

- [ ] **Step 3: Remove now-unused icon imports**

In the lucide-react import block, remove the icons that were only used by the floating background: `Monitor`, `Smartphone`, `Wrench`, `Laptop`, `Cpu`, `Settings`, `Tablet`, `HardDrive`, and the `type LucideIcon` import. **Keep** everything still used elsewhere (`ArrowRight`, `CheckCircle`, `ChevronDown`, `ClipboardList`, `LayoutDashboard`, `Package`, `Users`, `TrendingUp`, `Clock`, `AlertCircle`, `DollarSign`, `Star`, `Wifi`, `Battery`, `Signal`). Keep `useReducedMotion` from framer-motion (still used by `MockupSlider` and the scroll indicator).

- [ ] **Step 4: Give the hero a touch more vertical air**

Update the `<section>` className padding (currently `pt-24 pb-4 sm:pt-28 sm:pb-6 lg:pt-32 lg:pb-8`) to:
```tsx
className="relative pt-28 pb-8 sm:pt-32 sm:pb-10 lg:pt-36 lg:pb-12 overflow-hidden"
```

- [ ] **Step 5: Verify it compiles and lints clean**

Run: `npm run lint`
Expected: PASS, with NO `'X' is defined but never used` errors for the removed icons/array/function. If any unused-var error appears, an import or symbol was missed — remove it.

Run: `npm run build`
Expected: build completes successfully.

- [ ] **Step 6: Visual check**

Run `npm run dev`, open `http://localhost:3000`, confirm: the hero has no floating tech icons and no grid lines — just a soft gradient. Headline and mockup are unchanged. Check dark mode (toggle in navbar) still looks correct.

- [ ] **Step 7: Commit**

```bash
git add components/landing/hero.tsx
git commit -m "refactor(landing): limpiar fondo del hero (quitar iconos flotantes y grilla)"
```

---

### Task 2: Section eyebrows for consistent rhythm

**Files:**
- Create: `components/landing/section-eyebrow.tsx`
- Modify: `components/landing/features.tsx` (insert eyebrow above the section `<h2>`, ~line 289)
- Modify: `components/landing/comparison.tsx` (~line 223)
- Modify: `components/landing/use-cases-grid.tsx` (~line 26)
- Modify: `components/landing/pricing-section.tsx` (~line 152)
- Modify: `components/landing/faq.tsx` (~line 33)

**Interfaces:**
- Produces: `SectionEyebrow` — `function SectionEyebrow(props: { children: React.ReactNode; className?: string }): JSX.Element`. Renders a small uppercase primary-colored label. Inherits text alignment from its parent (centered sections stay centered).

- [ ] **Step 1: Create the `SectionEyebrow` component**

Create `components/landing/section-eyebrow.tsx`:
```tsx
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function SectionEyebrow({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p
      className={cn(
        "mb-3 text-xs sm:text-sm font-semibold uppercase tracking-wider text-primary",
        className
      )}
    >
      {children}
    </p>
  )
}
```

- [ ] **Step 2: Adopt the eyebrow in `features.tsx`**

Add the import near the other component imports at the top of `components/landing/features.tsx`:
```tsx
import { SectionEyebrow } from "@/components/landing/section-eyebrow"
```
Then insert the eyebrow immediately ABOVE the section `<h2>` (the one with class `text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-balance text-foreground mb-4`, around line 289):
```tsx
<SectionEyebrow>Plataforma todo-en-uno</SectionEyebrow>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-balance text-foreground mb-4">
```

- [ ] **Step 3: Adopt the eyebrow in `comparison.tsx`**

Add the same import. Insert above the section `<h2>` (~line 223):
```tsx
<SectionEyebrow>Por qué STApp</SectionEyebrow>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-balance text-foreground mb-4">
```

- [ ] **Step 4: Adopt the eyebrow in `use-cases-grid.tsx`**

Add the same import. Insert above the `<h2 id="casos-heading" ...>` (~line 26):
```tsx
<SectionEyebrow>Casos de uso</SectionEyebrow>
<h2
  id="casos-heading"
```

- [ ] **Step 5: Adopt the eyebrow in `pricing-section.tsx`**

Add the same import. Insert above the section `<h2>` (~line 152):
```tsx
<SectionEyebrow>Precios</SectionEyebrow>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-balance text-foreground mb-4">
```

- [ ] **Step 6: Adopt the eyebrow in `faq.tsx`**

Add the same import. Insert above the section `<h2>` (~line 33):
```tsx
<SectionEyebrow>Ayuda</SectionEyebrow>
<h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-balance text-foreground mb-4">
```

- [ ] **Step 7: Verify the eyebrows render**

Add this Playwright test to `e2e/public-pages.spec.ts` inside the `Paginas publicas` describe block:
```ts
test("la landing muestra eyebrows de seccion", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Plataforma todo-en-uno", { exact: true })).toBeVisible()
  await expect(page.getByText("Precios", { exact: true })).toBeVisible()
})
```

- [ ] **Step 8: Run the test**

Run: `npx playwright test e2e/public-pages.spec.ts --project=public-chromium`
Expected: PASS (all tests in the file green). If the public project requires the dev server, ensure the Playwright `webServer` config boots it (the repo already runs public specs in CI); otherwise run `npm run dev` in another terminal first.

- [ ] **Step 9: Lint + build**

Run: `npm run lint && npm run build`
Expected: both PASS.

- [ ] **Step 10: Commit**

```bash
git add components/landing/section-eyebrow.tsx components/landing/features.tsx components/landing/comparison.tsx components/landing/use-cases-grid.tsx components/landing/pricing-section.tsx components/landing/faq.tsx e2e/public-pages.spec.ts
git commit -m "feat(landing): agregar eyebrows de seccion para un ritmo visual consistente"
```

---

### Task 3: Mid-page CTA band + section reorder

**Files:**
- Create: `components/landing/cta-band.tsx`
- Modify: `app/page.tsx` (import `CtaBand`, insert it, move `<DownloadApp />` above `<PricingSection />`)
- Modify: `e2e/public-pages.spec.ts` (TDD test first)

**Interfaces:**
- Consumes: `track` from `@/lib/analytics/track` (existing — used in hero as `track("landing_cta_click", { cta, label })`), `Button` from `@/components/ui/button`.
- Produces: `CtaBand` — `function CtaBand(): JSX.Element`. A full-width section with a primary-colored band, heading "Empezá a ordenar tu taller hoy", and a "Probar gratis 30 días" button linking to `/registro?plan=profesional`.

- [ ] **Step 1: Write the failing Playwright test**

Add to `e2e/public-pages.spec.ts` inside the `Paginas publicas` describe block:
```ts
test("la landing tiene banda CTA antes de los precios", async ({ page }) => {
  await page.goto("/")

  const ctaHeading = page.getByRole("heading", {
    name: /empezá a ordenar tu taller hoy/i,
  })
  const pricingHeading = page.getByRole("heading", {
    name: /elegí el plan que mejor se adapte/i,
  })

  await expect(ctaHeading).toBeVisible()
  await expect(pricingHeading).toBeVisible()

  const ctaBox = await ctaHeading.boundingBox()
  const pricingBox = await pricingHeading.boundingBox()
  expect(ctaBox && pricingBox).toBeTruthy()
  // CTA band sits above the pricing section.
  expect((ctaBox as { y: number }).y).toBeLessThan((pricingBox as { y: number }).y)
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx playwright test e2e/public-pages.spec.ts --project=public-chromium -g "banda CTA"`
Expected: FAIL — the CTA heading does not exist yet (`ctaHeading` not visible / timeout).

- [ ] **Step 3: Create the `CtaBand` component**

Create `components/landing/cta-band.tsx`:
```tsx
"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { track } from "@/lib/analytics/track"
import { Button } from "@/components/ui/button"

export function CtaBand() {
  return (
    <section className="py-16 sm:py-20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-2xl bg-primary px-6 py-12 text-center sm:px-12 sm:py-16">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-balance text-primary-foreground">
            Empezá a ordenar tu taller hoy
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm sm:text-base text-primary-foreground/80">
            Probá STApp 30 días gratis, sin tarjeta de crédito. Configuración en minutos.
          </p>
          <div className="mt-6 flex justify-center">
            <Link
              href="/registro?plan=profesional"
              onClick={() =>
                track("landing_cta_click", { cta: "midpage_band", label: "Comenzar Gratis" })
              }
            >
              <Button
                size="lg"
                variant="secondary"
                className="text-sm sm:text-base px-6 py-5 shadow-lg group"
              >
                Probar gratis 30 días
                <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
```
Note: confirm the `Button` component exposes `variant="secondary"` (standard shadcn/ui). If the repo's button variants differ, pick the variant that renders a light button on the blue band (it must read clearly on `bg-primary`). Verify in Step 6's visual check.

- [ ] **Step 4: Wire `CtaBand` into the page and reorder sections**

In `app/page.tsx`, add the import next to the other landing imports:
```tsx
import { CtaBand } from "@/components/landing/cta-band"
```
Then change the section render order. Current order:
```tsx
<NavbarLanding />
<Hero prices={prices} />
<Features />
<Comparison />
<UseCasesGrid />
<Testimonials />
<PricingSection prices={prices} allPlans={allPlans} />
<BlogTeaser />
<FAQ faqs={faqData} />
<DownloadApp />
<Footer />
```
New order — move `<DownloadApp />` up so real product imagery appears sooner, and insert `<CtaBand />` after it (Testimonials stays mounted, still renders null):
```tsx
<NavbarLanding />
<Hero prices={prices} />
<Features />
<Comparison />
<UseCasesGrid />
<DownloadApp />
<CtaBand />
<Testimonials />
<PricingSection prices={prices} allPlans={allPlans} />
<BlogTeaser />
<FAQ faqs={faqData} />
<Footer />
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx playwright test e2e/public-pages.spec.ts --project=public-chromium -g "banda CTA"`
Expected: PASS.

- [ ] **Step 6: Visual check + full file run**

Run `npm run dev`, open `http://localhost:3000`: confirm the "Descargá la app" section now appears before pricing, the blue CTA band sits between them, and its button is clearly readable on the blue background (light button). Check dark mode.

Run the whole public spec: `npx playwright test e2e/public-pages.spec.ts --project=public-chromium`
Expected: all PASS.

- [ ] **Step 7: Lint + build**

Run: `npm run lint && npm run build`
Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add components/landing/cta-band.tsx app/page.tsx e2e/public-pages.spec.ts
git commit -m "feat(landing): banda CTA intermedia y reordenar seccion de descarga"
```

---

## Self-Review

**Spec coverage (Phase 1 sections of the design doc):**
- 1.1 Cleaner hero (remove floating icons + grid, keep gradient, more air) → Task 1. ✅
- 1.2 Consistent section rhythm + eyebrow labels → Task 2 (eyebrows). ✅ (Broad "standardize spacing" was deliberately narrowed to eyebrows + the existing shared h2 classes to avoid vague edits — noted as a scope choice.)
- 1.3 Mid-page CTA band → Task 3. ✅
- 1.4 Section order (move DownloadApp higher; Testimonials stays mounted) → Task 3, Step 4. ✅
- Phase 2 (real screenshots) → intentionally NOT in this plan; separate plan.

**Placeholder scan:** No TBD/TODO/"handle edge cases". The one conditional note (Button variant) includes the concrete fallback rule (must be readable on `bg-primary`) and a verification step. ✅

**Type/name consistency:** `SectionEyebrow` and `CtaBand` are referenced with the exact signatures declared in their Interfaces blocks. `track("landing_cta_click", { cta, label })` matches the existing hero usage. Playwright heading text in the Task 3 test matches the literal copy created in the `CtaBand` component ("Empezá a ordenar tu taller hoy") and the existing pricing copy ("Elegí el plan que mejor se adapte..."). ✅
