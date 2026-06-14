# Export Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship native XLSX export (#8) and always-available data portability (#13) for STApp.

**Architecture:** Add an `arrayToXLSX` formatter alongside the existing `arrayToCSV` in `lib/csv-export.ts`; refactor the export route so the five entity exporters return `{ data, columns }` and a single `format` switch renders CSV or XLSX at the end. Remove the `data_export` plan gate from raw self-data export (route + client button), keep it on report/analytics export, and surface an export entry point on the subscription-block screen so a churned org can pull its data.

**Tech Stack:** Next.js 16 App Router, TypeScript, ExcelJS (already a dependency), Vitest + @testing-library, Tailwind.

**Strict TDD:** ENABLED. Test runner: `npm run test:run`. Write the failing test first, watch it fail, implement minimally, watch it pass, commit.

**Isolation:** Implement in a dedicated worktree/branch off `main` (current branch `landing/motion-reveal` holds unrelated WIP). Create it via superpowers:using-git-worktrees at execution start. Suggested branch: `feat/export-quickwins`.

---

## File Structure

- `lib/csv-export.ts` — MODIFY. Add `arrayToXLSX(data, columns): Promise<Buffer>` and a shared browser download helper `triggerDownload(blob, filename)`; refactor `downloadCSV` to delegate to it.
- `app/api/export/[entity]/route.ts` — MODIFY. Exporters return `{ data, columns }`; add `format` param switch; remove `hasPlanFeature("data_export")` gate.
- `components/export/export-button.tsx` — MODIFY. Remove client-side premium gate; add CSV/Excel format choice; download via blob.
- `components/subscription/subscription-required-view.tsx` — MODIFY. Add "Exportá tus datos" section linking the five export endpoints.
- `__tests__/lib/csv-export.test.ts` — CREATE. Unit tests for `arrayToXLSX`.
- `__tests__/api/export-entity.test.ts` — CREATE. Route tests: format switch + ungated access.
- `__tests__/api/export-reportes.test.ts` — CREATE. Route test: report export STAYS gated.

Test conventions (from existing `__tests__/api/*`): Vitest globals, helpers in `__tests__/api/helpers.ts` (`mockAuthSuccess`, `mockAuthError`, `mockSupabaseFrom`, `createChainMock`, `parseResponse`). The export route reads `request.nextUrl`, so tests must build a `NextRequest` (not a plain `Request`) and pass `params` as a resolved Promise.

---

## Task 1: `arrayToXLSX` formatter

**Files:**
- Modify: `lib/csv-export.ts`
- Test: `__tests__/lib/csv-export.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/csv-export.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import ExcelJS from "exceljs"
import { arrayToXLSX, type CSVColumn } from "@/lib/csv-export"

const COLUMNS: CSVColumn<any>[] = [
  { key: "nombre", header: "Nombre" },
  { key: "cliente.telefono", header: "Teléfono" },
  { key: "total", header: "Total", transform: (v) => Number(v).toFixed(2) },
]

async function loadWorkbook(buf: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  return wb.worksheets[0]
}

describe("arrayToXLSX", () => {
  it("writes a header row from the column headers", async () => {
    const ws = await loadWorkbook(await arrayToXLSX([], COLUMNS))
    expect(ws.getRow(1).getCell(1).value).toBe("Nombre")
    expect(ws.getRow(1).getCell(2).value).toBe("Teléfono")
    expect(ws.getRow(1).getCell(3).value).toBe("Total")
  })

  it("resolves dot-path keys and applies transforms", async () => {
    const rows = [{ nombre: "Juan", cliente: { telefono: "123" }, total: 99.5 }]
    const ws = await loadWorkbook(await arrayToXLSX(rows, COLUMNS))
    expect(ws.getRow(2).getCell(1).value).toBe("Juan")
    expect(ws.getRow(2).getCell(2).value).toBe("123")
    expect(ws.getRow(2).getCell(3).value).toBe("99.50")
  })

  it("returns headers-only when data is empty (no data rows)", async () => {
    const ws = await loadWorkbook(await arrayToXLSX([], COLUMNS))
    expect(ws.rowCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/lib/csv-export.test.ts`
Expected: FAIL — `arrayToXLSX` is not exported from `@/lib/csv-export`.

- [ ] **Step 3: Implement `arrayToXLSX`**

