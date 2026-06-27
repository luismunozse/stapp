# Dashboard Admin Redesign — Design

**Date:** 2026-06-27
**Status:** Approved (pending spec review)
**Scope:** ADMIN dashboard only (`app/(dashboard)/dashboard/page.tsx` + `components/dashboard/*`). Vendedor/Técnico variants are a deliberate second pass.

## Goal

Fix the admin dashboard's **presentation** — not its data. The current screen is data-rich but visually flat: six equal-weight stat cards with no focal metric, a kitchen-sink "Alertas" card, the Dólar widget oddly paired with critical alerts, and a cramped 2-column grid on mobile. Redesign it around a clear hierarchy so the owner answers two questions in 3 seconds: "¿cómo vengo de plata?" and "¿qué necesito atender hoy?".

This becomes the **hero screenshot** for the landing (Phase 2 of the landing refresh), so it must look premium.

## Hard constraint: presentation-only

All data the new design needs is **already computed** in `app/(dashboard)/dashboard/page.tsx` (verified). This redesign reorganizes and restyles; it does NOT change queries, calculations, role logic, caching, or any data contract.

Already-available data → new placement:
- `ingresos` (month), `ingresosChange` (% vs prev month), `ingresosHoyTotal`, `ingresosUltimos7Dias` + `totalIngresos7Dias` → **hero metric + sparkline**
- `totalDeudaPendiente` + `ordenesPendienteCobro` (with 0-30/31-60/+60 aging), `ordenesFechaVencida` (SLA), `garantiasPorVencer` + `garantiasVentaPorVencer`, `itemsBajoStock` → **action strip ("Necesita tu atención")**
- `ordenesPendientes`/`totalOrdenes`, `totalClientes` + `clientesChange` → **secondary KPIs**
- `ordenesPorEstado`, `ordenesPorTecnico` → **charts row**
- `ordenesRecientes` → **recent orders list (unchanged)**
- `DolarWidget` → **moved to header (small)**

## Design

Layout, top to bottom (desktop):

```
Header:  Hola, {nombre} · {fecha}                        💵 Dólar (small)
─────────────────────────────────────────────────────────────────────
HERO:    INGRESOS DEL MES
         $1.240.500   ▲12% vs mes anterior        [▁▃▂▅▇▆█ sparkline 7d]
         Hoy: $48.300
─────────────────────────────────────────────────────────────────────
ACTION STRIP — "Necesita tu atención"
         [🔴 Cobros $X·N] [🔴 SLA N] [🟡 Garantías N] [🟡 Stock N]
         (only the ones that fire; empty state: "Todo en orden ✓")
─────────────────────────────────────────────────────────────────────
SECONDARY KPIs:  [Órdenes activas]  [Clientes]   (smaller, lower weight)
─────────────────────────────────────────────────────────────────────
CHARTS:  [Órdenes por estado]   [Órdenes por técnico]
─────────────────────────────────────────────────────────────────────
RECENT:  Órdenes recientes (list, unchanged)
```

### Key decisions

1. **Single financial hero metric.** "Ingresos del mes" as a large number with its `ingresosChange` delta and a 7-day sparkline (`ingresosUltimos7Dias`). Secondary inline: "Hoy". This is where the eye lands — replacing six equal cards.

2. **Break the "Alertas" kitchen-sink into a focused action strip.** A horizontal row of action chips under the hero. Each chip = one concern, semantic tone, clickable to its filtered view:
   - Cobros pendientes → `/ordenes?estado_cobro=PENDIENTE` (danger)
   - SLA vencido (fecha prometida) → orders with `ordenesFechaVencida` (danger)
   - Garantías por vencer → `/ordenes` / `/ventas` (warning)
   - Stock bajo → `/inventario` (warning)
   - Only render chips whose count > 0. If none fire, a calm "Todo en orden ✓" empty state.
   - Aging detail for cobros (0-30/31-60/+60) stays available (e.g. tooltip or the destination view), not as inline wall-of-text.

3. **Dólar widget → compact header variant**, shown only to Argentina orgs. The widget gets a `variant="header"` (a compact rate chip that opens a Popover with the full tabs + converter), rendered in the dashboard header instead of beside critical alerts. It renders only when the org's `pais === "AR"` (the dólar blue/oficial/tarjeta rates are Argentina-specific and irrelevant to other countries). Reading the existing `pais` column for this gate is the one allowed data change.

4. **Secondary KPIs are visually demoted** (smaller cards / lower contrast) so they don't compete with the hero.

5. **Charts and recent orders** keep their data; restyled for consistent spacing and less card-in-card nesting.

### Mobile-first

- Single column throughout.
- Hero: full-width, large number, sparkline below it.
- Action strip: stacks into full-width action rows (no cramped 2-col cards).
- Secondary KPIs: compact (2-up is acceptable here since they're secondary, or a horizontal scroll).
- Generous vertical rhythm between sections.

### Visual language (implementation)

Built with `emil-design-eng` (typographic hierarchy, spacing, micro-interactions, the invisible polish) and `redesign-existing-projects` (audit current, remove generic-AI patterns, upgrade without breaking functionality). Reuse the existing semantic tone system (info/success/warning/danger), currency via `formatCurrency`, and the existing Recharts dependency for the sparkline (no new charting lib). Preserve dark mode.

## Components touched (reshaped, not rebuilt from scratch)

- `app/(dashboard)/dashboard/page.tsx` — re-compose the admin render branch into the new sections. Data fetching untouched.
- `components/dashboard/stat-card.tsx` — likely gains a "hero" / "secondary" visual variant (or a new `HeroMetric` component is introduced alongside).
- New: a `HeroMetric` (big number + delta + sparkline) and an `ActionStrip` (chips + empty state) component.
- `components/dashboard/alert-item.tsx` — superseded by the action strip for admin (kept if still used by other roles).
- `DolarWidget` — gains a `variant="header"` (compact chip + Popover); relocated to the header and gated to `pais === "AR"`. Existing default `variant="card"` behavior preserved for other roles/usages.
- `DashboardCharts`, `OrdenesRecientes` — restyle only.
- Untouched behavior: `QuickActions`, `OnboardingPanel`, `SetupChecklist`, `WhatsNewModal`, `NpsSurvey` (onboarding/version/NPS flows stay).

## Out of scope

- Vendedor and Técnico dashboard variants (second pass after the admin visual language is locked).
- Any backend/query/caching change.
- The landing refresh (separate branch `feat/landing-visual-refresh`).

## Risks / open questions

- **Sparkline**: implement with the existing Recharts setup to avoid a new dependency; keep it lazy-loaded like the current charts to protect dashboard TTI.
- **Action strip empty state** must feel intentional ("Todo en orden"), not broken/empty.
- **Role variants**: the admin re-compose must not regress the vendedor/técnico branches that share `page.tsx`. Those branches keep their current layout until the second pass.
- **Period selector: DECIDED OUT this pass.** The data is fixed (month / today / 7-day) and a functional selector would require new queries, breaking the presentation-only constraint. The header shows name + date + the small Dólar widget — no period control. Revisit only in a later data-scoped change.
