# Catalog Redesign — PR 1: Token Layer + Fonts + Hero — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the "warm commercial v2" design foundation (CSS tokens, fonts, Tailwind mappings) and reskin the storefront hero — first of 5 chained PRs from `docs/superpowers/specs/2026-07-13-catalogo-redesign-design.md`.

**Architecture:** A new `app/catalogo/[slug]/layout.tsx` loads Plus Jakarta Sans + Inter via `next/font` and wraps every storefront page in a `.catalogo-storefront` scope where fixed light `--cat-*` tokens are defined. Tailwind maps those vars (plus the existing `--brand*` vars) to utilities. The hero component is restyled against the new tokens; per-view `brandCssVars()` application stays untouched.

**Tech Stack:** Next.js App Router, Tailwind CSS 3 (`tailwind.config.ts`), `next/font/google`, vitest + testing-library.

## Global Constraints (from the spec)

- No emojis anywhere in the storefront UI — SVG (lucide) icons only.
- Mapped Tailwind utilities only (`bg-cat-surface`, `bg-brand`, `bg-whatsapp`) — no arbitrary-value classes for tokens.
- Storefront is light-only: `--cat-*` tokens are fixed values; `.dark` must not change them.
- Fonts load only in the catalog layout — the dashboard bundle must not include them.
- Existing component tests must pass unchanged; PR total ≤400 changed lines.
- Conventional commits, no AI attribution.
- WhatsApp CTAs are always green (`#22c55e`) with white text; brand color never styles the WhatsApp button.
- UI copy in Spanish (existing storefront language); code identifiers and comments in English.

---

### Task 1: Token layer — globals.css + Tailwind mappings

**Files:**
- Modify: `app/globals.css` (append at end)
- Modify: `tailwind.config.ts` (inside `theme.extend`)

**Interfaces:**
- Produces: `.catalogo-storefront` CSS class defining `--cat-*` vars; Tailwind utilities `bg-cat-bg`, `bg-cat-surface`, `bg-cat-chip`, `text-cat-ink`, `text-cat-muted`, `border-cat-border`, `bg-brand`, `text-brand`, `text-brand-foreground`, `bg-whatsapp`, `font-display`, `font-body`, `shadow-cat`, `shadow-cat-lg`, `shadow-brand`, `rounded-cat`, `rounded-cat-inner`, `rounded-squircle`. All later PRs consume these.

- [ ] **Step 1: Append the storefront token scope to `app/globals.css`**

```css
/* ── Catalog storefront tokens (warm commercial v2) ─────────────────────────
   Fixed light theme: values are constants on purpose — the public storefront
   does not follow the dashboard's dark mode. Brand vars (--brand*) are set
   per view via brandCssVars(). See docs/superpowers/specs/2026-07-13-catalogo-redesign-design.md */
.catalogo-storefront {
  --cat-bg: #f7f1e8;
  --cat-surface: #fffdf9;
  --cat-border: #e8decf;
  --cat-chip: #f1ebe2;
  --cat-ink: #221c14;
  --cat-muted: #95877a;
}
```

- [ ] **Step 2: Add token mappings to `tailwind.config.ts`**

Inside `theme.extend.colors` add:

```ts
        cat: {
          bg: "var(--cat-bg)",
          surface: "var(--cat-surface)",
          border: "var(--cat-border)",
          chip: "var(--cat-chip)",
          ink: "var(--cat-ink)",
          muted: "var(--cat-muted)",
        },
        brand: {
          DEFAULT: "var(--brand)",
          foreground: "var(--brand-foreground)",
          tint: "var(--brand-tint)",
          "tint-strong": "var(--brand-tint-strong)",
        },
        whatsapp: "#22c55e",
```

Inside `theme.extend` (sibling of `colors`) add:

