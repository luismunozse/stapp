// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { PosTerminal } from "@/components/pos/pos-terminal"

// POS variants: the grouped card, the bottom sheet, the flat mode and the cart. The real search and
// sheet run inside the real terminal; only the cart is replaced by a <pre> that exposes its items,
// so what a tap puts in the cart (id, price, ticket name, quantity) can be read back.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1", role: "VENDEDOR" } } }),
}))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, pais: "AR", timezone: "America/Argentina/Buenos_Aires" }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), showSuccess: vi.fn(), showError: vi.fn().mockResolvedValue(undefined) }),
}))
vi.mock("@/contexts/offline-context", () => ({ useOffline: () => ({ isOnline: true }) }))
vi.mock("@/components/pos/pos-cart", () => ({
  PosCart: (props: any) => <pre data-testid="cart">{JSON.stringify(props.items)}</pre>,
}))
vi.mock("@/components/pos/pos-checkout-dialog", () => ({ PosCheckoutDialog: () => null }))
vi.mock("@/components/pos/pos-held-sales", () => ({ PosHeldSales: () => null }))
vi.mock("@/components/pos/pos-ticket-share", () => ({ PosTicketShare: () => null }))
vi.mock("@/components/pos/pos-devolucion-search", () => ({ PosDevolucionSearch: () => null }))
vi.mock("@/components/ventas/devolucion-form", () => ({ DevolucionForm: () => null }))
vi.mock("@/components/inventario/barcode-scanner", () => ({ BarcodeScanner: () => null }))

const hijo = (id: string, etiqueta: string, precioVenta: number, stock: number, extra: Record<string, unknown> = {}) => ({
  id,
  codigo: `FX-${id}`,
  nombre: `Funda X - ${etiqueta}`,
  stock,
  stockReservado: 0,
  precioVenta,
  grupoId: "g-1",
  etiqueta,
  atributos: [{ opcion: "Color", valor: etiqueta }],
  grupoNombre: "Funda X",
  imagenUrl: null,
  ...extra,
})
const ROJO = hijo("rojo", "Rojo", 10000, 5, { imagenUrl: "https://img.test/rojo.jpg" })
const AZUL = hijo("azul", "Azul", 12000, 4)
const VERDE = hijo("verde", "Verde", 11000, 0, { imagenRespaldo: { url: "https://img.test/rojo.jpg", etiqueta: "Rojo" } })
const NEGRO = hijo("negro", "Negro", 13000, 2)
const PANTALLA = { id: "pantalla", codigo: "PAN-1", nombre: "Pantalla", stock: 7, stockReservado: 0, precioVenta: 50000 }
const CATALOGO = [ROJO, AZUL, PANTALLA, VERDE, NEGRO]

interface Opciones {
  config?: "ok-agrupado" | "ok-plano" | "sin-campo" | "error"
  /** The first N requests for the group page fail with a 500. */
  grupoFalla?: number
}

function stubFetch({ config = "ok-agrupado", grupoFalla = 0 }: Opciones = {}) {
  const pedidos: string[] = []
  let fallosRestantes = grupoFalla
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      pedidos.push(url)
      if (url.startsWith("/api/configuracion/operativa")) {
        if (config === "error") return { ok: false, status: 500, json: async () => ({}) }
        const cuerpo = config === "sin-campo" ? {} : { posAgrupaVariantes: config === "ok-agrupado" }
        return { ok: true, status: 200, json: async () => cuerpo }
      }
      if (url.startsWith("/api/inventario/search")) {
        const params = new URL(url, "http://localhost").searchParams
        const grupoId = params.get("grupoId")
        if (grupoId && fallosRestantes-- > 0) return { ok: false, status: 500, json: async () => ({}), headers: new Headers() }
        const data = grupoId ? [ROJO, AZUL, VERDE, NEGRO].filter((r) => r.grupoId === grupoId) : CATALOGO
        return { ok: true, status: 200, json: async () => data, headers: new Headers() }
      }
      return { ok: false, status: 404, json: async () => ({}), headers: new Headers() }
    })
  )
  return pedidos
}

