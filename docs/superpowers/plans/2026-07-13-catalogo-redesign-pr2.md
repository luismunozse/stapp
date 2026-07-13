# Catalog Redesign — PR 2: Product Cards + Category Photo Circles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the product card to the "warm commercial v2" system and replace category text pills with photo circles — second of 5 chained PRs from `docs/superpowers/specs/2026-07-13-catalogo-redesign-design.md`.

**Architecture:** PR 1's tokens (`cat-*`, `brand`, `font-display`, `shadow-cat*`, `rounded-cat*`) are live on main. This PR consumes them in `item-card.tsx` (full reskin, logic untouched) and in the category row of `catalogo-filters.tsx` (pills → photo circles; navigation/handler logic untouched). The view wrapper switches from `bg-background` to `bg-cat-bg` so the cream base finally shows through.

**Tech Stack:** Next.js, Tailwind (PR 1 token utilities), framer-motion (existing), vitest + testing-library.

## Global Constraints (from the spec + PR 1 learnings)

- **NEVER use an opacity modifier (`/NN`) on `cat-*` or `brand` utilities** — they are `var()` colors without `<alpha-value>`; Tailwind silently drops the class (PR 1 shipped an invisible button this way). Alpha needs stock palette classes (`bg-white/60`) or opaque tokens.
- Storefront is light-only: REMOVE `dark:` variants from touched storefront code, never add them.
- Badges use warm pastel STOCK palette classes (mapped utilities): featured `bg-orange-100 text-orange-800`, discount `bg-green-100 text-green-800`, low stock `bg-orange-100 text-orange-800`.
- Prices: `font-display font-extrabold text-cat-ink tracking-tight` — brand color no longer styles prices.
- No emojis; SVG icons only. Conventional commits, no AI attribution.
- Component logic, props, handlers, aria-labels and keyboard behavior stay EXACTLY as they are — this is a skin change.
- Existing tests must pass unchanged. PR ≤400 changed lines.

---

### Task 1: Product card reskin

**Files:**
- Modify: `components/catalogo-public/item-card.tsx`
- Test: `__tests__/components/catalogo-item-card.test.tsx` (new)

**Interfaces:**
- Consumes: PR 1 utilities (`bg-cat-surface`, `rounded-cat`, `rounded-cat-inner`, `shadow-cat`, `shadow-cat-lg`, `text-cat-ink`, `text-cat-muted`, `font-display`, `bg-brand`, `text-brand-foreground`, `shadow-brand`).
- Produces: same `ItemCard` props contract (unchanged).

- [ ] **Step 1: Write the failing test**

`__tests__/components/catalogo-item-card.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ItemCard } from "@/components/catalogo-public/item-card"

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _f, priority: _p, sizes: _s, ...rest } = props
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />
  },
}))

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
  },
}))

const baseItem = {
  id: "i1",
  tipo: "PRODUCTO" as const,
  nombre: "Módulo pantalla iPhone 13",
  descripcion: "Original",
  categoria_id: null,
  precio: 45000,
  precio_hasta: null,
  precio_lista: 52000,
  imagen_url: "https://example.com/p.jpg",
  imagenes: [],
  etiquetas: [],
  stock_disponible: 10,
  destacado: true,
}

const baseProps = {
  item: baseItem,
  onClick: vi.fn(),
  onQuickAdd: vi.fn(),
  formatPrecio: (n: number) => `$ ${n.toLocaleString("es-AR")}`,
  brandColor: "#2563eb",
}

describe("ItemCard — warm commercial v2", () => {
  it("price uses the display ramp in ink, not the brand color", () => {
    render(<ItemCard {...baseProps} />)
    const price = screen.getByText("$ 45.000")
    expect(price.className).toContain("font-display")
    expect(price.className).toContain("text-cat-ink")
    expect(price).not.toHaveStyle({ color: "#2563eb" })
  })

  it("quick-add is a brand-colored circle via mapped utilities (no inline style)", () => {
    render(<ItemCard {...baseProps} />)
    const btn = screen.getByRole("button", { name: /agregar módulo/i })
    expect(btn.className).toContain("bg-brand")
    expect(btn.className).toContain("shadow-brand")
    expect(btn.getAttribute("style")).toBeNull()
  })

  it("featured badge is a warm pastel chip", () => {
    render(<ItemCard {...baseProps} />)
    const badge = screen.getByText("Destacado")
    expect(badge.className).toContain("bg-orange-100")
    expect(badge.className).toContain("text-orange-800")
  })

  it("card surface uses the token system (no generic border card)", () => {
    const { container } = render(<ItemCard {...baseProps} />)
    const card = container.firstElementChild!
    expect(card.className).toContain("rounded-cat")
    expect(card.className).toContain("bg-cat-surface")
    expect(card.className).toContain("shadow-cat")
    expect(card.className).not.toContain("border ")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/catalogo-item-card.test.tsx`
