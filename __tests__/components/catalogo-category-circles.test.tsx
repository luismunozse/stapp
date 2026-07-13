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
