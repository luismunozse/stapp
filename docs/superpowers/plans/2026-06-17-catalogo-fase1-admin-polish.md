# Catálogo Fase 1 — Admin polish + quick wins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pulir el admin de catálogo: confirmaciones unificadas, anti doble-submit, edición inline de stock/precio, vista previa con iframe y feedback de carga a nivel ruta.

**Architecture:** Cambios localizados en `components/catalogo/` + una ruta `loading.tsx`. No se tocan tablas ni endpoints; se consume `PUT /api/catalogo/items/[id]` (acepta updates parciales), `GET /api/catalogo/config`, los DELETE de variantes y el PATCH de carritos. La lógica de parsing/validación del inline edit se extrae a un módulo puro testeable; la celda de edición es un componente presentacional aislado.

**Tech Stack:** Next.js (App Router, RSC), React client components, TypeScript, Tailwind, vitest 4 + @testing-library/react (jsdom, globals), sonner para toasts.

**Spec:** `docs/superpowers/specs/2026-06-17-catalogo-fase1-admin-polish-design.md`

---

## Convenciones de testing (leer antes de empezar)

- Runner: `npx vitest run <ruta>` (un archivo) o con `-t "<nombre>"` para un test puntual.
- Config ya provista (`vitest.config.ts`): `environment: jsdom`, `globals: true`, alias `@` → raíz, setup en `vitest.setup.ts` (ya importa `@testing-library/jest-dom`).
- **No existe `@testing-library/user-event`** → usar `fireEvent` de `@testing-library/react`.
- Patrón de imports en tests: `import { render, screen, fireEvent, waitFor } from "@testing-library/react"`.
- `describe/it/expect/vi` son globales (no hace falta importarlos), pero importarlos explícitamente también funciona y es el estilo de los tests existentes.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/catalogo/inline-edit.ts` (nuevo) | Funciones puras `parseStock`/`parsePrecio` + tipo `ParseResult`. Sin DOM. |
| `components/catalogo/inline-edit-cell.tsx` (nuevo) | Celda presentacional: alterna display↔input, valida con un `parse`, llama `onSave`. |
| `components/catalogo/catalogo-items-tab.tsx` (modificar) | Usar `InlineEditCell` en columnas Precio/Stock de list view; `saveField` optimista + rollback; `loading` en confirm de borrado. |
| `components/catalogo/catalogo-variantes-editor.tsx` (modificar) | `confirm()` → `ConfirmDialog` + `deletingId`/`deleting`. |
| `components/catalogo/catalogo-carritos-abandonados-tab.tsx` (modificar) | `confirm()` → `ConfirmDialog` en "Descartar". |
| `components/catalogo/catalogo-preview-dialog.tsx` (nuevo) | Modal con iframe + toggle móvil/desktop + aviso si inactivo. |
| `components/catalogo/catalogo-admin.tsx` (modificar) | Fetch config (slug/activo) + botón "Vista previa" en header. |
| `app/(dashboard)/catalogo/loading.tsx` (nuevo) | Skeleton a nivel ruta. |

---

## Task 1: Lógica pura de inline edit (`lib/catalogo/inline-edit.ts`)

**Files:**
- Create: `lib/catalogo/inline-edit.ts`
- Test: `__tests__/lib/catalogo-inline-edit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/catalogo-inline-edit.test.ts
import { describe, it, expect } from "vitest"
import { parseStock, parsePrecio } from "@/lib/catalogo/inline-edit"

describe("parseStock", () => {
  it("empty string -> null (sin tracking)", () => {
    expect(parseStock("")).toEqual({ ok: true, value: null })
    expect(parseStock("   ")).toEqual({ ok: true, value: null })
  })
  it("0 is valid (agotado)", () => {
    expect(parseStock("0")).toEqual({ ok: true, value: 0 })
  })
  it("positive integer ok", () => {
    expect(parseStock("12")).toEqual({ ok: true, value: 12 })
  })
  it("rejects decimals", () => {
    expect(parseStock("1.5")).toEqual({ ok: false })
  })
  it("rejects negatives", () => {
    expect(parseStock("-3")).toEqual({ ok: false })
  })
  it("rejects non-numeric", () => {
    expect(parseStock("abc")).toEqual({ ok: false })
  })
})