```ts
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        cat: "0 6px 20px rgba(120,90,40,.10)",
        "cat-lg": "0 8px 28px rgba(120,90,40,.13)",
        brand: "0 5px 16px var(--brand-tint-strong)",
      },
      borderRadius: {
        cat: "24px",
        "cat-inner": "16px",
        squircle: "22px",
      },
```

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit && npx next build --experimental-build-mode compile 2>&1 | tail -5`
Expected: no type errors, build compiles. (No visual change yet — tokens are inert until Task 2 applies the class.)

- [ ] **Step 4: Commit**

```bash
git add app/globals.css tailwind.config.ts
git commit -m "feat(catalogo): token layer cálido v2 y utilidades Tailwind del storefront"
```

---

### Task 2: Catalog layout — fonts + storefront scope

**Files:**
- Create: `app/catalogo/[slug]/layout.tsx`
- Test: `__tests__/components/catalogo-layout.test.tsx`

**Interfaces:**
- Consumes: `.catalogo-storefront` class and `font-body`/`text-cat-ink`/`bg-cat-bg` utilities from Task 1.
- Produces: `CatalogoLayout` default export — a server component wrapping all `/catalogo/[slug]` routes (home, `c/[categoriaSlug]`, `[itemId]`). Exposes `--font-display` and `--font-body` vars via `next/font` classNames.

- [ ] **Step 1: Write the failing test**

`__tests__/components/catalogo-layout.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"

// next/font/google is not available in vitest — mock it to return stable
// className/variable handles like the real loader does.
vi.mock("next/font/google", () => ({
  Plus_Jakarta_Sans: () => ({ variable: "font-display-var", className: "" }),
  Inter: () => ({ variable: "font-body-var", className: "" }),
}))

import CatalogoLayout from "@/app/catalogo/[slug]/layout"

describe("CatalogoLayout", () => {
  it("wraps children in the storefront scope with fonts and base tokens", () => {
    const { container, getByText } = render(
      <CatalogoLayout>
        <p>contenido</p>
      </CatalogoLayout>,
    )
    const root = container.firstElementChild!
    expect(getByText("contenido")).toBeInTheDocument()
    expect(root.className).toContain("catalogo-storefront")
    expect(root.className).toContain("font-display-var")
    expect(root.className).toContain("font-body-var")
    expect(root.className).toContain("bg-cat-bg")
    expect(root.className).toContain("text-cat-ink")
    expect(root.className).toContain("font-body")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/catalogo-layout.test.tsx`
Expected: FAIL — `Cannot find module '@/app/catalogo/[slug]/layout'`

- [ ] **Step 3: Create the layout**

`app/catalogo/[slug]/layout.tsx`:

```tsx
import { Plus_Jakarta_Sans, Inter } from "next/font/google"

// Loaded ONLY here so the dashboard bundle never pays for these fonts.
const displayFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  variable: "--font-display",
  display: "swap",
})

const bodyFont = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
})

/**
 * Storefront scope: fixed light "warm commercial v2" tokens + fonts.
 * Brand vars (--brand*) keep being applied per view via brandCssVars().
 */
export default function CatalogoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`catalogo-storefront ${displayFont.variable} ${bodyFont.variable} min-h-screen bg-cat-bg font-body text-cat-ink`}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/catalogo-layout.test.tsx`
Expected: PASS

- [ ] **Step 5: Smoke-check the storefront renders**

Run: `npm run dev` (background) then open `http://localhost:3000/catalogo/<any-active-slug>`.
Expected: page background turns cream (`#F7F1E8`), body text uses Inter. No layout breakage (existing components still use `bg-background` etc. — they get reskinned in later tasks/PRs; mixed look here is expected and acceptable mid-PR).

- [ ] **Step 6: Commit**

```bash
git add "app/catalogo/[slug]/layout.tsx" __tests__/components/catalogo-layout.test.tsx
git commit -m "feat(catalogo): layout del storefront con fuentes y scope de tokens"
```

---

### Task 3: Hero reskin (both variants + trust chips)

**Files:**
- Modify: `components/catalogo-public/catalogo-hero.tsx`
- Test: `__tests__/components/catalogo-hero.test.tsx` (new)

**Interfaces:**
- Consumes: utilities from Task 1 (`bg-whatsapp`, `bg-cat-surface`, `border-cat-border`, `text-cat-ink`, `text-cat-muted`, `font-display`, `shadow-cat-lg`, `rounded-squircle`).
- Produces: same `CatalogoHero` props contract (unchanged — `bannerUrl, logoUrl, titulo, descripcion, whatsapp, brandColor, shareUrl, trustBadges`). No consumer changes.

- [ ] **Step 1: Write the failing test**