const carrito = (): any[] => JSON.parse(screen.getAllByTestId("cart")[0].textContent || "[]")
// The terminal mounts the search twice (desktop and mobile layouts): always act on the first.
const primera = (re: RegExp | string) => screen.getAllByText(re)[0]
const tarjetaDeGrupo = async () => (await screen.findAllByText(/4 variantes/))[0].closest("button") as HTMLButtonElement

describe("POS: grouped variants", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("draws one card for the four variants and keeps the standalone product as it was", async () => {
    stubFetch()
    render(<PosTerminal />)

    const tarjeta = await tarjetaDeGrupo()

    expect(within(tarjeta).getByText("Funda X")).toBeTruthy()
    expect(tarjeta.textContent).toContain("4 variantes · desde $10000")
    expect(primera("Pantalla")).toBeTruthy()
    // The child names never show up as cards of their own.
    expect(screen.queryAllByText("Funda X - Azul")).toHaveLength(0)
  })

  it("never draws an image in standalone or grouped cards", async () => {
    stubFetch()
    const { container } = render(<PosTerminal />)
    await tarjetaDeGrupo()

    expect(primera("Pantalla")).toBeTruthy()
    expect(container.querySelectorAll("img")).toHaveLength(0)
  })

  it("opens a sheet on tap and asks for the whole group in the selling deposito", async () => {
    const pedidos = stubFetch()
    render(<PosTerminal />)

    fireEvent.click(await tarjetaDeGrupo())

    await screen.findByRole("dialog")
    const url = pedidos.find((p) => p.includes("grupoId="))!
    const params = new URL(url, "http://localhost").searchParams
    expect(params.get("grupoId")).toBe("g-1")
    expect(params.get("scope")).toBe("venta")
    expect(params.get("includeZeroStock")).toBe("true")
    expect(params.get("limit")).toBe("100")
  })

  it("lists each variant with its label, price, stock and thumbnail, and disables the one without stock", async () => {
    stubFetch()
    render(<PosTerminal />)
    fireEvent.click(await tarjetaDeGrupo())

    const hoja = within(await screen.findByRole("dialog"))
    const filas = await hoja.findAllByRole("button", { name: /Rojo|Azul|Verde|Negro/ })

    expect(filas).toHaveLength(4)
    const rojo = filas.find((f) => f.textContent?.includes("Rojo"))!
    expect(rojo.textContent).toContain("$10000")
    expect(rojo.textContent).toContain("5")
    expect(rojo.querySelector("img")?.getAttribute("src")).toBe("https://img.test/rojo.jpg")
    const verde = filas.find((f) => f.textContent?.includes("Verde"))!
    expect(verde).toHaveProperty("disabled", true)
    expect(verde.textContent).toContain("Foto de Rojo")
    // Placeholder (no photo at all) for Azul: still a usable row.
    const azul = filas.find((f) => f.textContent?.includes("Azul"))!
    expect(azul.querySelector("img")).toBeNull()
    expect(azul).toHaveProperty("disabled", false)
    expect(rojo).toHaveProperty("disabled", false)
  })

  it("adds the CHILD at its own price; adding Azul twice makes one line of quantity 2 under Azul's id and full name", async () => {
    stubFetch()
    render(<PosTerminal />)

    for (let vez = 0; vez < 2; vez++) {
      fireEvent.click(await tarjetaDeGrupo())
      const hoja = within(await screen.findByRole("dialog"))
      fireEvent.click(await hoja.findByRole("button", { name: /Azul/ }))
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    }

    expect(carrito()).toHaveLength(1)
    expect(carrito()[0]).toMatchObject({
      inventarioId: "azul",
      nombre: "Funda X - Azul",
      precioUnitario: 12000,
      cantidad: 2,
    })
  })

  it("says so when the variants cannot be loaded and lets the cashier retry", async () => {
    const pedidos = stubFetch({ grupoFalla: 1 })
    render(<PosTerminal />)
    fireEvent.click(await tarjetaDeGrupo())

    const hoja = within(await screen.findByRole("dialog"))
    fireEvent.click(await hoja.findByRole("button", { name: "Reintentar" }))

    fireEvent.click(await hoja.findByRole("button", { name: /Negro/ }))
    await waitFor(() => expect(carrito()).toHaveLength(1))
    expect(carrito()[0]).toMatchObject({ inventarioId: "negro" })
    expect(pedidos.filter((p) => p.includes("grupoId="))).toHaveLength(2)
  })

  it("returns focus to the search input after picking a variant, so the cashier can keep scanning", async () => {
    stubFetch()
    render(<PosTerminal />)
    const buscador = screen.getAllByPlaceholderText(/Buscar producto/i)[0]

    fireEvent.click(await tarjetaDeGrupo())
    const hoja = within(await screen.findByRole("dialog"))
    fireEvent.click(await hoja.findByRole("button", { name: /^Rojo/ }))

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(buscador))
  })

  it("returns focus to the search input when the sheet is closed with Escape or Cerrar", async () => {
    stubFetch()
    render(<PosTerminal />)
    const buscador = screen.getAllByPlaceholderText(/Buscar producto/i)[0]

    fireEvent.click(await tarjetaDeGrupo())
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(buscador))

    ;(buscador as HTMLInputElement).blur()
    fireEvent.click(await tarjetaDeGrupo())
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cerrar" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(buscador))
    expect(carrito()).toHaveLength(0)
  })

  it("names a row without stock with 'Sin stock' so a screen reader hears why it is disabled", async () => {
    stubFetch()
    render(<PosTerminal />)
    fireEvent.click(await tarjetaDeGrupo())

    const hoja = within(await screen.findByRole("dialog"))
    const verde = await hoja.findByRole("button", { name: /Verde.*Sin stock|Sin stock.*Verde/ })

    expect(verde).toHaveProperty("disabled", true)
    expect(hoja.getAllByRole("button", { name: /Sin stock/ })).toHaveLength(1)
  })

  it("still adds the variant when its photo fails to load", async () => {
    stubFetch()
    render(<PosTerminal />)
    fireEvent.click(await tarjetaDeGrupo())
    const hoja = within(await screen.findByRole("dialog"))
    const rojo = await hoja.findByRole("button", { name: /^Rojo/ })
    const img = rojo.querySelector("img") as HTMLImageElement
    expect(img).not.toBeNull()

    fireEvent.error(img)
    fireEvent.click(rojo)

    await waitFor(() => expect(carrito()).toHaveLength(1))
    expect(carrito()[0]).toMatchObject({ inventarioId: "rojo", precioUnitario: 10000 })
  })
})

