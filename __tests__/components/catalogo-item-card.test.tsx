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