`__tests__/components/catalogo-hero.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { CatalogoHero } from "@/components/catalogo-public/catalogo-hero"

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, priority: _priority, sizes: _sizes, ...rest } = props
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />
  },
}))

const baseProps = {
  bannerUrl: null,
  logoUrl: null,
  titulo: "TecnoCel",
  descripcion: "Servicio técnico",
  whatsapp: "5493815551234",
  brandColor: "#2563eb",
  shareUrl: "https://tecnocel.stapp.com.ar",
  trustBadges: [{ icon: "shield", label: "Garantía 6 meses" }],
}

describe("CatalogoHero — warm commercial v2", () => {
  it("renders the WhatsApp CTA green and BEFORE the share button", () => {
    render(<CatalogoHero {...baseProps} />)
    const wa = screen.getByRole("link", { name: /whatsapp/i })
    const share = screen.getByRole("button", { name: /compartir/i })
    expect(wa.className).toContain("bg-whatsapp")
    // WhatsApp is the primary action: it must precede Share in the DOM.
    expect(wa.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wa).toHaveAttribute("href", "https://wa.me/5493815551234")
  })

  it("renders trust badges as warm chips", () => {
    render(<CatalogoHero {...baseProps} />)
    const chip = screen.getByText("Garantía 6 meses").closest("li")!
    expect(chip.className).toContain("rounded-full")
    expect(chip.className).toContain("bg-cat-surface")
    expect(chip.className).toContain("border-cat-border")
  })

  it("title uses the display font in the no-banner variant", () => {
    render(<CatalogoHero {...baseProps} />)
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("font-display")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/catalogo-hero.test.tsx`
Expected: FAIL — WhatsApp link has no `bg-whatsapp` class (it uses inline brand style today) and Share precedes WhatsApp in the DOM.

- [ ] **Step 3: Reskin the component**

Apply these changes to `components/catalogo-public/catalogo-hero.tsx` (props, share handler, `TRUST_ICONS` map and banner aspect logic stay exactly as they are):

**3a. `TrustStrip` becomes warm chips** — replace the function body:

```tsx
function TrustStrip({ items, brandColor }: { items: TrustBadgeData[]; brandColor: string }) {
  if (!items?.length) return null
  return (
    <div className="container mx-auto max-w-5xl px-4 pb-2">
      <ul className="flex flex-wrap items-center gap-2">
        {items.map((b, i) => {
          const Icon = TRUST_ICONS[b.icon] ?? CheckCircle2
          return (
            <li
              key={`${b.icon}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-cat-border bg-cat-surface px-3.5 py-1.5 text-xs font-medium text-cat-ink"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: brandColor }} />
              <span>{b.label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

**3b. Banner variant** — replace the `if (bannerUrl)` return block's JSX:

```tsx
    return (
      <>
      <header className="relative">
        <div className={`${aspectMobile} ${aspectDesktop} relative overflow-hidden bg-cat-chip`}>
          <Image src={bannerUrl} alt="" fill priority sizes="100vw" className="object-cover" />
          {/* Warm ink gradient (not neutral black) per design system */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#221c14]/70 via-[#221c14]/10 to-transparent" />
          <div className="absolute bottom-3 right-3 flex gap-2 sm:bottom-4 sm:right-4">
            {whatsappLink && (
              <Button
                asChild
                className="h-11 gap-2 rounded-full bg-whatsapp px-4 font-display font-bold text-white shadow-lg hover:bg-whatsapp/90"
                aria-label="Contactar por WhatsApp"
              >
                <a href={whatsappLink} target="_blank" rel="noreferrer">
                  <WhatsAppIcon className="h-5 w-5" />
                  <span>WhatsApp</span>
                </a>
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={handleShare}
              className="h-11 gap-1.5 rounded-full bg-cat-surface/90 font-display font-bold text-cat-ink backdrop-blur hover:bg-cat-surface"
            >
              {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
              <span className="hidden sm:inline">Compartir</span>
            </Button>
          </div>
        </div>
        <div className="container relative mx-auto max-w-5xl px-4 pb-4">
          <div className="flex items-end gap-4">
            {logoUrl && (
              <div className="relative -mt-9 h-[76px] w-[76px] shrink-0 overflow-hidden rounded-squircle border-[3px] border-cat-surface bg-white shadow-cat-lg sm:-mt-11 sm:h-24 sm:w-24">
                <Image src={logoUrl} alt={titulo} fill sizes="96px" className="object-contain p-1" priority />
              </div>
            )}
          </div>
          <h1 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-cat-ink sm:text-4xl">{titulo}</h1>
          {descripcion && <p className="mt-1 text-sm text-cat-muted sm:text-base line-clamp-2">{descripcion}</p>}
        </div>
      </header>
      <TrustStrip items={trustBadges ?? []} brandColor={brandColor} />
      </>
    )
```

**3c. No-banner variant** — replace the final return block's JSX:

```tsx
  return (
    <>
    <header className="relative overflow-hidden">
      {/* Radial brand mesh over ivory: every store looks distinct with zero config */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(75% 65% at 0% -20%, var(--brand-tint-strong, #0f172a14), transparent 60%)," +
            "radial-gradient(65% 60% at 100% 0%, var(--brand-tint, #0f172a0a), transparent 55%)",
        }}
      />
      <div className={`container relative mx-auto max-w-5xl px-4 ${descripcion ? "py-10 sm:py-14" : "py-8 sm:py-10"}`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-squircle bg-cat-surface shadow-cat-lg sm:h-20 sm:w-20">
            {logoUrl ? (
              <Image src={logoUrl} alt={titulo} fill sizes="80px" className="object-contain p-1.5" priority />
            ) : (
              <CatalogoImagePlaceholder name={titulo} className="h-full w-full" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-extrabold leading-[1.05] tracking-tight text-cat-ink sm:text-5xl">{titulo}</h1>
            {descripcion && (
              <p className="mt-2 max-w-2xl text-base leading-relaxed text-cat-muted sm:text-lg line-clamp-3">{descripcion}</p>
            )}
          </div>
          <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
            {whatsappLink && (
              <Button
                asChild
                className="h-11 flex-1 gap-2 rounded-full bg-whatsapp px-4 font-display font-bold text-white shadow-lg hover:bg-whatsapp/90 sm:flex-none"
                aria-label="Contactar por WhatsApp"
              >
                <a href={whatsappLink} target="_blank" rel="noreferrer">
                  <WhatsAppIcon className="h-5 w-5" />
                  <span>Pedir por WhatsApp</span>
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleShare}
              className="h-11 flex-1 gap-1.5 rounded-full border-[1.5px] border-cat-border bg-cat-surface font-display font-bold text-cat-ink sm:flex-none"
            >
              {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
              <span className="hidden sm:inline">Compartir</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
    <TrustStrip items={trustBadges ?? []} brandColor={brandColor} />
    </>
  )
```

Note: the two `style={{ backgroundColor: "var(--brand)" ... }}` WhatsApp buttons are gone — WhatsApp is semantically green now (global constraint). The only remaining inline styles are the brand mesh gradient and trust-icon color, both intentionally brand-driven.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/catalogo-hero.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Verify no existing test broke**

Run: `npx vitest run __tests__/components/ __tests__/lib/catalogo-brand.test.ts`
Expected: all PASS. If any pre-existing test fails, STOP — scope was broken; fix the regression, not the test.

- [ ] **Step 6: Visual verification**

With `npm run dev` running, check `http://localhost:3000/catalogo/<slug>` at 390px and desktop:
- Banner variant: warm gradient, squircle logo overlapping, WhatsApp green pill then Share, ink title on cream below banner.
- No-banner variant: brand mesh on ivory, squircle logo, display-800 title, green WhatsApp first.
- Trust chips: bordered ivory pills with brand-colored icons.

- [ ] **Step 7: Commit**

```bash
git add components/catalogo-public/catalogo-hero.tsx __tests__/components/catalogo-hero.test.tsx
git commit -m "feat(catalogo): hero cálido v2 con logo squircle y WhatsApp como CTA primario"
```

---

### Task 4: Ship PR 1

**Files:** none new (branch + PR mechanics).

- [ ] **Step 1: Full test suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/catalogo-redesign-pr1
gh pr create --base main --title "feat(catalogo): rediseño visual PR1 — tokens, fuentes y hero" --body "PR 1/5 del rediseño del storefront (spec: docs/superpowers/specs/2026-07-13-catalogo-redesign-design.md). Tokens cálidos v2 + next/font (solo catálogo) + hero reskineado. Sin cambios de flujo; tests existentes intactos."
```

- [ ] **Step 3: Wait for CI (E2E included) and merge with squash**

Run: `gh pr checks <n> --watch` then `gh pr merge <n> --squash --delete-branch`
Expected: E2E suite green — the quote flow is the regression firewall.