describe("POS: flat mode (the workshop decides)", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("shows four separate cards without images, and each tap adds its own child", async () => {
    stubFetch({ config: "ok-plano" })
    const { container } = render(<PosTerminal />)

    expect((await screen.findAllByText("Funda X - Azul")).length).toBeGreaterThan(0)
    expect(screen.queryAllByText(/variantes · desde/)).toHaveLength(0)
    expect(container.querySelectorAll("img")).toHaveLength(0)
    for (const nombre of ["Funda X - Rojo", "Funda X - Azul", "Funda X - Verde", "Funda X - Negro"]) {
      expect(primera(nombre)).toBeTruthy()
    }

    fireEvent.click(primera("Funda X - Azul").closest("button")!)

    await waitFor(() => expect(carrito()).toHaveLength(1))
    expect(carrito()[0]).toMatchObject({ inventarioId: "azul", nombre: "Funda X - Azul", precioUnitario: 12000 })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("groups when the preference is missing from the answer", async () => {
    stubFetch({ config: "sin-campo" })
    render(<PosTerminal />)
    expect((await screen.findAllByText(/4 variantes/)).length).toBeGreaterThan(0)
  })

  it("stays grouped and usable when the configuration cannot be read", async () => {
    stubFetch({ config: "error" })
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(<PosTerminal />)

    fireEvent.click(await tarjetaDeGrupo())
    const hoja = within(await screen.findByRole("dialog"))
    fireEvent.click(await hoja.findByRole("button", { name: /Negro/ }))

    await waitFor(() => expect(carrito()).toHaveLength(1))
    expect(carrito()[0]).toMatchObject({ inventarioId: "negro", precioUnitario: 13000 })
  })
})