In `lib/csv-export.ts`, add `import ExcelJS from "exceljs"` at the top, and append this function (reuse the existing `formatValue` for non-transformed cells, mirroring `arrayToCSV`'s key/transform resolution):

```ts
/**
 * Convierte un array de objetos a un workbook XLSX (Buffer).
 * Usa las mismas CSVColumn que arrayToCSV: resuelve keys con dot-path y
 * aplica transform si existe.
 */
export async function arrayToXLSX<T extends Record<string, any>>(
  data: T[],
  columns: CSVColumn<T>[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Datos")

  // Header
  sheet.addRow(columns.map((col) => col.header))
  sheet.getRow(1).font = { bold: true }

  // Data rows
  for (const row of data) {
    sheet.addRow(
      columns.map((col) => {
        const keys = col.key.toString().split(".")
        let value: any = row
        for (const key of keys) {
          value = value?.[key]
        }
        if (col.transform) {
          return col.transform(value, row)
        }
        return formatValue(value)
      })
    )
  }

  // Anchos de columna razonables
  sheet.columns.forEach((column, i) => {
    column.width = Math.max(columns[i].header.length + 2, 14)
  })

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/lib/csv-export.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/csv-export.ts __tests__/lib/csv-export.test.ts
git commit -m "feat(export): add arrayToXLSX formatter"
```

---

## Task 2: Route — `format` switch (CSV | XLSX)

**Files:**
- Modify: `app/api/export/[entity]/route.ts`
- Test: `__tests__/api/export-entity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/export-entity.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"
import {
  mockAuthSuccess,
  mockAuthError,
  mockSupabaseFrom,
  createChainMock,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { GET } from "@/app/api/export/[entity]/route"

function exportRequest(entity: string, query = "") {
  const url = `http://localhost:3000/api/export/${entity}${query}`
  return {
    req: new NextRequest(url),
    ctx: { params: Promise.resolve({ entity }) },
  }
}

