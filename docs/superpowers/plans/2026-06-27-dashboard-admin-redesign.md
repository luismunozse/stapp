# Dashboard Admin Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementer subagents MUST load `emil-design-eng` and `redesign-existing-projects` before visual work.

**Goal:** Restructure the ADMIN dashboard around a clear hierarchy — one financial hero metric + a focused "needs attention" action strip — fixing the flat 6-equal-cards layout, the kitchen-sink Alertas card, and the cramped mobile grid, WITHOUT changing any data/query/backend logic.

**Architecture:** Presentation-only re-composition of the admin render branch in `app/(dashboard)/dashboard/page.tsx`, plus three new focused presentational components (`Sparkline`, `HeroMetric`, `ActionStrip`), a compact variant of `StatCard`, and a compact `header` variant of the existing `DolarWidget`. All metric data is already computed in `page.tsx`. Vendedor/Técnico branches are untouched.

**Tech Stack:** Next.js App Router (server components by default), React, Tailwind, lucide-react, existing semantic tone system, shadcn `Popover` (`components/ui/popover.tsx`), vitest (unit, for pure logic only — repo has NO jsdom/testing-library so JSX is not unit-tested). Recharts present but NOT used by the new sparkline (pure SVG).

## Global Constraints

- **Presentation-only:** do NOT change queries, calculations, role logic, or caching in `page.tsx`. Only re-compose the admin render and restyle.
- **One allowed data change:** add the existing `pais` column to the organizations `.select(...)` already in `page.tsx`, purely to gate the Dólar widget. This is a column read for gating — no calculation/logic change.
- **Dólar is Argentina-only:** the Dólar widget renders only when the org's `pais === "AR"` (column `pais` exists, `TEXT DEFAULT 'AR'`, ISO alpha-2). Applies to every role.
- **Admin branch only** for the hierarchy redesign: the `isTecnico` and `isVendedor` render branches keep their current layout/behavior (other than the Dólar AR-gating, which applies to all). Do not regress them.
- Brand palette / tone system is fixed: reuse `StatTone` / `AlertTone` tokens and `formatCurrency`. No new color tokens, no new chart dependency.
- Preserve dark mode and `prefers-reduced-motion`.
- Spanish UI copy in neutral Rioplatense Spanish; identifiers/comments in English.
- Verification reality: pure logic (sparkline point math, action-item building) is unit-tested with vitest. Visual/JSX is verified by `npm run build` + `npm run lint` + visual check. No pixel-assertion theater.
- Implementer subagents load `emil-design-eng` + `redesign-existing-projects` and may refine spacing/typography/micro-interactions, but MUST preserve each component's data contract (props) and the section structure defined here.

---

### Task 1: Shared `Sparkline` component (extracted SVG)

**Files:**
- Create: `components/dashboard/sparkline.tsx`
- Create: `components/dashboard/sparkline.test.ts`

**Interfaces:**
- Produces:
  - `sparklinePoints(data: number[], width: number, height: number): string` — pure; maps values to a `points` string for `<polyline>`, normalizing min→bottom, max→top. Returns `""` for empty input.
  - `Sparkline(props: { data: number[]; width?: number; height?: number; className?: string }): JSX.Element` — server component, renders an SVG `<polyline>`. Defaults `width=280`, `height=40`.

- [ ] **Step 1: Write the failing test**

Create `components/dashboard/sparkline.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { sparklinePoints } from "./sparkline"

describe("sparklinePoints", () => {
  it("returns empty string for empty data", () => {
    expect(sparklinePoints([], 280, 40)).toBe("")
  })

  it("maps a single value to a flat line at vertical center", () => {
    expect(sparklinePoints([5], 280, 40)).toBe("0,20")
  })

  it("puts the max at the top (y=0) and the min at the bottom (y=height)", () => {
    // data [0, 10] over width 280, height 40: x step = 280; min(0)->y=40, max(10)->y=0
    expect(sparklinePoints([0, 10], 280, 40)).toBe("0,40 280,0")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/dashboard/sparkline.test.ts`