Expected: FAIL — price is styled with inline brand color, quick-add uses inline style, badge is brand-solid, card uses `rounded-xl border bg-card`.

- [ ] **Step 3: Reskin the component**

Apply to `components/catalogo-public/item-card.tsx` (interfaces, handlers, `role="button"` wrapper, favorite/quick-add logic, LCP `priority` handling: all unchanged):

**3a. Card container** — the `motion.div` className becomes:

```tsx
      className={`group relative rounded-cat bg-cat-surface shadow-cat overflow-hidden transition-all duration-200 hover:shadow-cat-lg ${
        agotado ? "opacity-60" : ""
      }`}
```

**3b. Floating photo** — wrap the image container with an inner frame. Replace:

```tsx
        <div className="aspect-square bg-muted relative overflow-hidden">
```

with:

```tsx
        <div className="p-2.5 pb-0">
        <div className="aspect-square bg-cat-chip relative overflow-hidden rounded-cat-inner">
```

and close the extra `</div>` right after the image-area block ends (after the `agotado` overlay `</div>`, before the text `<div className="p-3 space-y-1">`).

**3c. Badges** — replace the three badge variants:

```tsx
            {item.destacado ? (
              <Badge className="gap-1 border-0 bg-orange-100 text-orange-800 shadow-sm font-bold font-display">
                <Star className="h-3 w-3 fill-current" />
                Destacado
              </Badge>
            ) : (item.vistas_semana ?? 0) >= 5 ? (
              <Badge variant="secondary" className="gap-1 border-0 bg-white/90 text-cat-ink backdrop-blur shadow-sm text-[10px] font-semibold">
                <Eye className="h-3 w-3" />
                {item.vistas_semana} vieron
              </Badge>
            ) : null}

            {tieneAnchor && pctDescuento > 0 && (
              <Badge className="gap-0.5 border-0 bg-green-100 text-green-800 text-[10px] font-bold shadow-sm">
                -{pctDescuento}%
              </Badge>
            )}

            {stockBajo && !agotado && (
              <Badge variant="secondary" className="gap-1 border-0 bg-orange-100 text-orange-800 text-[10px] font-semibold shadow-sm">
                <Flame className="h-3 w-3" />
                Últimas {item.stock_disponible}
              </Badge>
            )}
```

**3d. Favorite button** — same logic, warm colors (note: stock `bg-white/*` keeps the alpha, token colors go opaque):

```tsx
              className={`absolute top-2 right-2 h-11 w-11 sm:h-9 sm:w-9 rounded-full backdrop-blur flex items-center justify-center transition-all active:scale-90 ${
                isFav
                  ? "bg-white/95 text-rose-500 shadow"
                  : "bg-white/80 text-cat-muted sm:opacity-0 sm:group-hover:opacity-100 hover:text-rose-500 shadow-sm"
              }`}
```

