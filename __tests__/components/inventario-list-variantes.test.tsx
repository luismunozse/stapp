/**
 * PR11: the inventory side EXPOSES variants. The list passes `permiteVariantes` to the form (the only place
 * that does), shows the combination chip and the effective photo, never flags siblings as duplicates, offers
 * "Agrupar productos existentes como variantes" with 2+ selected, and no longer offers the legacy "Variantes" menu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { SWRConfig } from "swr"
import { InventarioList } from "@/components/inventario/inventario-list"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, formatDate: (d: string) => d, timezone: "America/Argentina/Buenos_Aires" }),
}))

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), showError: vi.fn(), showSuccess: vi.fn(), alert: vi.fn() }),
}))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({ tipos: [], loading: false }),
}))

vi.mock("@/components/inventario/inventario-stats", () => ({ InventarioStats: () => null }))
vi.mock("@/components/inventario/inventario-proveedor-stats", () => ({ InventarioProveedorStats: () => null }))

// Radix menus do not open in jsdom: the menu is always open here, so the row menus can be read.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <div role="menuitem" onClick={onClick}>
      {children}
    </div>
  ),
}))

// The form is mocked to capture what the list hands it.
const { propsForm } = vi.hoisted(() => ({ propsForm: [] as Record<string, any>[] }))
vi.mock("@/components/inventario/inventario-form", () => ({
  InventarioForm: (props: Record<string, any>) => {
    propsForm.push(props)
    return (
      <div data-testid="form" data-permite={String(props.permiteVariantes)} data-item={props.item?.id ?? ""} data-grupo={props.item?.grupoId ?? ""} />
    )
  },
}))

const { propsAgrupar } = vi.hoisted(() => ({ propsAgrupar: [] as Record<string, any>[] }))
vi.mock("@/components/inventario/agrupar-dialog", () => ({
  AgruparDialog: (props: Record<string, any>) => {
    propsAgrupar.push(props)
    return props.open ? <div data-testid="agrupar" data-ids={props.items.map((i: { id: string }) => i.id).join(",")} /> : null
  },
}))

const base = {
  descripcion: null,
  categoria: "Fundas",
  tipoDispositivo: "CELULAR",
  stock: 3,
  stockReservado: 0,
  stockMinimo: 1,
  precioCompra: 100,
  precioVenta: 300,
  imagenUrl: null,
  deletedAt: null,
  proveedor: null,
  ubicacion: null,
}

const ROJO = { ...base, id: "r1", codigo: "FX-ROJ", nombre: "Funda X - Rojo", grupoId: "g1", etiqueta: "Rojo", atributos: [{ opcion: "Color", valor: "Rojo" }], imagenUrl: "https://s.test/rojo.jpg" }
const AZUL = {
  ...base,
  id: "a1",
  codigo: "FX-AZU",
  nombre: "Funda X - Azul",
  grupoId: "g1",
  etiqueta: "Azul",
  atributos: [{ opcion: "Color", valor: "Azul" }],
  imagenRespaldo: { url: "https://s.test/rojo.jpg", etiqueta: "Rojo" },
}
const VERDE = { ...base, id: "v1", codigo: "FX-VER", nombre: "Funda X - Verde", grupoId: "g1", etiqueta: "Verde", atributos: [{ opcion: "Color", valor: "Verde" }] }
const SUELTO = { ...base, id: "s1", codigo: "CAR-1", nombre: "Cargador", categoria: "Cargadores", tieneVariantes: true }

let data: Record<string, unknown>[]

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const href = String(url)
      if (href.startsWith("/api/inventario?")) return Promise.resolve({ ok: true, json: async () => ({ data, total: data.length }) } as Response)
      if (href.startsWith("/api/proveedores")) return Promise.resolve({ ok: true, json: async () => [] } as Response)
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
    })
  )
}

function renderList() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <InventarioList allowImport={false} />
    </SWRConfig>
  )
}

// jsdom has no PointerEvent: Radix reads `button` from the pointerdown that opens a menu.
beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  localStorage.setItem("inventario-view-mode", "list")
  propsForm.length = 0
  propsAgrupar.length = 0
  data = [ROJO, AZUL, VERDE, SUELTO]
  stubFetch()
})

afterEach(() => {
  localStorage.clear()
})

const esperarLista = () => waitFor(() => expect(screen.getAllByText("Cargador").length).toBeGreaterThan(0))

describe("InventarioList: exposes variants (PR11)", () => {
  it("opens the product form with permiteVariantes={true}", async () => {
    renderList()
    await esperarLista()
    expect(screen.queryByTestId("form")).toBeNull()

    fireEvent.click(screen.getAllByText("Cargador")[0])

    expect(await screen.findByTestId("form")).toHaveAttribute("data-permite", "true")
    expect(propsForm.at(-1)?.permiteVariantes).toBe(true)
  })

  it("creating a new product also offers variants", async () => {
    renderList()
    await esperarLista()
    fireEvent.click(screen.getAllByRole("button", { name: /nuevo producto|agregar producto|nuevo/i })[0])
    expect(await screen.findByTestId("form")).toHaveAttribute("data-permite", "true")
    expect(screen.getByTestId("form")).toHaveAttribute("data-item", "")
  })

  it("a tap on a variant opens the form with THAT row, which carries its group", async () => {
    renderList()
    await esperarLista()
    fireEvent.click(screen.getAllByText("Funda X - Azul")[0])
    const form = await screen.findByTestId("form")
    expect(form).toHaveAttribute("data-item", "a1")
    expect(form).toHaveAttribute("data-grupo", "g1")
  })
})

describe("InventarioList: group chip and effective photo (G6: both trees are in the DOM)", () => {
  it("shows the combination chip on the table row AND the mobile card, and on no standalone product", async () => {
    renderList()
    await esperarLista()
    const chips = screen.getAllByTestId("chip-variante").map((c) => c.textContent)
    expect(chips.filter((t) => t === "Rojo")).toHaveLength(2)
    expect(chips.filter((t) => t === "Azul")).toHaveLength(2)
    expect(chips.filter((t) => t === "Verde")).toHaveLength(2)
    expect(chips).toHaveLength(6)
  })

  it("shows the chip on the grid card too", async () => {
    localStorage.setItem("inventario-view-mode", "grid")
    renderList()
    await esperarLista()
    expect(screen.getAllByTestId("chip-variante").map((c) => c.textContent).sort()).toEqual(["Azul", "Rojo", "Verde"])
  })

  it("own photo: plain image named after the product; no dimming, no caption", async () => {
    renderList()
    await esperarLista()
    const propias = screen.getAllByAltText("Funda X - Rojo")
    expect(propias).toHaveLength(2)
    for (const img of propias) {
      expect(img).toHaveAttribute("src", "https://s.test/rojo.jpg")
      expect(img.className).not.toContain("opacity-60")
    }
  })

  it("no own photo, a sibling's: the borrowed photo is dimmed and captioned 'Foto de Rojo' (not named after the product)", async () => {
    renderList()
    await esperarLista()
    expect(screen.queryAllByAltText("Funda X - Azul")).toHaveLength(0)
    const prestadas = Array.from(document.querySelectorAll<HTMLImageElement>('img[src="https://s.test/rojo.jpg"]')).filter((img) => img.className.includes("opacity-60"))
    expect(prestadas).toHaveLength(2)
    expect(screen.getAllByText("Foto de Rojo")).toHaveLength(2)
    for (const leyenda of screen.getAllByText("Foto de Rojo")) expect(leyenda.className).toContain("sr-only")
  })

  it("no photo anywhere: no image at all for Verde and for the standalone product", async () => {
    renderList()
    await esperarLista()
    // Rojo (own) x2 + Azul (borrowed) x2 are the only images.
    expect(document.querySelectorAll("img")).toHaveLength(4)
  })
})

describe("InventarioList: siblings are not duplicates", () => {
  it("two children of one group with the same name are NOT flagged", async () => {
    data = [{ ...ROJO, nombre: "Funda" }, { ...AZUL, nombre: "Funda" }, SUELTO]
    renderList()
    await esperarLista()
    expect(screen.queryAllByText("Duplicado")).toHaveLength(0)
  })

  it("control: two standalone products with the same name still are", async () => {
    data = [{ ...SUELTO, id: "s1" }, { ...SUELTO, id: "s2", codigo: "CAR-2" }]
    renderList()
    await esperarLista()
    expect(screen.queryAllByText("Duplicado").length).toBeGreaterThan(0)
  })
})

describe("InventarioList: legacy Variantes menu is gone", () => {
  it("a product flagged tieneVariantes no longer offers 'Variantes' in its row menu", async () => {
    renderList()
    await esperarLista()
    // The standalone product carries the legacy flag, so its menu used to list "Variantes".
    expect(screen.getAllByRole("menu").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Analytics").length).toBeGreaterThan(0)
    expect(screen.queryByText("Variantes")).toBeNull()
  })
})

describe("InventarioList: 'Agrupar productos existentes como variantes'", () => {
  const casillas = () => within(document.querySelector("table")!).getAllByRole("checkbox")
  const etiqueta = "Agrupar productos existentes como variantes"

  it("is offered only with 2 or more selected", async () => {
    renderList()
    await esperarLista()
    fireEvent.click(casillas()[4])
    expect(screen.queryByText(etiqueta)).toBeNull()
    fireEvent.click(casillas()[3])
    expect(screen.getByText(etiqueta)).toBeInTheDocument()
  })

  it("opens the dialog with exactly the selected products", async () => {
    renderList()
    await esperarLista()
    fireEvent.click(casillas()[4])
    fireEvent.click(casillas()[3])
    fireEvent.click(screen.getByText(etiqueta))
    expect((await screen.findByTestId("agrupar")).getAttribute("data-ids")?.split(",").sort()).toEqual(["s1", "v1"])
  })

  it("closing the dialog drops it, and a successful grouping clears the selection and reloads", async () => {
    renderList()
    await esperarLista()
    fireEvent.click(casillas()[4])
    fireEvent.click(casillas()[3])
    fireEvent.click(screen.getByText(etiqueta))
    await screen.findByTestId("agrupar")
    const llamadasAntes = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    propsAgrupar.at(-1)!.onAgrupado()
    await waitFor(() => expect(screen.queryByTestId("agrupar")).toBeNull())
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(llamadasAntes))
    expect(screen.queryByText(etiqueta)).toBeNull()
  })

  it("never appears in the grid view (the bulk bar is list only)", async () => {
    localStorage.setItem("inventario-view-mode", "grid")
    renderList()
    await esperarLista()
    expect(screen.queryByText(etiqueta)).toBeNull()
  })
})

describe("InventarioList: per-child behavior is unchanged", () => {
  it("every child keeps its own row, stock and price", async () => {
    renderList()
    await esperarLista()
    for (const nombre of ["Funda X - Rojo", "Funda X - Azul", "Funda X - Verde"]) {
      expect(screen.getAllByText(nombre).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText("$300").length).toBeGreaterThanOrEqual(4)
  })
})