Expected: FAIL — `sparklinePoints` is not defined.

- [ ] **Step 3: Implement `sparkline.tsx`**

Create `components/dashboard/sparkline.tsx`:
```tsx
import { cn } from "@/lib/utils"

/**
 * Pure helper: maps numeric data to an SVG polyline `points` string.
 * Max value sits at y=0 (top), min at y=height (bottom). Flat input centers.
 */
export function sparklinePoints(data: number[], width: number, height: number): string {
  if (data.length === 0) return ""
  if (data.length === 1) return `0,${height / 2}`

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min
  const stepX = width / (data.length - 1)

  return data
    .map((value, i) => {
      const x = i * stepX
      const y = range === 0 ? height / 2 : height - ((value - min) / range) * height
      return `${x},${y}`
    })
    .join(" ")
}

export function Sparkline({
  data,
  width = 280,
  height = 40,
  className,
}: {
  data: number[]
  width?: number
  height?: number
  className?: string
}) {
  const points = sparklinePoints(data, width, height)
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("text-primary", className)}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/dashboard/sparkline.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/sparkline.tsx components/dashboard/sparkline.test.ts
git commit -m "feat(dashboard): componente Sparkline SVG compartido"
```

---

### Task 2: `HeroMetric` component

**Files:**
- Create: `components/dashboard/hero-metric.tsx`

**Interfaces:**
- Consumes: `Sparkline` from Task 1; `StatChange` type from `components/dashboard/stat-card.tsx`.
- Produces: `HeroMetric(props: HeroMetricProps): JSX.Element`, server component.
```ts
interface HeroMetricProps {
  title: string                 // "Ingresos del mes"
  value: string                 // already formatted, e.g. formatCurrency(...)
  change?: StatChange | null    // % vs previous month
  secondaryLabel: string        // "Hoy"
  secondaryValue: string        // already formatted
  sparkline: number[]           // raw daily totals (last 7 days)
}
```

- [ ] **Step 1: Implement `hero-metric.tsx`** (no unit test — pure JSX; verified by build + visual)

Create `components/dashboard/hero-metric.tsx`:
```tsx
import { ArrowDown, ArrowUp } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Sparkline } from "@/components/dashboard/sparkline"
import type { StatChange } from "@/components/dashboard/stat-card"

interface HeroMetricProps {
  title: string
  value: string
  change?: StatChange | null
  secondaryLabel: string
  secondaryValue: string
  sparkline: number[]
}

export function HeroMetric({
  title,
  value,
  change,
  secondaryLabel,
  secondaryValue,
  sparkline,
}: HeroMetricProps) {
  return (
    <Card className="p-5 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              {value}
            </span>
            {change && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-sm font-semibold",
                  change.direction === "up" && "text-success",
                  change.direction === "down" && "text-destructive",
                  change.direction === "neutral" && "text-muted-foreground"
                )}
              >
                {change.direction === "up" && <ArrowUp className="h-3.5 w-3.5" />}
                {change.direction === "down" && <ArrowDown className="h-3.5 w-3.5" />}
                {change.pct}% vs mes anterior
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {secondaryLabel}: <span className="font-semibold text-foreground">{secondaryValue}</span>
          </p>
        </div>
        {sparkline.length > 0 && (
          <Sparkline data={sparkline} className="h-12 w-full max-w-[260px] sm:w-[200px] lg:w-[260px]" />
        )}
      </div>
    </Card>
  )
}
```
Note to implementer: this is a working baseline. Apply `emil-design-eng` polish (typographic rhythm, the delta chip, optional subtle area under the sparkline) while keeping the props contract and the "big number leads" hierarchy intact.

