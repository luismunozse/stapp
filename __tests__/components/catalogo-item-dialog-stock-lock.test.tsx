// __tests__/components/catalogo-item-dialog-stock-lock.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { CatalogoItemDialog } from "@/components/catalogo/catalogo-item-dialog"
import type { CatalogoItem } from "@/types/database"

function putBodyFor(fetchMock: ReturnType<typeof vi.fn>, id: string) {
  const call = fetchMock.mock.calls.find(
    ([url, opts]: any) => url === `/api/catalogo/items/${id}` && opts?.method === "PUT",
  )
  return call ? JSON.parse((call[1] as any).body) : null
}

function makeItem(overrides: Partial<CatalogoItem> = {}): CatalogoItem {
  return {
    id: "item-1",
    organization_id: "org-1",
    categoria_id: null,
    inventario_id: null,
    tipo: "PRODUCTO",
    nombre: "Producto X",
    descripcion: null,
    precio: 100,
    precio_hasta: null,
    precio_lista: null,
    imagen_url: null,
    imagenes: [],
    etiquetas: [],
    stock: 5,
    destacado: false,
    activo: true,
    orden: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

describe("CatalogoItemDialog — stock lock para items linkeados a inventario", () => {
  beforeEach(() => {
    // El editor de variantes hace fetch al montar; lo neutralizamos.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
  })

  it("item linkeado a inventario: el stock es de solo lectura", () => {
    render(
      <CatalogoItemDialog
        item={makeItem({ inventario_id: "inv-99" })}
        categorias={[]}
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    const input = document.querySelector("#stock") as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.disabled).toBe(true)
    expect(input.value).toMatch(/Inventario/i)
    expect(screen.getByText(/se administra desde ah/i)).toBeInTheDocument()
  })

  it("item NO linkeado: el stock es editable", () => {
    render(
      <CatalogoItemDialog
        item={makeItem({ inventario_id: null })}
        categorias={[]}
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    const input = document.querySelector("#stock") as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.disabled).toBe(false)
    expect(input.getAttribute("placeholder")).toMatch(/sin tracking/i)
  })

  it("al guardar un item linkeado, el payload envía stock: null", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ item: {} }) })
    vi.stubGlobal("fetch", fetchMock)
    render(
      <CatalogoItemDialog
        item={makeItem({ id: "item-link", inventario_id: "inv-99", stock: 7 })}
        categorias={[]}
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText("Guardar cambios"))
    await waitFor(() => expect(putBodyFor(fetchMock, "item-link")).not.toBeNull())
    expect(putBodyFor(fetchMock, "item-link").stock).toBeNull()
  })

  it("al guardar un item NO linkeado, el payload envía el stock editado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ item: {} }) })
    vi.stubGlobal("fetch", fetchMock)
    render(
      <CatalogoItemDialog
        item={makeItem({ id: "item-free", inventario_id: null, stock: 7 })}
        categorias={[]}
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText("Guardar cambios"))
    await waitFor(() => expect(putBodyFor(fetchMock, "item-free")).not.toBeNull())
    expect(putBodyFor(fetchMock, "item-free").stock).toBe(7)
  })
})