describe("GET /api/export/[entity]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clientes is a single-table export (no joins) — simplest to mock
    mockSupabaseFrom({ clientes: createChainMock([]) })
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const { req, ctx } = exportRequest("clientes")
    const res = await GET(req, ctx)
    expect(res.status).toBe(401)
  })

  it("defaults to CSV content-type", async () => {
    mockAuthSuccess()
    const { req, ctx } = exportRequest("clientes")
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/csv")
  })

  it("returns XLSX content-type when format=xlsx", async () => {
    mockAuthSuccess()
    const { req, ctx } = exportRequest("clientes", "?format=xlsx")
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain(
      "spreadsheetml.sheet"
    )
    expect(res.headers.get("Content-Disposition")).toContain(".xlsx")
  })

  it("rejects an invalid entity with 400", async () => {
    mockAuthSuccess()
    const { req, ctx } = exportRequest("noexiste")
    const res = await GET(req, ctx)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/api/export-entity.test.ts`
Expected: FAIL — the route returns CSV regardless of `format`, so the `format=xlsx` test fails on Content-Type.

- [ ] **Step 3: Refactor the route to return data+columns and switch on format**

Rewrite `app/api/export/[entity]/route.ts`. Change the five `exportX` helpers to return `{ data, columns }` and move formatting into `GET`. Add the `arrayToXLSX` import. Full file:

```ts
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import {
  arrayToCSV,
  arrayToXLSX,
  type CSVColumn,
  ORDENES_COLUMNS,
  VENTAS_COLUMNS,
  CLIENTES_COLUMNS,
  INVENTARIO_COLUMNS,
  GARANTIAS_COLUMNS,
} from "@/lib/csv-export"

type EntityType = "ordenes" | "ventas" | "clientes" | "inventario" | "garantias"

const VALID_ENTITIES: EntityType[] = [
  "ordenes",
  "ventas",
  "clientes",
  "inventario",
  "garantias",
]

interface ExportPayload {
  data: any[]
  columns: CSVColumn<any>[]
}

/**
 * GET /api/export/[entity]
 * Exporta los datos propios de la organización a CSV o XLSX.
 *
 * Portabilidad de datos: NO está gateado por plan. Cualquier organización
 * autenticada puede exportar SUS PROPIOS datos (org-scoped por organization_id),
 * en cualquier plan o estado de suscripción. El gate de plan se mantiene solo
 * para la exportación de reportes/analytics (/api/export/reportes).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entity: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { entity } = await params

    if (!VALID_ENTITIES.includes(entity as EntityType)) {
      return NextResponse.json(
        { error: `Entidad no válida: ${entity}` },
        { status: 400 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const filters = Object.fromEntries(searchParams.entries())
    const format = (filters.format || "csv").toLowerCase()

    let payload: ExportPayload
    switch (entity as EntityType) {
      case "ordenes":
        payload = await exportOrdenes(organizationId!, filters)
        break
      case "ventas":
        payload = await exportVentas(organizationId!, filters)
        break
      case "clientes":
        payload = await exportClientes(organizationId!, filters)
        break
      case "inventario":
        payload = await exportInventario(organizationId!, filters)
        break
      case "garantias":
        payload = await exportGarantias(organizationId!, filters)
        break
      default:
        return NextResponse.json(
          { error: "Entidad no soportada" },
          { status: 400 }
        )
    }

    if (format === "xlsx") {
      const buffer = await arrayToXLSX(payload.data, payload.columns)
      return new NextResponse(buffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${entity}_${formatDateFilename()}.xlsx"`,
        },
      })
    }

    const csvContent = arrayToCSV(payload.data, payload.columns)
    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${entity}_${formatDateFilename()}.csv"`,
      },
    })
  } catch (error) {
    console.error("Error exporting data:", error)
    return NextResponse.json(
      { error: "Error al exportar datos" },
      { status: 500 }
    )
  }
}

function formatDateFilename(): string {
  const now = new Date()
  return now.toISOString().split("T")[0].replace(/-/g, "")
}

async function exportOrdenes(
  organizationId: string,
  filters: Record<string, string>
): Promise<ExportPayload> {
  let query = supabaseAdmin
    .from("ordenes_servicio")
    .select(
      `
      *,
      cliente:clientes(nombre, telefono, email),
      tecnico:users!tecnico_id(nombre)
    `
    )
    .eq("organization_id", organizationId)
    .order("fecha_ingreso", { ascending: false })
    .limit(10000)

  if (filters.estado) query = query.eq("estado", filters.estado)
  if (filters.desde) query = query.gte("fecha_ingreso", filters.desde)
  if (filters.hasta) query = query.lte("fecha_ingreso", filters.hasta)

  const { data, error } = await query
  if (error) throw error
  return { data: data || [], columns: ORDENES_COLUMNS }
}

async function exportVentas(
  organizationId: string,
  filters: Record<string, string>
): Promise<ExportPayload> {
  let query = supabaseAdmin
    .from("ventas")
    .select(`*, vendedor:users!vendedor_id(nombre)`)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(10000)

  if (filters.estado) query = query.eq("estado", filters.estado)
  if (filters.desde) query = query.gte("created_at", filters.desde)
  if (filters.hasta) query = query.lte("created_at", filters.hasta)

  const { data, error } = await query
  if (error) throw error
  return { data: data || [], columns: VENTAS_COLUMNS }
}

async function exportClientes(
  organizationId: string,
  filters: Record<string, string>
): Promise<ExportPayload> {
  let query = supabaseAdmin
    .from("clientes")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(10000)

  if (filters.search) {
    query = query.or(
      `nombre.ilike.%${filters.search}%,telefono.ilike.%${filters.search}%,email.ilike.%${filters.search}%`
    )
  }

  const { data, error } = await query
  if (error) throw error
  return { data: data || [], columns: CLIENTES_COLUMNS }
}

async function exportInventario(
  organizationId: string,
  filters: Record<string, string>
): Promise<ExportPayload> {
  let query = supabaseAdmin
    .from("inventario")
    .select("*")
    .eq("organization_id", organizationId)
    .order("nombre", { ascending: true })
    .limit(10000)

  if (filters.categoria) query = query.eq("categoria", filters.categoria)
  if (filters.tipo_dispositivo)
    query = query.eq("tipo_dispositivo", filters.tipo_dispositivo)
  if (filters.proveedor_id) {
    if (filters.proveedor_id === "none") {
      query = query.is("proveedor_id", null)
    } else {
      query = query.eq("proveedor_id", filters.proveedor_id)
    }
  }
  if (filters.bajo_stock === "true") query = query.lt("stock", 5)

  const { data, error } = await query
  if (error) throw error
  return { data: data || [], columns: INVENTARIO_COLUMNS }
}

async function exportGarantias(
  organizationId: string,
  filters: Record<string, string>
): Promise<ExportPayload> {
  let query = supabaseAdmin
    .from("garantias")
    .select(
      `
      *,
      orden:ordenes_servicio(
        numero_orden,
        dispositivo,
        cliente:clientes(nombre, telefono)
      )
    `
    )
    .eq("orden.organization_id", organizationId)
    .order("fecha_vencimiento", { ascending: true })
    .limit(10000)

  if (filters.estado) query = query.eq("estado", filters.estado)

  const { data, error } = await query
  if (error) throw error
  const filteredData = (data || []).filter((g: any) => g.orden !== null)
  return { data: filteredData, columns: GARANTIAS_COLUMNS }
}
```

Note: this same edit removes the `hasPlanFeature("data_export")` gate (Task 3 covers its test). The `import { hasPlanFeature }` line is intentionally gone.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/api/export-entity.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/export/[entity]/route.ts __tests__/api/export-entity.test.ts
git commit -m "feat(export): support xlsx format on entity export route"
```

---

## Task 3: Portability — ungate entity export, keep reports gated

**Files:**
- Modify: `app/api/export/[entity]/route.ts` (gate already removed in Task 2 — this task adds the regression test)
- Test: `__tests__/api/export-entity.test.ts` (extend), `__tests__/api/export-reportes.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/api/export-entity.test.ts` (inside the `describe`):

```ts
  it("allows export even when the org lacks data_export (portability)", async () => {
    mockAuthSuccess()
    // Even if a plan check were consulted, a Free/blocked org returns false.
    // The route must NOT 403 — raw self-data export is always allowed.
    const { req, ctx } = exportRequest("clientes")
    const res = await GET(req, ctx)
    expect(res.status).toBe(200)
  })
```

Create `__tests__/api/export-reportes.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockAuthSuccess, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn(),
}))

import { hasPlanFeature } from "@/lib/subscriptions"
import { GET } from "@/app/api/export/reportes/route"

describe("GET /api/export/reportes (stays gated)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 403 when the org lacks data_export", async () => {
    mockAuthSuccess()
    vi.mocked(hasPlanFeature).mockResolvedValue(false)
    const req = new Request("http://localhost:3000/api/export/reportes?type=ventas")
    const res = await GET(req)
    const { status, body } = await parseResponse(res)
    expect(status).toBe(403)
    expect(body.feature).toBe("data_export")
  })
})
```

- [ ] **Step 2: Run tests to verify the failing one fails**

Run: `npm run test:run -- __tests__/api/export-reportes.test.ts __tests__/api/export-entity.test.ts`
Expected: the new entity-export portability test PASSES already (gate removed in Task 2); the reportes test PASSES (route still gated). If the portability test had been written before Task 2's edit it would have failed with 403 — confirming the gate removal is what makes it green. Both green here verifies the contract: entity export ungated, report export gated.

- [ ] **Step 3: No new implementation needed**

The gate split was implemented in Task 2 (entity route) and the report route is unchanged. If the reportes test fails, do NOT remove its gate — that gate is intentional.

- [ ] **Step 4: Run the full export test set**

Run: `npm run test:run -- __tests__/api/export-entity.test.ts __tests__/api/export-reportes.test.ts __tests__/lib/csv-export.test.ts`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add __tests__/api/export-entity.test.ts __tests__/api/export-reportes.test.ts
git commit -m "test(export): pin portability ungating and report gating contract"
```

---

## Task 4: Browser download helper for binary (XLSX)

**Files:**
- Modify: `lib/csv-export.ts`
- Test: `__tests__/lib/csv-export.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/csv-export.test.ts`:

```ts
import { triggerDownload } from "@/lib/csv-export"

describe("triggerDownload (web)", () => {
  it("creates an anchor with the download filename and clicks it", async () => {
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock")
    const revokeUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {})
    const clicked: string[] = []
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLAnchorElement
      if (tag === "a") el.click = () => clicked.push(el.getAttribute("download") || "")
      return el
    })

    const blob = new Blob(["x"], { type: "text/plain" })
    await triggerDownload(blob, "report.xlsx")

    expect(createUrl).toHaveBeenCalled()
    expect(clicked).toContain("report.xlsx")
    expect(revokeUrl).toHaveBeenCalled()

    vi.restoreAllMocks()
  })
})
```

Add `import { vi } from "vitest"` to the existing import line if not already imported (the file already imports `describe, it, expect`; add `vi`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/lib/csv-export.test.ts`
Expected: FAIL — `triggerDownload` is not exported.

- [ ] **Step 3: Implement `triggerDownload` and refactor `downloadCSV` to use it**

In `lib/csv-export.ts`, replace the existing `downloadCSV` function with the following two functions (keeps the Capacitor-native path and the web path; `downloadCSV` now delegates):

```ts
/**
 * Descarga un Blob en el navegador, o lo guarda al filesystem en Capacitor.
 * Maneja contenido binario (xlsx) y de texto (csv).
 */
export async function triggerDownload(blob: Blob, filename: string): Promise<void> {
  const { Capacitor } = await import("@capacitor/core")
  if (Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem")
      const base64 = await blobToBase64(blob)
      await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Documents,
      })
      alert(`Archivo guardado en Documentos: ${filename}`)
    } catch (error) {
      console.error("Error guardando archivo nativo:", error)
      alert("Error al guardar el archivo")
    }
    return
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.setAttribute("href", url)
  link.setAttribute("download", filename)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      // result is a data URL: strip the "data:...;base64," prefix
      resolve(result.split(",")[1] || "")
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Descarga texto CSV (UTF-8 con BOM para Excel) usando triggerDownload.
 */
export async function downloadCSV(csvContent: string, filename: string): Promise<void> {
  const blob = new Blob(["﻿" + csvContent], {
    type: "text/csv;charset=utf-8;",
  })
  await triggerDownload(blob, filename)
}
```

Note: the old `downloadCSV` wrote `"﻿" + csvContent` natively as UTF-8 text. The new native path writes base64 of the blob (which already includes the BOM), so Excel still opens it with correct encoding.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- __tests__/lib/csv-export.test.ts`
Expected: PASS (all tests, including the new `triggerDownload` test).

- [ ] **Step 5: Commit**

```bash
git add lib/csv-export.ts __tests__/lib/csv-export.test.ts
git commit -m "feat(export): add binary-safe triggerDownload helper"
```

---

## Task 5: Export button — remove premium gate, add format choice

**Files:**
- Modify: `components/export/export-button.tsx`

This is a UI change with no unit test (interaction/visual). Verify by `npm run build` and manual smoke (see Task 7).

- [ ] **Step 1: Rewrite `export-button.tsx`**

Replace the file contents with this. Changes: drop the `isPremium` gate and `UpgradeModal`/`Crown` (raw export is now free), add a CSV/Excel split via a small dropdown, and download via blob using `triggerDownload`.

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Download, Loader2, ChevronDown } from "lucide-react"
import { triggerDownload } from "@/lib/csv-export"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type ExportEntity =
  | "ordenes"
  | "ventas"
  | "clientes"
  | "inventario"
  | "garantias"