- [ ] **Step 2: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/hero-metric.tsx
git commit -m "feat(dashboard): componente HeroMetric (numero hero + delta + sparkline)"
```

---

### Task 3: `ActionStrip` component + `buildAdminActions` helper

**Files:**
- Create: `components/dashboard/action-strip.tsx`
- Create: `components/dashboard/action-strip.test.ts`

**Interfaces:**
- Consumes: `formatCurrency` from `@/lib/utils`, `CurrencyCode` from `@/lib/currency`, lucide icons.
- Produces:
```ts
type ActionTone = "danger" | "warning" | "info"
interface ActionItem {
  id: string
  tone: ActionTone
  icon: LucideIcon
  label: string     // "Cobros pendientes"
  value: string     // "$320.000 · 8 órdenes"
  href: string
}
interface AdminActionInput {
  moneda: CurrencyCode
  cobrosCount: number
  deudaTotal: number
  slaVencidasCount: number
  garantiasCount: number          // garantiasPorVencer + garantiasVentaPorVencer combined
  stockBajoCount: number
}
function buildAdminActions(input: AdminActionInput): ActionItem[]   // only includes items whose count > 0
function ActionStrip(props: { items: ActionItem[] }): JSX.Element   // renders items, or the calm empty state
```

- [ ] **Step 1: Write the failing test**

Create `components/dashboard/action-strip.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { buildAdminActions } from "./action-strip"

const base = {
  moneda: "ARS" as const,
  cobrosCount: 0,
  deudaTotal: 0,
  slaVencidasCount: 0,
  garantiasCount: 0,
  stockBajoCount: 0,
}

