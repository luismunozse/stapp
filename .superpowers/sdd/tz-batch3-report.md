# Timezone Fix Batch 3 — Inventario

## Files Modified

### components/inventario/audit-historial.tsx
- Type: client component (`"use client"`)
- Added `useCurrency` import from `@/contexts/currency-context`
- Destructured `timezone` from `useCurrency()` inside `AuditHistorial`
- Fixed: `new Date(log.createdAt).toLocaleString("es-AR", { ... })` — added `timeZone: timezone`

### components/inventario/lotes-dialog.tsx
- Type: client component (`"use client"`)
- Added `useCurrency` import from `@/contexts/currency-context`
- Destructured `timezone` from `useCurrency()` inside `LotesDialog`
- Fixed: `new Date(l.fecha_vencimiento).toLocaleDateString("es-AR")` — added `{ timeZone: timezone }`

### components/inventario/series-dialog.tsx
- Type: client component (`"use client"`)
- Added `useCurrency` import from `@/contexts/currency-context`
- Destructured `timezone` from `useCurrency()` inside `SeriesDialog`
- Fixed 2 calls:
  - `new Date(s.fecha_venta).toLocaleDateString("es-AR")` — added `{ timeZone: timezone }`
  - `new Date(s.fecha_garantia_vence).toLocaleDateString("es-AR")` — added `{ timeZone: timezone }`

### app/(dashboard)/inventario/series/page.tsx
- Type: client component (`"use client"`)
- Added `useCurrency` import from `@/contexts/currency-context`
- Destructured `timezone` from `useCurrency()` inside `SeriesGlobalPage`
- Fixed 2 calls:
  - `new Date(s.fecha_venta).toLocaleDateString("es-AR")` — added `{ timeZone: timezone }`
  - `new Date(s.fecha_garantia_vence).toLocaleDateString("es-AR")` — added `{ timeZone: timezone }`

### app/(dashboard)/inventario/lotes/page.tsx
- Type: client component (`"use client"`)
- Added `useCurrency` import from `@/contexts/currency-context`
- Destructured `timezone` from `useCurrency()` inside `LotesPage`
- Fixed: `new Date(l.fecha_vencimiento).toLocaleDateString("es-AR")` — added `{ timeZone: timezone }`

### app/(dashboard)/inventario/conteos/[id]/page.tsx
- Type: client component (`"use client"`)
- Added `useCurrency` import from `@/contexts/currency-context`
- Destructured `timezone` from `useCurrency()` inside `ConteoDetailPage`
- Fixed 2 calls on `conteo.iniciadoAt` and `conteo.finalizadoAt` — added `{ timeZone: timezone }` to both

### app/(dashboard)/inventario/conteos/page.tsx
- Type: client component (`"use client"`)
- Added `useCurrency` import from `@/contexts/currency-context`
- Destructured `timezone` from `useCurrency()` inside `ConteosPage`
- Fixed 2 calls:
  - `new Date().toLocaleDateString("es-AR", { day, month })` in `resetForm` — added `timeZone: timezone`
  - `new Date(c.iniciadoAt).toLocaleString("es-AR", { day, month, hour, minute })` in list — added `timeZone: timezone`

## Files Skipped (no date locale calls)

### components/inventario/inventario-stats.tsx
- Only `data.totalSkus.toLocaleString()` — number formatting, not a date. No fix needed.

### components/inventario/inventario-proveedor-stats.tsx
- Only `data.totalArticulos.toLocaleString("es-AR")` and `data.totalStock.toLocaleString("es-AR")` — number formatting. No fix needed.

### app/(dashboard)/inventario/importar-precios/page.tsx
- `fmtPrice` uses `v.toLocaleString("es-AR", ...)` on numbers. No date locale calls present. No fix needed.

## Notes
- All 7 modified files are client components — `useCurrency()` hook is valid in all of them.
- No server components required DEFAULT_TIMEZONE fallback in this batch.
- `npx tsc --noEmit` exits 0 after all edits.