type ExportFormat = "csv" | "xlsx"

interface ExportButtonProps {
  entity: ExportEntity
  filters?: Record<string, string>
  label?: string
  variant?: "default" | "outline" | "ghost"
  size?: "default" | "sm" | "lg" | "icon"
  className?: string
}

const ENTITY_LABELS: Record<ExportEntity, string> = {
  ordenes: "órdenes",
  ventas: "ventas",
  clientes: "clientes",
  inventario: "inventario",
  garantias: "garantías",
}

const EMPTY_FILTERS: Record<string, string> = {}

/**
 * Botón de exportación de datos propios (CSV o Excel).
 * Portabilidad: disponible en cualquier plan, sin gate premium.
 */
export function ExportButton({
  entity,
  filters = EMPTY_FILTERS,
  label,
  variant = "outline",
  size = "default",
  className,
}: ExportButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async (format: ExportFormat) => {
    setError(null)
    setLoading(true)
    try {
      const params = new URLSearchParams({ ...filters, format })
      const response = await fetch(`/api/export/${entity}?${params.toString()}`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Error al exportar")
      }

      const disposition = response.headers.get("Content-Disposition")
      let filename = `${entity}_export.${format}`
      if (disposition) {
        const match = disposition.match(/filename="(.+)"/)
        if (match) filename = match[1]
      }

      const blob = await response.blob()
      await triggerDownload(blob, filename)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al exportar")
      console.error("Export error:", err)
    } finally {
      setLoading(false)
    }
  }

  const buttonLabel = label || `Exportar ${ENTITY_LABELS[entity]}`

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            disabled={loading}
            className={className}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {size === "icon" ? null : buttonLabel}
            {size !== "icon" && <ChevronDown className="h-3 w-3 ml-1" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleExport("csv")}>
            CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport("xlsx")}>
            Excel (.xlsx)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
    </>
  )
}
```

- [ ] **Step 2: Verify the dropdown-menu primitive exists**

Run: `npm run test:run -- --reporter=dot __tests__/lib/csv-export.test.ts` is unrelated; instead check the import path resolves:

Run: `Test-Path components/ui/dropdown-menu.tsx` (PowerShell) — if it returns `False`, the project has no dropdown primitive. In that case, fall back to two side-by-side buttons instead of a dropdown:

```tsx
// Fallback (no dropdown-menu primitive): replace the <DropdownMenu>…</DropdownMenu>
// block with two buttons.
<div className="inline-flex gap-2">
  <Button variant={variant} size={size} disabled={loading} className={className} onClick={() => handleExport("csv")}>
    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
    CSV
  </Button>
  <Button variant={variant} size={size} disabled={loading} onClick={() => handleExport("xlsx")}>
    Excel
  </Button>