describe("buildAdminActions", () => {
  it("returns no items when every count is zero", () => {
    expect(buildAdminActions(base)).toEqual([])
  })

  it("includes only the concerns whose count is > 0", () => {
    const items = buildAdminActions({ ...base, cobrosCount: 8, deudaTotal: 320000, stockBajoCount: 5 })
    expect(items.map((i) => i.id)).toEqual(["cobros", "stock"])
  })

  it("uses danger tone for cobros and SLA, warning for garantias and stock", () => {
    const items = buildAdminActions({
      ...base,
      cobrosCount: 1,
      slaVencidasCount: 1,
      garantiasCount: 1,
      stockBajoCount: 1,
    })
    const tone = (id: string) => items.find((i) => i.id === id)?.tone
    expect(tone("cobros")).toBe("danger")
    expect(tone("sla")).toBe("danger")
    expect(tone("garantias")).toBe("warning")
    expect(tone("stock")).toBe("warning")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/dashboard/action-strip.test.ts`
Expected: FAIL — `buildAdminActions` not defined.

- [ ] **Step 3: Implement `action-strip.tsx`**

Create `components/dashboard/action-strip.tsx`:
```tsx
import Link from "next/link"
import { AlertTriangle, DollarSign, Package, ShieldCheck, type LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn, formatCurrency } from "@/lib/utils"
import type { CurrencyCode } from "@/lib/currency"

type ActionTone = "danger" | "warning" | "info"

export interface ActionItem {
  id: string
  tone: ActionTone
  icon: LucideIcon
  label: string
  value: string
  href: string
}

export interface AdminActionInput {
  moneda: CurrencyCode
  cobrosCount: number
  deudaTotal: number
  slaVencidasCount: number
  garantiasCount: number
  stockBajoCount: number
}

export function buildAdminActions(input: AdminActionInput): ActionItem[] {
  const items: ActionItem[] = []
  if (input.cobrosCount > 0) {
    items.push({
      id: "cobros",
      tone: "danger",
      icon: DollarSign,
      label: "Cobros pendientes",
      value: `${formatCurrency(input.deudaTotal, input.moneda)} · ${input.cobrosCount} orden${input.cobrosCount !== 1 ? "es" : ""}`,
      href: "/ordenes?estado_cobro=PENDIENTE",
    })
  }
  if (input.slaVencidasCount > 0) {
    items.push({
      id: "sla",
      tone: "danger",
      icon: AlertTriangle,
      label: "Fecha prometida vencida",
      value: `${input.slaVencidasCount} orden${input.slaVencidasCount !== 1 ? "es" : ""}`,
      href: "/ordenes",
    })
  }
  if (input.garantiasCount > 0) {
    items.push({
      id: "garantias",
      tone: "warning",
      icon: ShieldCheck,
      label: "Garantías por vencer",
      value: `${input.garantiasCount}`,
      href: "/ordenes",
    })
  }
  if (input.stockBajoCount > 0) {
    items.push({
      id: "stock",
      tone: "warning",
      icon: Package,
      label: "Stock bajo",
      value: `${input.stockBajoCount} item${input.stockBajoCount !== 1 ? "s" : ""}`,
      href: "/inventario",
    })
  }
  return items
}

const TONE_CARD: Record<ActionTone, string> = {
  danger: "border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15",
  warning: "border-warning/30 bg-warning-50 text-warning-700 hover:bg-warning-100 dark:bg-warning-100/30",
  info: "border-info/30 bg-info-50 text-info-700 hover:bg-info-100 dark:bg-info-100/30",
}

export function ActionStrip({ items }: { items: ActionItem[] }) {
  if (items.length === 0) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-success" />
        Todo en orden — no hay nada urgente.
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <Link
            key={item.id}
            href={item.href}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-4 transition-colors",
              TONE_CARD[item.tone]
            )}
          >
            <Icon className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">{item.label}</p>
              <p className="mt-0.5 text-sm opacity-90">{item.value}</p>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
```
Note to implementer: `emil-design-eng` polish welcome (hover/press feel, icon weight), but keep `buildAdminActions` pure and the "only count>0 renders + calm empty state" behavior exactly as tested. If any `warning-50/100` or `info-50/100` class fails at build, mirror the exact classes from `alert-item.tsx`'s `TONE` map.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/dashboard/action-strip.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Lint + build, then commit**

Run: `npm run lint && npm run build` → both PASS.
```bash
git add components/dashboard/action-strip.tsx components/dashboard/action-strip.test.ts
git commit -m "feat(dashboard): ActionStrip + buildAdminActions (reemplaza el cajon de alertas)"
```

---

### Task 4: `StatCard` compact variant (demote secondary KPIs)

**Files:**
- Modify: `components/dashboard/stat-card.tsx`

**Interfaces:**
- Produces: `StatCardProps` gains an optional `compact?: boolean` (defaults false). When true, the card renders with reduced padding and a smaller value, for the visually-demoted secondary KPI row. All existing props/behavior unchanged when false.

- [ ] **Step 1: Add the `compact` prop**

In `components/dashboard/stat-card.tsx`, add `compact?: boolean` to `StatCardProps` (right after `change`):
```ts
  change?: StatChange | null
  /** Demoted visual treatment for secondary KPIs (smaller padding + value). */
  compact?: boolean
```

- [ ] **Step 2: Apply the compact styling**

Read the file first to copy the exact current classNames. Thread `compact` into the card padding and the value text size, keeping the current values as the non-compact branch:
- Card padding: wrap the current `p-3 sm:p-5` as `cn(compact ? "p-3 sm:p-4" : "p-3 sm:p-5")`.
- Value text: wrap the current value size (`text-2xl sm:text-3xl`) as `cn(compact ? "text-xl sm:text-2xl" : "text-2xl sm:text-3xl")`.
Do not alter the non-compact values.

- [ ] **Step 3: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: both PASS. No other call sites change (the prop is optional, defaults false).

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/stat-card.tsx
git commit -m "feat(dashboard): variante compact de StatCard para KPIs secundarios"
```

---

### Task 5: Compact `header` variant of `DolarWidget`

**Files:**
- Modify: `components/cotizacion-dolar/dolar-widget.tsx`

**Interfaces:**
- Consumes: `Popover`, `PopoverTrigger`, `PopoverContent` from `@/components/ui/popover`.
- Produces: `DolarWidget(props?: { variant?: "card" | "header" }): JSX.Element`. Default `variant="card"` preserves the existing full-card rendering and behavior everywhere it's already used. `variant="header"` renders a compact trigger (blue rate) that opens a Popover containing the full panel (tabs + compra/venta + converter). All fetch/polling/state logic is shared between variants.

- [ ] **Step 1: Add the prop and the Popover import**

In `components/cotizacion-dolar/dolar-widget.tsx`:
- Add the import: `import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"`.
- Change the signature to `export function DolarWidget({ variant = "card" }: { variant?: "card" | "header" } = {}) {`.
Keep ALL existing hooks, `fetchCotizaciones`, `convertir`, handlers, and `formatNumber` exactly as they are.

- [ ] **Step 2: Extract the panel body into a reusable variable**

After the helpers and before the current `return (`, define `panelBody` as the existing conditional currently inside `<CardContent>` (the `error ? ... : loading && !cotizacionActual ? ... : ( <>...</> )` block). Cut that exact JSX out of `CardContent` and assign it:
```tsx
const panelBody = error ? (
  <p className="text-sm text-destructive">{error}</p>
) : loading && !cotizacionActual ? (
  <div className="space-y-2">
    <div className="h-8 bg-muted animate-pulse rounded" />
    <div className="h-4 bg-muted animate-pulse rounded w-2/3" />
  </div>
) : (
  <>
    {/* the existing selector + cotización + conversor + última actualización JSX, unchanged */}
  </>
)
```

- [ ] **Step 3: Add the `header` variant branch (compact trigger + popover)**

Before the existing card `return`, add:
```tsx
if (variant === "header") {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted">
          <DollarSign className="h-4 w-4 text-primary" />
          <span className="font-medium">Dólar</span>
          <span className="text-muted-foreground">
            {cotizaciones.blue ? `blue $${formatNumber(cotizaciones.blue.venta)}` : "—"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Cotización Dólar</p>
          <button
            onClick={fetchCotizaciones}
            disabled={loading}
            className="p-2 rounded-lg bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors"
          >
            <RefreshCw className={cn("h-4 w-4 text-primary", loading && "animate-spin")} />
          </button>
        </div>
        {panelBody}
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 4: Point the existing card return at `panelBody`**

The existing `return (<Card>...)` keeps its `CardHeader` (title + refresh button) unchanged, and its `<CardContent className="space-y-4">` now renders `{panelBody}` instead of the inline conditional.

- [ ] **Step 5: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: both PASS. Confirm no other current usage of `<DolarWidget />` broke (default variant is `"card"`).

- [ ] **Step 6: Visual check**

Run `npm run dev`. The full card (default) must look identical to before. Render `<DolarWidget variant="header" />` somewhere to confirm the compact chip shows the blue rate and the popover opens with tabs + converter working. Check dark mode.

- [ ] **Step 7: Commit**

```bash
git add components/cotizacion-dolar/dolar-widget.tsx
git commit -m "feat(dolar): variante header compacta con popover"
```

---

### Task 6: Recompose the admin render branch in `page.tsx`

**Files:**
- Modify: `app/(dashboard)/dashboard/page.tsx` (admin render branch, the `adminStats` array, and the organizations `.select`)

**Interfaces:**
- Consumes: `HeroMetric` (Task 2), `ActionStrip` + `buildAdminActions` (Task 3), `StatCard` `compact` (Task 4), `DolarWidget` `variant="header"` (Task 5).
- All metric data already exists in scope: `ingresos`, `ingresosChange`, `ingresosHoyTotal`, `ingresosUltimos7Dias`, `moneda`, `totalDeudaPendiente`, `ordenesPendienteCobro`, `ordenesFechaVencida`, `garantiasPorVencer`, `garantiasVentaPorVencer`, `itemsBajoStock`, `ordenesPendientes`, `totalOrdenes`, `totalClientes`, `clientesChange`, plus chart inputs.

- [ ] **Step 1: Add imports**

At the top of `page.tsx`, add:
```tsx
import { HeroMetric } from "@/components/dashboard/hero-metric"
import { ActionStrip, buildAdminActions } from "@/components/dashboard/action-strip"
```
(`DolarWidget` is already imported.)

- [ ] **Step 2: Add `pais` to the org select and compute `esArgentina`**

Find the existing organizations query (currently `.select("moneda, zona_horaria, onboarding_completed")`) and add `pais`:
```tsx
.select("moneda, zona_horaria, onboarding_completed, pais")
```
Then, just after `const moneda = (orgData?.moneda || "ARS") as CurrencyCode`, add:
```tsx
const esArgentina = (orgData?.pais ?? "AR") === "AR"
```

- [ ] **Step 3: Reduce `adminStats` to the two secondary KPIs**

Replace the 6-item `adminStats` array with ONLY the secondary KPIs (hero + action concerns now render separately). Keep `vendedorStats`/`tecnicoStats` untouched:
```tsx
const adminStats: StatCardProps[] = [
  {
    title: "Órdenes Pendientes",
    value: ordenesPendientes.toString(),
    description: `${totalOrdenes} totales`,
    icon: ClipboardList,
    tone: "info",
    href: "/ordenes",
    compact: true,
  },
  {
    title: "Clientes",
    value: totalClientes.toString(),
    description: "Total registrados",
    icon: Users,
    tone: "success",
    href: "/clientes",
    change: clientesChange,
    compact: true,
  },
]
```

- [ ] **Step 4: Build the admin action items**

Just before the `return (`, add:
```tsx
const adminActions = isAdmin
  ? buildAdminActions({
      moneda,
      cobrosCount: ordenesPendienteCobro.length,
      deudaTotal: totalDeudaPendiente,
      slaVencidasCount: ordenesFechaVencida.length,
      garantiasCount: garantiasPorVencer.length + garantiasVentaPorVencer.length,
      stockBajoCount: itemsBajoStock,
    })
  : []
```

- [ ] **Step 5: Restructure the header (greeting + Dólar chip for admin)**

Replace the current header block:
```tsx
<div>
  <h1 className="text-headline">Dashboard</h1>
  <p className="text-muted-foreground">
    Bienvenido, {currentUserName}
  </p>
</div>
```
with:
```tsx
<div className="flex flex-wrap items-start justify-between gap-3">
  <div>
    <h1 className="text-headline">Dashboard</h1>
    <p className="text-muted-foreground">
      Bienvenido, {currentUserName}
    </p>
  </div>
  {isAdmin && esArgentina && <DolarWidget variant="header" />}
</div>
```

- [ ] **Step 6: Insert HeroMetric + ActionStrip for admin**

Immediately after the `QuickActions` block (still admin-gated), add:
```tsx
{isAdmin && (
  <>
    <HeroMetric
      title="Ingresos del mes"
      value={formatCurrency(ingresos, moneda)}
      change={ingresosChange}
      secondaryLabel="Hoy"
      secondaryValue={formatCurrency(ingresosHoyTotal, moneda)}
      sparkline={ingresosUltimos7Dias.map((d) => d.total)}
    />
    <ActionStrip items={adminActions} />
  </>
)}
```

- [ ] **Step 7: Demote the secondary KPI grid for admin**

Change the stats grid wrapper so admin uses a 2-col layout:
```tsx
<div className={`grid gap-3 sm:gap-4 grid-cols-2 ${isTecnico ? "lg:grid-cols-4" : isVendedor ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
  {stats.map((stat) => (
    <StatCard key={stat.title} {...stat} />
  ))}
</div>
```
Keep the `DashboardCharts` block (admin) with `OrdenesRecientes` child exactly as-is.

- [ ] **Step 8: Replace the Alertas + Dólar block (remove the kitchen-sink for admin)**

The Alertas `Card` and `DolarWidget` are currently together in one `<div className="grid gap-4 md:grid-cols-2">`. Replace that whole block so:
- For non-admin (vendedor/técnico): keep the existing Alertas `Card` verbatim, and render the Dólar card only in Argentina.
- For admin: nothing here (concerns are in `ActionStrip`; the Dólar chip is in the header).
```tsx
{!isAdmin && (
  <div className="grid gap-4 md:grid-cols-2">
    <Card>
      {/* existing Alertas CardHeader + CardContent for vendedor/tecnico — UNCHANGED */}
    </Card>
    {esArgentina && <DolarWidget />}
  </div>
)}
```
Preserve every existing `AlertItem` in the non-admin branch verbatim. Keep `WhatsNewModal` and `NpsSurvey` at the end unchanged.

- [ ] **Step 9: Verify build + lint**

Run: `npm run lint && npm run build`
Expected: both PASS. Watch for: unused imports now only referenced in the non-admin branch (keep them imported; only remove if FULLY unused). Confirm `garantiasPorVencer`, `ordenesFechaVencida`, `itemsBajoStock`, etc. are still referenced (they are — via `buildAdminActions` and/or the non-admin branch).

- [ ] **Step 10: Visual check (all roles)**

Run `npm run dev`. As ADMIN (org `pais="AR"`): hero income leads, Dólar chip in the header opens its popover, action strip shows only firing concerns (or the calm empty state), two compact secondary KPIs, charts + recent orders intact, NO leftover Alertas card. Check mobile (single column, no cramped cards) and dark mode. As VENDEDOR and TÉCNICO: original layout preserved, Dólar card still present (AR). If you can set an org `pais` to a non-AR value, confirm the Dólar widget disappears.

- [ ] **Step 11: Commit**

```bash
git add "app/(dashboard)/dashboard/page.tsx"
git commit -m "feat(dashboard): recomponer admin con hero metric, action strip y dolar en header (solo AR)"
```

---

## Self-Review

**Spec coverage:**
- Single financial hero metric (Ingresos del mes + delta + sparkline + Hoy) → Tasks 1, 2, 6. ✅
- Break "Alertas" kitchen-sink into focused action strip (only count>0, clickable, calm empty state) → Task 3 + Task 6 Steps 6 & 8. ✅
- Dólar widget: user chose option (b) — compact header variant — AND gated to Argentina (`pais === "AR"`) → Task 5 (variant) + Task 6 Steps 2, 5, 8. ✅ (supersedes the spec's original "relocate to own row")
- Secondary KPIs visually demoted → Task 4 (`compact`) + Task 6 Steps 3 & 7. ✅
- Charts + recent orders restyle only → kept structurally (Task 6 Step 7); deeper restyle left to emil polish, no structural change. ✅
- Mobile-first single column, no cramped grid → HeroMetric/ActionStrip responsive; admin secondary grid 2-col → Task 6. ✅
- Presentation-only → enforced; only data change is the `pais` column read for gating (declared in Global Constraints). ✅
- Period selector OUT → not implemented. ✅
- Vendedor/Técnico untouched (except Dólar AR-gating, which is intended for all) → Task 6 gates the new admin UI and preserves the non-admin Alertas branch. ✅

**Placeholder scan:** No TBD/TODO. Component baselines are complete code. Task 5 Step 2 references "the existing ... JSX, unchanged" — that is an extract-in-place instruction (move existing code), not a placeholder; the exact JSX already exists in the file. ✅

**Type/name consistency:** `StatChange` reused in `HeroMetric`. `ActionItem`/`AdminActionInput`/`buildAdminActions` names match between Task 3 code, its test, and the Task 6 call site. `compact` consistent (Task 4 ↔ Task 6). `variant: "card" | "header"` consistent (Task 5 ↔ Task 6 Step 5). `sparklinePoints` signature consistent (Task 1 impl ↔ test). `esArgentina` defined once (Step 2) and used in Steps 5 & 8. ✅