**3e. Agotado overlay** — `bg-background/60` → `bg-white/60` (token can't take alpha).

**3f. Text block** — name/description/price:

```tsx
        <div className="p-3 pt-2.5 space-y-1">
          <h3 className="font-medium text-sm text-cat-ink line-clamp-2 min-h-[2.5rem] leading-snug">
            {item.nombre}
          </h3>
          {item.descripcion && (
            <p className="text-[11px] text-cat-muted line-clamp-1 leading-tight">
              {item.descripcion}
            </p>
          )}
          <div className="flex items-baseline gap-1.5 flex-wrap min-h-[1.5rem]">
            {sinPrecio ? (
              <span className="text-sm font-normal text-cat-muted italic">Consultar precio</span>
            ) : (
              <>
                <span className="font-display text-lg font-extrabold tracking-tight text-cat-ink leading-none">
                  {item.precio_hasta != null
                    ? `Desde ${formatPrecio(Number(item.precio))}`
                    : formatPrecio(Number(item.precio))}
                </span>
                {tieneAnchor && (
                  <span className="text-xs text-cat-muted line-through leading-none">
                    {formatPrecio(Number(item.precio_lista))}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
```

**3g. Quick-add** — mapped utilities, no inline style:

```tsx
        <button
          onClick={handleQuickAdd}
          className="absolute bottom-3 right-3 h-11 w-11 sm:h-10 sm:w-10 rounded-full bg-brand text-brand-foreground shadow-brand flex items-center justify-center transition-all sm:opacity-0 sm:group-hover:opacity-100 hover:scale-110 active:scale-95 z-10"
          aria-label={`Agregar ${item.nombre}`}
        >
          {added ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        </button>
```

Remove the now-unused `brandColor` destructuring ONLY if nothing else in the file uses it — it does stay in the Props interface (public contract unchanged); silence the unused var by keeping the destructure and prefixing: rename to `brandColor: _brandColor` is NOT allowed (contract visible) — instead simply keep `brandColor` destructured and add `void brandColor` is ugly; PREFERRED: leave `brandColor` in the destructure and let it be unused — if ESLint flags it, use `// eslint-disable-next-line @typescript-eslint/no-unused-vars` on the destructure line.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/catalogo-item-card.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Guard — no dark: variants left in the file**

Run: `grep -n "dark:" components/catalogo-public/item-card.tsx`
Expected: no output (storefront is light-only).

- [ ] **Step 6: Commit**

```bash
git add components/catalogo-public/item-card.tsx __tests__/components/catalogo-item-card.test.tsx
git commit -m "feat(catalogo): card de producto cálida v2 con foto flotante y precio display"
```

---

### Task 2: Category photo circles

**Files:**
- Modify: `components/catalogo-public/catalogo-filters.tsx` (Categoria interface + category row block only)
- Test: `__tests__/components/catalogo-category-circles.test.tsx` (new)

**Interfaces:**
- Consumes: `CatalogoImagePlaceholder` (existing, brand-tinted monogram), PR 1 utilities.
- Produces: `Categoria` local interface gains `imagen_url: string | null` (parent already passes full `data.categorias` objects — no caller change needed).

- [ ] **Step 1: Write the failing test**

`__tests__/components/catalogo-category-circles.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { CatalogoFilters } from "@/components/catalogo-public/catalogo-filters"

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _f, priority: _p, sizes: _s, ...rest } = props
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />
  },
}))

const baseProps = {
  search: "",
  onSearch: vi.fn(),
  catalogoSlug: "demo",
  categorias: [
    { id: "c1", nombre: "Repuestos", slug: "repuestos", imagen_url: "https://example.com/rep.jpg" },
    { id: "c2", nombre: "Servicios", slug: null, imagen_url: null },
  ],
  categoriaActiva: "c1",
  onCategoria: vi.fn(),
  sort: "recomendados" as const,
  onSort: vi.fn(),
  tags: [],
  tagsActivos: [],
  onToggleTag: vi.fn(),
  precioMin: 0,
  precioMax: 100000,
  precioRange: [0, 100000] as [number, number],
  onPrecioRange: vi.fn(),
  soloDisponibles: false,
  onSoloDisponibles: vi.fn(),
  brandColor: "#2563eb",
  formatPrecio: (n: number) => `$${n}`,
  hasActiveFilters: false,
  onClearFilters: vi.fn(),
}

describe("CatalogoFilters — category photo circles", () => {
  it("renders a category with image as a photo circle with its name below", () => {
    render(<CatalogoFilters {...baseProps} />)
    const img = screen.getByRole("img", { name: "Repuestos" })
    expect(img).toHaveAttribute("src", "https://example.com/rep.jpg")
    expect(img.className).toContain("rounded-full")
    expect(screen.getByText("Repuestos")).toBeInTheDocument()
  })

  it("category without image falls back to the monogram placeholder, no emoji", () => {
    render(<CatalogoFilters {...baseProps} />)
    const label = screen.getByText("Servicios")
    expect(label).toBeInTheDocument()
    // The link wrapping the fallback circle still navigates/filters
    expect(label.closest("a")).not.toBeNull()
  })

  it("the active category link is marked with aria-current", () => {
    render(<CatalogoFilters {...baseProps} />)
    const active = screen.getByRole("link", { name: /repuestos/i })
    expect(active).toHaveAttribute("aria-current", "true")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/catalogo-category-circles.test.tsx`
Expected: FAIL — today categories render as text pills (no img role, no aria-current).

- [ ] **Step 3: Implement the circles**

**3a.** Widen the local interface (top of `catalogo-filters.tsx`):

```tsx
interface Categoria {
  id: string
  nombre: string
  slug: string | null
  imagen_url: string | null
}
```

**3b.** Add imports: `Image` from `next/image`, `CatalogoImagePlaceholder` from `./catalogo-image-placeholder`.

**3c.** Replace the whole `{categorias.length > 0 && (...)}` block's pill links (keep the outer scroll wrapper, fade edges, and ALL onClick/href logic identical) with circles:

```tsx
            <Link
              href={`/catalogo/${catalogoSlug}`}
              prefetch={false}
              onClick={(e) => {
                if (categoriaActiva !== null) {
                  e.preventDefault()
                  onCategoria(null)
                }
              }}
              aria-current={categoriaActiva === null ? "true" : undefined}
              className="snap-start shrink-0 flex flex-col items-center gap-1.5 w-[64px] group/cat"
            >
              <span
                className={`h-[60px] w-[60px] rounded-full flex items-center justify-center font-display text-[11px] font-extrabold transition-all ${
                  categoriaActiva === null
                    ? "bg-brand text-brand-foreground shadow-brand"
                    : "bg-cat-chip text-cat-ink border-[1.5px] border-cat-border group-hover/cat:border-cat-ink/30"
                }`}
              >
                Todo
              </span>
              <span
                className={`text-[11px] leading-tight text-center truncate w-full ${
                  categoriaActiva === null ? "font-bold text-cat-ink" : "text-cat-muted"
                }`}
              >
                Todos
              </span>
            </Link>
            {categorias.map((cat) => {
              const active = categoriaActiva === cat.id
              const href = cat.slug ? `/catalogo/${catalogoSlug}/c/${cat.slug}` : `/catalogo/${catalogoSlug}`
              return (
                <Link
                  key={cat.id}
                  href={href}
                  prefetch={false}
                  onClick={(e) => {
                    if (!cat.slug) {
                      e.preventDefault()
                      onCategoria(cat.id)
                    }
                  }}
                  aria-current={active ? "true" : undefined}
                  className="snap-start shrink-0 flex flex-col items-center gap-1.5 w-[64px] group/cat"
                >
                  <span
                    className={`relative h-[60px] w-[60px] rounded-full overflow-hidden transition-all ${
                      active
                        ? "ring-[2.5px] ring-[var(--brand)] ring-offset-2 ring-offset-cat-bg shadow-brand"
                        : "border-[1.5px] border-cat-border group-hover/cat:border-cat-ink/30"
                    }`}
                  >
                    {cat.imagen_url ? (
                      <Image
                        src={cat.imagen_url}
                        alt={cat.nombre}
                        fill
                        sizes="60px"
                        className="object-cover rounded-full"
                      />
                    ) : (
                      <CatalogoImagePlaceholder name={cat.nombre} className="h-full w-full" />
                    )}
                  </span>
                  <span
                    className={`text-[11px] leading-tight text-center truncate w-full ${
                      active ? "font-bold text-cat-ink" : "text-cat-muted"
                    }`}
                  >
                    {cat.nombre}
                  </span>
                </Link>
              )
            })}
```

Note: `ring-[var(--brand)]` is a sanctioned arbitrary-value exception (ring color has no mapped utility for the brand var yet; do NOT add alpha to it).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/catalogo-category-circles.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add components/catalogo-public/catalogo-filters.tsx __tests__/components/catalogo-category-circles.test.tsx
git commit -m "feat(catalogo): categorias como circulos con foto y fallback monograma"
```

---

### Task 3: Cream base through the view + sticky bar surface

**Files:**
- Modify: `components/catalogo-public/catalogo-view.tsx` (2 class strings only)

**Interfaces:** none — pure class swaps.

- [ ] **Step 1: Swap the wrapper background**

Line ~274: `className="min-h-dvh bg-background"` → `className="min-h-dvh bg-cat-bg"`.

- [ ] **Step 2: Swap the mobile sticky cart bar surface**

Line ~495: in the sticky bottom bar, `bg-background border-t` → `bg-cat-surface border-t border-cat-border`.

- [ ] **Step 3: Regression gate**

Run: `npx vitest run __tests__/components/`
Expected: all pass except the known pre-existing `orden-form-dispositivo-error` timeout (fails on main too — verify with `git stash` if in doubt; do NOT chase it).

- [ ] **Step 4: Commit**

```bash
git add components/catalogo-public/catalogo-view.tsx
git commit -m "feat(catalogo): fondo crema y superficie calida en la barra de carrito"
```

---

### Task 4: Ship PR 2

- [ ] **Step 1: Full gate**

Run: `npx vitest run __tests__/components/ __tests__/lib/ && npx tsc --noEmit`
Expected: green (modulo the known orden-form timeout).

- [ ] **Step 2: Visual verification (orchestrator)**

Dev server + screenshots at 390px/desktop on a real catalog: cards show floating photo + ink display price + brand quick-add circle; categories render as photo circles with active brand ring; page base is cream.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/catalogo-redesign-pr2
gh pr create --base main --title "feat(catalogo): rediseño visual PR2 — cards y círculos de categoría" --body "PR 2/5 del rediseño (spec: docs/superpowers/specs/2026-07-13-catalogo-redesign-design.md). Cards cálidas v2 + categorías con foto + base crema. Sin cambios de lógica."
```

- [ ] **Step 4: Merge gate (orchestrator)**

Watch checks; READ results; merge ONLY if green (`gh pr merge N --squash --delete-branch` as a separate step, never chained).