</div>
```

- [ ] **Step 3: Build to typecheck**

Run: `npm run build`
Expected: build succeeds with no type errors in `export-button.tsx`.

- [ ] **Step 4: Commit**

```bash
git add components/export/export-button.tsx
git commit -m "feat(export): free CSV/Excel export, drop premium gate on raw data"
```

---

## Task 6: "Exportá tus datos" on the subscription-block screen

**Files:**
- Modify: `components/subscription/subscription-required-view.tsx`

- [ ] **Step 1: Add a portability section**

In `components/subscription/subscription-required-view.tsx`, the existing footer note (around line 272-275) reads "Tus datos están seguros — no los perdés al cambiar de plan." Add a real export panel directly above that block, inside `<main>`, after the closing `</div>` of the plan grid (line 270). Insert:

```tsx
        {/* Portabilidad: exportar datos propios incluso con la cuenta bloqueada */}
        <div className="mt-10 max-w-md mx-auto rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold mb-1">Exportá tus datos</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Tus datos son tuyos. Descargalos cuando quieras, incluso con la
            suscripción pausada.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { entity: "clientes", label: "Clientes" },
              { entity: "ordenes", label: "Órdenes" },
              { entity: "ventas", label: "Ventas" },
              { entity: "inventario", label: "Inventario" },
            ].map((it) => (
              <a
                key={it.entity}
                href={`/api/export/${it.entity}?format=xlsx`}
                className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted transition-colors"
              >
                <Download className="h-4 w-4" />
                {it.label}
              </a>
            ))}
          </div>
        </div>