describe("parsePrecio", () => {
  it("empty string -> null (Consultar)", () => {
    expect(parsePrecio("")).toEqual({ ok: true, value: null })
    expect(parsePrecio("  ")).toEqual({ ok: true, value: null })
  })
  it("integer ok", () => {
    expect(parsePrecio("1000")).toEqual({ ok: true, value: 1000 })
  })
  it("two decimals with dot ok", () => {
    expect(parsePrecio("99.50")).toEqual({ ok: true, value: 99.5 })
  })
  it("comma is normalized to dot", () => {
    expect(parsePrecio("99,50")).toEqual({ ok: true, value: 99.5 })
  })
  it("0 is valid", () => {
    expect(parsePrecio("0")).toEqual({ ok: true, value: 0 })
  })
  it("rejects more than 2 decimals", () => {
    expect(parsePrecio("1.999")).toEqual({ ok: false })
  })
  it("rejects negatives", () => {
    expect(parsePrecio("-5")).toEqual({ ok: false })
  })
  it("rejects non-numeric", () => {
    expect(parsePrecio("10x")).toEqual({ ok: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/catalogo-inline-edit.test.ts`
Expected: FAIL — no se puede resolver `@/lib/catalogo/inline-edit`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/catalogo/inline-edit.ts
export type ParseResult =
  | { ok: true; value: number | null }
  | { ok: false }

/** Stock: entero >= 0. Vacío => null (sin tracking). */
export function parseStock(raw: string): ParseResult {
  const t = raw.trim()
  if (t === "") return { ok: true, value: null }
  if (!/^\d+$/.test(t)) return { ok: false }
  return { ok: true, value: Number(t) }
}

/** Precio: número >= 0 con hasta 2 decimales. Vacío => null (Consultar). Acepta coma decimal. */
export function parsePrecio(raw: string): ParseResult {
  const t = raw.trim()
  if (t === "") return { ok: true, value: null }
  const normalized = t.replace(",", ".")
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return { ok: false }
  return { ok: true, value: Number(normalized) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/catalogo-inline-edit.test.ts`
Expected: PASS (todos los casos).

- [ ] **Step 5: Commit**

```bash
git add lib/catalogo/inline-edit.ts __tests__/lib/catalogo-inline-edit.test.ts
git commit -m "feat(catalogo): inline-edit parsers para stock y precio"
```

---

## Task 2: Celda de edición inline (`inline-edit-cell.tsx`)

**Files:**
- Create: `components/catalogo/inline-edit-cell.tsx`
- Test: `__tests__/components/catalogo-inline-edit-cell.test.tsx`

Componente presentacional. Muestra el valor como botón; al hacer click muestra un `<input>` enfocado; confirma en Enter/blur, cancela en Esc. Valida con la función `parse` recibida; si es inválido o no cambió, no llama `onSave`. Mientras `onSave` está en curso, ignora nuevos commits (guard).

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/catalogo-inline-edit-cell.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { InlineEditCell } from "@/components/catalogo/inline-edit-cell"
import { parseStock } from "@/lib/catalogo/inline-edit"

function setup(onSave = vi.fn().mockResolvedValue(undefined), value: number | null = 5) {
  render(
    <InlineEditCell
      value={value}
      parse={parseStock}
      onSave={onSave}
      format={(v) => (v == null ? "—" : String(v))}
      ariaLabel="Editar stock"
    />,
  )
  return { onSave }
}

describe("InlineEditCell", () => {
  it("shows formatted value as a button", () => {
    setup(undefined, 5)
    expect(screen.getByRole("button", { name: "Editar stock" })).toHaveTextContent("5")
  })

  it("click reveals an input with the current value", () => {
    setup(undefined, 5)
    fireEvent.click(screen.getByRole("button", { name: "Editar stock" }))
    expect(screen.getByRole("spinbutton")).toHaveValue(5)
  })

  it("Enter with a changed valid value calls onSave with parsed value", async () => {
    const { onSave } = setup(vi.fn().mockResolvedValue(undefined), 5)
    fireEvent.click(screen.getByRole("button", { name: "Editar stock" }))
    const input = screen.getByRole("spinbutton")
    fireEvent.change(input, { target: { value: "8" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(8))
  })

  it("Enter with unchanged value does NOT call onSave", async () => {
    const { onSave } = setup(vi.fn().mockResolvedValue(undefined), 5)
    fireEvent.click(screen.getByRole("button", { name: "Editar stock" }))
    const input = screen.getByRole("spinbutton")
    fireEvent.change(input, { target: { value: "5" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(screen.getByRole("button", { name: "Editar stock" })).toBeInTheDocument())
    expect(onSave).not.toHaveBeenCalled()
  })

  it("invalid input does NOT call onSave and reverts", async () => {
    const { onSave } = setup(vi.fn().mockResolvedValue(undefined), 5)
    fireEvent.click(screen.getByRole("button", { name: "Editar stock" }))
    const input = screen.getByRole("spinbutton")
    fireEvent.change(input, { target: { value: "-3" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(screen.getByRole("button", { name: "Editar stock" })).toHaveTextContent("5"))
    expect(onSave).not.toHaveBeenCalled()
  })

  it("Escape cancels without saving", () => {
    const { onSave } = setup(vi.fn().mockResolvedValue(undefined), 5)
    fireEvent.click(screen.getByRole("button", { name: "Editar stock" }))
    const input = screen.getByRole("spinbutton")
    fireEvent.change(input, { target: { value: "99" } })
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.getByRole("button", { name: "Editar stock" })).toHaveTextContent("5")
    expect(onSave).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/catalogo-inline-edit-cell.test.tsx`
Expected: FAIL — no se puede resolver `@/components/catalogo/inline-edit-cell`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/catalogo/inline-edit-cell.tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import type { ParseResult } from "@/lib/catalogo/inline-edit"

interface InlineEditCellProps {
  value: number | null
  parse: (raw: string) => ParseResult
  onSave: (value: number | null) => Promise<void>
  format: (value: number | null) => React.ReactNode
  ariaLabel: string
  /** Texto cuando value === null (ej: "Consultar"). Default usa format(null). */
  placeholder?: React.ReactNode
  align?: "left" | "right"
}

export function InlineEditCell({
  value,
  parse,
  onSave,
  format,
  ariaLabel,
  placeholder,
  align = "right",
}: InlineEditCellProps) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState("")
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const open = () => {
    setRaw(value == null ? "" : String(value))
    setEditing(true)
  }

  const cancel = () => {
    setEditing(false)
    setRaw("")
  }

  const commit = async () => {
    if (saving) return
    const parsed = parse(raw)
    if (!parsed.ok) {
      cancel()
      return
    }
    if (parsed.value === value) {
      cancel()
      return
    }
    setSaving(true)
    try {
      await onSave(parsed.value)
    } finally {
      setSaving(false)
      setEditing(false)
      setRaw("")
    }
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        type="number"
        inputMode="decimal"
        value={raw}
        disabled={saving}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            cancel()
          }
        }}
        className="h-7 w-24 text-sm tabular-nums"
        aria-label={ariaLabel}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={open}
      aria-label={ariaLabel}
      className={`tabular-nums hover:underline decoration-dotted underline-offset-4 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {value == null && placeholder != null ? placeholder : format(value)}
    </button>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/catalogo-inline-edit-cell.test.tsx`
Expected: PASS. (`type="number"` → role `spinbutton`; `toHaveValue(5)` compara numéricamente.)

- [ ] **Step 5: Commit**

```bash
git add components/catalogo/inline-edit-cell.tsx __tests__/components/catalogo-inline-edit-cell.test.tsx
git commit -m "feat(catalogo): InlineEditCell presentacional con validación y guard"
```

---

## Task 3: Cablear inline edit en list view + loading en borrado

**Files:**
- Modify: `components/catalogo/catalogo-items-tab.tsx`

No lleva test nuevo (la lógica testeable ya está en Task 1 y 2); se verifica con tsc/lint + manual. Cambios:

- [ ] **Step 1: Importar la celda y los parsers**

En el bloque de imports de `catalogo-items-tab.tsx`, agregar:

```tsx
import { InlineEditCell } from "./inline-edit-cell"
import { parseStock, parsePrecio } from "@/lib/catalogo/inline-edit"
```

- [ ] **Step 2: Agregar `saveField` (optimista + rollback) y estado `deleting`**

Dentro del componente `CatalogoItemsTab`, junto a los otros handlers (después de `handleDelete`), agregar:

```tsx
const [deleting, setDeleting] = useState(false)

const saveField = async (id: string, field: "stock" | "precio", value: number | null) => {
  const prev = items
  setItems((cur) => cur.map((i) => (i.id === id ? { ...i, [field]: value } : i)))
  try {
    const res = await fetch(`/api/catalogo/items/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || "Error al guardar")
    }
  } catch (err) {
    setItems(prev)
    toast.error(err instanceof Error ? err.message : "Error al guardar")
  }
}
```

- [ ] **Step 3: Actualizar `handleDelete` para reflejar loading**

Reemplazar el cuerpo de `handleDelete` (actual :97-107) por:

```tsx
const handleDelete = async () => {
  if (!deleteId || deleting) return
  setDeleting(true)
  try {
    const res = await fetch(`/api/catalogo/items/${deleteId}`, { method: "DELETE" })
    if (res.ok) {
      toast.success("Item eliminado")
      setItems((prev) => prev.filter((i) => i.id !== deleteId))
    } else {
      toast.error("Error al eliminar")
    }
  } finally {
    setDeleting(false)
    setDeleteId(null)
  }
}
```

- [ ] **Step 4: Reemplazar la celda Precio de list view por `InlineEditCell`**

En la fila de la tabla (actual :373-377), reemplazar el `<td>` de precio por:

```tsx
<td className="px-2 py-1.5 text-right">
  <InlineEditCell
    value={item.precio == null ? null : Number(item.precio)}
    parse={parsePrecio}
    onSave={(v) => saveField(item.id, "precio", v)}
    format={(v) => (v == null ? "" : `$${v.toLocaleString("es-AR")}`)}
    placeholder={<span className="text-muted-foreground italic text-xs">Consultar</span>}
    ariaLabel={`Editar precio de ${item.nombre}`}
  />
</td>
```

- [ ] **Step 5: Reemplazar la celda Stock de list view por `InlineEditCell`**

En la fila (actual :378-386), reemplazar el `<td>` de stock por:

```tsx
<td className="px-2 py-1.5 hidden sm:table-cell text-right">
  {item.tipo === "SERVICIO" ? (
    <span className="text-muted-foreground text-xs">—</span>
  ) : (
    <InlineEditCell
      value={item.stock == null ? null : Number(item.stock)}
      parse={parseStock}
      onSave={(v) => saveField(item.id, "stock", v)}
      format={(v) =>
        v == null ? (
          "—"
        ) : v === 0 ? (
          <span className="text-destructive">0</span>
        ) : (
          v
        )
      }
      placeholder={<span className="text-muted-foreground text-xs">—</span>}
      ariaLabel={`Editar stock de ${item.nombre}`}
    />
  )}
</td>
```

- [ ] **Step 6: Pasar `loading` al ConfirmDialog de borrado**

En el `<ConfirmDialog>` de borrar item (actual :631-639), agregar la prop:

```tsx
loading={deleting}
```

- [ ] **Step 7: Verificar tsc + lint**

Run: `npx tsc --noEmit` → Expected: 0 errores.
Run: `npx eslint "components/catalogo/catalogo-items-tab.tsx" "components/catalogo/inline-edit-cell.tsx"` → Expected: 0 warnings.

- [ ] **Step 8: Commit**

```bash
git add components/catalogo/catalogo-items-tab.tsx
git commit -m "feat(catalogo): edición inline de stock/precio en list view + loading en borrado"
```

---

## Task 4: ConfirmDialog en variantes-editor (+ loading/guard)

**Files:**
- Modify: `components/catalogo/catalogo-variantes-editor.tsx`
- Test: `__tests__/components/catalogo-variantes-delete.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/catalogo-variantes-delete.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockFetch = vi.fn()
global.fetch = mockFetch

describe("CatalogoVariantesEditor — borrar variante", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Carga inicial: una variante
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ variantes: [{ id: "v1", etiqueta: "Rojo", sku: null, precio: null, stock: null, imagen_url: null, activo: true, orden: 0 }] }),
    })
  })

  it("no usa window.confirm y borra vía ConfirmDialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm")
    const { CatalogoVariantesEditor } = await import("@/components/catalogo/catalogo-variantes-editor")
    render(<CatalogoVariantesEditor itemId="item-1" />)

    await waitFor(() => expect(screen.getByText("Rojo")).toBeInTheDocument())

    // DELETE response
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })

    // Abrir confirm (botón de borrar variante)
    fireEvent.click(screen.getByRole("button", { name: /eliminar variante/i }))
    // Confirmar
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }))

    await waitFor(() => expect(screen.queryByText("Rojo")).not.toBeInTheDocument())
    expect(confirmSpy).not.toHaveBeenCalled()
    // 1 carga inicial + 1 delete
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/catalogo-variantes-delete.test.tsx`
Expected: FAIL — hoy usa `window.confirm` y el botón de borrar no abre un ConfirmDialog con texto "Eliminar"; además falta el `aria-label`/nombre accesible "eliminar variante".

- [ ] **Step 3: Implement — reemplazar confirm por ConfirmDialog**

En `catalogo-variantes-editor.tsx`:

1. Agregar import del dialog:

```tsx
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
```

2. Agregar estado (junto a los otros `useState`):

```tsx
const [deletingId, setDeletingId] = useState<string | null>(null)
const [deleting, setDeleting] = useState(false)
```

3. Reemplazar `handleDelete` (actual :48-57) por una versión que ejecuta el borrado (sin `confirm`):

```tsx
const handleDelete = async () => {
  if (!deletingId || deleting) return
  setDeleting(true)
  try {
    const res = await fetch(`/api/catalogo/items/${itemId}/variantes/${deletingId}`, { method: "DELETE" })
    if (res.ok) {
      setVariantes((prev) => prev.filter((v) => v.id !== deletingId))
      toast.success("Variante eliminada")
    } else {
      toast.error("Error al eliminar")
    }
  } finally {
    setDeleting(false)
    setDeletingId(null)
  }
}
```

4. En el botón que antes llamaba a `handleDelete(v.id)`, cambiarlo para abrir el confirm y darle nombre accesible. Buscar el botón de borrar variante (icono `Trash2`) y dejarlo así:

```tsx
<Button
  variant="ghost"
  size="icon"
  aria-label="Eliminar variante"
  onClick={() => setDeletingId(v.id)}
>
  <Trash2 className="h-4 w-4 text-destructive" />
</Button>
```

5. Antes del cierre del JSX raíz del componente, montar el dialog:

```tsx
<ConfirmDialog
  open={!!deletingId}
  onOpenChange={(open) => !open && setDeletingId(null)}
  title="Eliminar variante"
  description="Esta acción no se puede deshacer."
  confirmText="Eliminar"
  variant="danger"
  loading={deleting}
  onConfirm={handleDelete}
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/catalogo-variantes-delete.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify tsc + lint**

Run: `npx tsc --noEmit` → 0 errores.
Run: `npx eslint "components/catalogo/catalogo-variantes-editor.tsx"` → 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add components/catalogo/catalogo-variantes-editor.tsx __tests__/components/catalogo-variantes-delete.test.tsx
git commit -m "feat(catalogo): ConfirmDialog + anti doble-submit al borrar variante"
```

---

## Task 5: ConfirmDialog en carritos abandonados ("Descartar")

**Files:**
- Modify: `components/catalogo/catalogo-carritos-abandonados-tab.tsx`

El handler `handleDiscard` (actual :127-145) usa `confirm()` y ya tiene `actingId` para loading. Se reemplaza el `confirm` por `ConfirmDialog`. No lleva test nuevo dedicado (patrón idéntico al de Task 4, ya cubierto); se verifica con tsc/lint + manual.

- [ ] **Step 1: Importar ConfirmDialog (si no está)**

```tsx
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
```

- [ ] **Step 2: Agregar estado para el id en confirmación**

Junto a los `useState` del componente:

```tsx
const [discardId, setDiscardId] = useState<number | null>(null)
```

- [ ] **Step 3: Separar confirmación de ejecución**

Reemplazar `handleDiscard` (que hoy hace el `confirm` + el PATCH) por una función que solo ejecuta, tomando el id de `discardId`:

```tsx
const handleDiscard = async () => {
  if (discardId == null || actingId != null) return
  setActingId(discardId)
  try {
    const res = await fetch(`/api/catalogo/carritos-abandonados/${discardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "discard" }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || "Error")
    }
    setCarritos((prev) => prev.filter((c) => c.id !== discardId))
    toast.success("Descartado")
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Error")
  } finally {
    setActingId(null)
    setDiscardId(null)
  }
}
```

- [ ] **Step 4: El botón "Descartar" abre el confirm**

Cambiar el `onClick` del botón Descartar para que llame `setDiscardId(c.id)` en vez de `handleDiscard(c.id)`.

- [ ] **Step 5: Montar el ConfirmDialog**

Antes del cierre del JSX raíz:

```tsx
<ConfirmDialog
  open={discardId != null}
  onOpenChange={(open) => !open && setDiscardId(null)}
  title="Descartar carrito"
  description="Se pierde este lead y no se podrá recuperar."
  confirmText="Descartar"
  variant="danger"
  loading={actingId != null && actingId === discardId}
  onConfirm={handleDiscard}
/>
```

- [ ] **Step 6: Verify tsc + lint**

Run: `npx tsc --noEmit` → 0 errores.
Run: `npx eslint "components/catalogo/catalogo-carritos-abandonados-tab.tsx"` → 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add components/catalogo/catalogo-carritos-abandonados-tab.tsx
git commit -m "feat(catalogo): ConfirmDialog al descartar carrito abandonado"
```

---

## Task 6: Modal de vista previa (`catalogo-preview-dialog.tsx`)

**Files:**
- Create: `components/catalogo/catalogo-preview-dialog.tsx`
- Test: `__tests__/components/catalogo-preview-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/catalogo-preview-dialog.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { CatalogoPreviewDialog } from "@/components/catalogo/catalogo-preview-dialog"

describe("CatalogoPreviewDialog", () => {
  it("con catálogo inactivo muestra aviso y no renderiza iframe", () => {
    const { container } = render(
      <CatalogoPreviewDialog open slug="mi-taller" activo={false} onOpenChange={vi.fn()} />,
    )
    expect(screen.getByText(/desactivado/i)).toBeInTheDocument()
    expect(container.querySelector("iframe")).toBeNull()
  })

  it("con catálogo activo renderiza iframe apuntando al slug", () => {
    const { container } = render(
      <CatalogoPreviewDialog open slug="mi-taller" activo={true} onOpenChange={vi.fn()} />,
    )
    const iframe = container.querySelector("iframe")
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute("src")).toContain("/catalogo/mi-taller")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/catalogo-preview-dialog.test.tsx`
Expected: FAIL — no se puede resolver el módulo.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/catalogo/catalogo-preview-dialog.tsx
"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Smartphone, Monitor, RotateCw, ExternalLink } from "lucide-react"

interface CatalogoPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  slug: string
  activo: boolean
}

export function CatalogoPreviewDialog({ open, onOpenChange, slug, activo }: CatalogoPreviewDialogProps) {
  const [device, setDevice] = useState<"mobile" | "desktop">("desktop")
  const [reloadKey, setReloadKey] = useState(0)
  const url = `/catalogo/${slug}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-8">
            <DialogTitle>Vista previa</DialogTitle>
            {activo && (
              <div className="flex items-center gap-1">
                <div className="inline-flex rounded-md border bg-background p-0.5">
                  <button
                    onClick={() => setDevice("mobile")}
                    aria-label="Vista móvil"
                    className={`h-7 w-7 inline-flex items-center justify-center rounded-sm ${
                      device === "mobile" ? "bg-muted text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <Smartphone className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setDevice("desktop")}
                    aria-label="Vista desktop"
                    className={`h-7 w-7 inline-flex items-center justify-center rounded-sm ${
                      device === "desktop" ? "bg-muted text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <Monitor className="h-4 w-4" />
                  </button>
                </div>
                <Button variant="ghost" size="icon" aria-label="Refrescar" onClick={() => setReloadKey((k) => k + 1)}>
                  <RotateCw className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Abrir en pestaña" asChild>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>

        {activo ? (
          <div className="flex-1 min-h-0 flex justify-center bg-muted/30 rounded-md overflow-hidden">
            <iframe
              key={reloadKey}
              src={url}
              title="Vista previa del catálogo"
              className={`h-full bg-background ${device === "mobile" ? "w-[375px]" : "w-full"}`}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center text-sm text-muted-foreground px-6">
            El catálogo está desactivado. Activalo en la pestaña Compartir para previsualizarlo.
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/catalogo-preview-dialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/catalogo/catalogo-preview-dialog.tsx __tests__/components/catalogo-preview-dialog.test.tsx
git commit -m "feat(catalogo): modal de vista previa con iframe y toggle device"
```

---

## Task 7: Botón "Vista previa" en el header del admin

**Files:**
- Modify: `components/catalogo/catalogo-admin.tsx`

Sin test nuevo (el dialog ya está cubierto en Task 6; acá es cableado + fetch). Verificar con tsc/lint + manual.

- [ ] **Step 1: Imports y estado**

Agregar imports:

```tsx
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Eye } from "lucide-react"
import { CatalogoPreviewDialog } from "./catalogo-preview-dialog"
```

(El archivo ya importa `useState` desde "react"; sumar `useEffect` al mismo import.)

Dentro de `CatalogoAdmin`, junto a `const [tab, setTab] = useState("items")`:

```tsx
const [config, setConfig] = useState<{ slug: string; activo: boolean } | null>(null)
const [previewOpen, setPreviewOpen] = useState(false)

useEffect(() => {
  fetch("/api/catalogo/config")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d?.config?.slug) setConfig({ slug: d.config.slug, activo: !!d.config.activo })
    })
    .catch(() => {})
}, [])
```

> Forma de respuesta confirmada: `GET /api/catalogo/config` devuelve `{ config: {...}, url }`, donde `config` incluye `slug` y `activo`. Por eso el acceso es `d.config.slug` / `d.config.activo`.

- [ ] **Step 2: Botón en el header**

En el header (el `<div>` con título, actual :17-27), envolver para alinear el botón a la derecha. Reemplazar ese bloque por:

```tsx
<div className="flex items-start justify-between gap-3">
  <div className="flex items-start gap-3">
    <div className="rounded-lg bg-primary/10 p-2">
      <BookMarked className="h-6 w-6 text-primary" />
    </div>
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold">Catálogo público</h1>
      <p className="text-sm text-muted-foreground">
        Compartí tu lista de productos y servicios. Los clientes pueden navegar y solicitar cotización.
      </p>
    </div>
  </div>
  <Button
    variant="outline"
    className="gap-1.5 shrink-0"
    disabled={!config}
    onClick={() => setPreviewOpen(true)}
  >
    <Eye className="h-4 w-4" />
    <span className="hidden sm:inline">Vista previa</span>
  </Button>
</div>
```

- [ ] **Step 3: Montar el dialog**

Antes del cierre del `<div className="space-y-6">` raíz:

```tsx
{config && (
  <CatalogoPreviewDialog
    open={previewOpen}
    onOpenChange={setPreviewOpen}
    slug={config.slug}
    activo={config.activo}
  />
)}
```

- [ ] **Step 4: Verify tsc + lint**

Run: `npx tsc --noEmit` → 0 errores.
Run: `npx eslint "components/catalogo/catalogo-admin.tsx"` → 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add components/catalogo/catalogo-admin.tsx
git commit -m "feat(catalogo): botón Vista previa en el header del admin"
```

---

## Task 8: `loading.tsx` a nivel ruta

**Files:**
- Create: `app/(dashboard)/catalogo/loading.tsx`

- [ ] **Step 1: Crear el skeleton**

```tsx
// app/(dashboard)/catalogo/loading.tsx
export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-muted" />
        <div className="space-y-2">
          <div className="h-7 w-48 rounded bg-muted" />
          <div className="h-4 w-72 rounded bg-muted" />
        </div>
      </div>
      {/* Tabs */}
      <div className="grid grid-cols-5 gap-2 max-w-3xl">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-9 rounded-md bg-muted" />
        ))}
      </div>
      {/* Grid */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="rounded-lg border overflow-hidden">
            <div className="aspect-video bg-muted" />
            <div className="p-3 space-y-2">
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify tsc + lint**

Run: `npx tsc --noEmit` → 0 errores.
Run: `npx eslint "app/(dashboard)/catalogo/loading.tsx"` → 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/catalogo/loading.tsx"
git commit -m "feat(catalogo): loading.tsx skeleton a nivel ruta"
```

---

## Verificación final (después de todas las tasks)

- [ ] `npx vitest run __tests__/lib/catalogo-inline-edit.test.ts __tests__/components/catalogo-inline-edit-cell.test.tsx __tests__/components/catalogo-variantes-delete.test.tsx __tests__/components/catalogo-preview-dialog.test.tsx` → todo PASS.
- [ ] `npx tsc --noEmit` → 0 errores.
- [ ] `npx eslint "components/catalogo/**" "app/(dashboard)/catalogo/**"` → 0 warnings.
- [ ] `rg -n "window.confirm|[^.]\bconfirm\(" components/catalogo/` → sin resultados (no quedan confirms nativos).
- [ ] Manual: abrir `/catalogo`, list view → editar stock y precio inline (guardar, error, Esc); borrar variante (no doble-submit); descartar carrito; abrir Vista previa (toggle device, refrescar, inactivo).

## Criterios de aceptación (del spec)

1. ✅ No queda `window.confirm()` en `components/catalogo/` (Tasks 4, 5 + check final).
2. ✅ Borrar variante sin doble-submit + loading (Task 4).
3. ✅ Inline edit stock/precio con optimista + rollback (Tasks 1-3).
4. ✅ Botón Vista previa con modal + toggle + aviso inactivo (Tasks 6, 7).
5. ✅ `loading.tsx` a nivel ruta (Task 8).
6. ✅ tsc + eslint verdes; tests nuevos pasan (verificación final).
