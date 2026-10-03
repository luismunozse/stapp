import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

const add = vi.fn()

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, priority: _priority, sizes: _sizes, ...rest } = props
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />
  },
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/components/catalogo-public/cart-drawer", () => ({ CartDrawer: () => null }))
vi.mock("@/components/catalogo-public/use-cart", () => ({
  useCart: () => ({ items: [], count: 0, add }),
}))

import { CatalogoItemView } from "@/components/catalogo-public/catalogo-item-view"

const variantes = [
  { id: "v1", etiqueta: "128GB", sku: null, precio: 1000, stock: 5, imagen_url: null },
  { id: "v2", etiqueta: "256GB", sku: null, precio: 1500, stock: 3, imagen_url: null },
]

function makeData(overrides: Record<string, unknown> = {}) {
  return {
    config: { slug: "taller", titulo: "Taller", color_primary: "#2563eb", whatsapp: null },
    organizacion: { id: "o1", nombre: "Taller", nombre_mostrar: "Taller", logo_url: null, moneda: "ARS" },
    item: {
      id: "i1",
      tipo: "PRODUCTO" as const,
      nombre: "Celular",
      descripcion: null,
      categoria_id: null,
      precio: 1000,
      precio_hasta: 1500,
      precio_lista: null,
      imagen_url: null,
      imagenes: [],
      etiquetas: [],
      stock_disponible: 8,
      destacado: false,
      top_variante_id: null,
      variantes,
      ...overrides,
    },
    relacionados: [],
  }
}

describe("CatalogoItemView — variantes", () => {
  beforeEach(() => add.mockClear())

  it("no deja agregar al carrito hasta elegir una variante", () => {
    render(<CatalogoItemView data={makeData({ variantes, top_variante_id: null }) as never} />)
    const btn = screen.getByRole("button", { name: /agregar/i })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(add).not.toHaveBeenCalled()
  })

  it("agrega con varianteId, etiqueta y precio de la variante elegida", () => {
    render(<CatalogoItemView data={makeData() as never} />)
    fireEvent.click(screen.getByRole("button", { name: /256GB/ }))
    const btn = screen.getByRole("button", { name: /agregar/i })
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(add).toHaveBeenCalledTimes(1)
    const [line, qty] = add.mock.calls[0]
    expect(line).toMatchObject({
      id: "i1",
      precio: 1500,
      varianteId: "v2",
      varianteEtiqueta: "256GB",
      stock_disponible: 3,
    })
    expect(qty).toBe(1)
  })

  it("sin variantes sigue agregando directo, sin varianteId", () => {
    render(<CatalogoItemView data={makeData({ variantes: [], precio_hasta: null }) as never} />)
    fireEvent.click(screen.getByRole("button", { name: /agregar/i }))
    expect(add).toHaveBeenCalledTimes(1)
    expect(add.mock.calls[0][0].varianteId ?? null).toBeNull()
  })
})