```

Add `Download` to the existing `lucide-react` import on line 7 (it currently imports `Clock, AlertTriangle, CreditCard, LogOut, Check, X, CheckCircle2, ArrowRight, Zap` — append `, Download`).

Using plain `<a href>` (not the `ExportButton` client component) is deliberate: a direct GET download link is the simplest reliable path here, and these endpoints now allow unauthenticated-by-plan (but session-authenticated) access, which a churned org still has.

- [ ] **Step 2: Build to typecheck**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/subscription/subscription-required-view.tsx
git commit -m "feat(subscription): let blocked orgs export their data (portability)"
```

---

## Task 7: Full verification

- [ ] **Step 1: Run the entire test suite**

Run: `npm run test:run`
Expected: all tests pass (no regressions). Pay attention to any other test that imported `downloadCSV` or `ExportButton` — the signatures changed (`downloadCSV` is unchanged in signature; `ExportButton` dropped props `none` — it had no required-prop changes). If a test referenced `UpgradeModal` via the export button, update it.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Manual smoke (web)**

Run: `npm run dev`, log in, go to a list with an export button (e.g. clientes), export both CSV and Excel; open the `.xlsx` in Excel/LibreOffice and confirm headers + rows. Then simulate a blocked state (or visit `/suscripcion-requerida`) and confirm the "Exportá tus datos" links download files.

- [ ] **Step 4: Final commit / PR prep**

The branch is ready for a fresh-context review (see PR rule). Do NOT open the PR from this plan — hand back for review first.

---

## Self-Review Notes

- **Spec coverage:** #8 xlsx → Tasks 1,2,4,5. #13 portability (route ungate) → Tasks 2,3. #13 reachability when blocked → Task 6. Report export stays Premium → Task 3. All spec sections mapped.
- **Type consistency:** `arrayToXLSX(data, columns): Promise<Buffer>` defined in Task 1, consumed in Task 2. `triggerDownload(blob, filename)` defined in Task 4, consumed in Tasks 4,5. `ExportPayload { data, columns }` defined and used within Task 2. `CSVColumn<T>` reused from existing `lib/csv-export.ts`.
- **Assumption resolved (2026-06-10):** `components/ui/dropdown-menu.tsx` EXISTS — Task 5's primary dropdown path applies; the two-button fallback is a safety net only.
```
