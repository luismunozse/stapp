// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { PosTerminal } from "@/components/pos/pos-terminal"
import type { HeldSale, InventarioResult, PosCartItem } from "@/components/pos/pos-types"
import { botonConfirmarListo } from "./checkout-test-utils"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1", role: "VENDEDOR" } } }),
}))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$ ${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`,
    pais: "AR",
    timezone: "America/Argentina/Buenos_Aires",
  }),
}))
const showError = vi.fn().mockResolvedValue(undefined)
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), showSuccess: vi.fn(), showError }),
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
vi.mock("@/contexts/offline-context", () => ({ useOffline: () => ({ isOnline: true }) }))

const useMonedaMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-moneda", () => ({ useMoneda: useMonedaMock }))

const USD_10: InventarioResult = { id: "u1", codigo: "U1", nombre: "Funda", stock: 5, precioVenta: 10, moneda: "USD" }

// El buscador real no importa acá: un botón que agrega el producto en USD.
vi.mock("@/components/pos/pos-product-search", async () => {
  const { forwardRef, useImperativeHandle } = await import("react")
  return {
    PosProductSearch: forwardRef((props: any, ref: any) => {
      useImperativeHandle(ref, () => ({ focusSearch: () => {}, openManual: () => {} }))
      return (
        <button type="button" data-testid="agregar-usd" onClick={() => props.onAddProduct(USD_10)}>
          agregar
        </button>
      )
    }),
  }
})
vi.mock("@/components/pos/pos-held-sales", () => ({
  PosHeldSales: (props: any) => (
    <button type="button" data-testid="recuperar" onClick={() => props.onRecall("h1")}>
      recuperar
    </button>
  ),
}))
vi.mock("@/components/pos/pos-venta-exito", () => ({ PosVentaExito: () => <div data-testid="exito" /> }))
vi.mock("@/components/pos/pos-devolucion-search", () => ({ PosDevolucionSearch: () => null }))
vi.mock("@/components/ventas/devolucion-form", () => ({ DevolucionForm: () => null }))
vi.mock("@/components/inventario/barcode-scanner", () => ({ BarcodeScanner: () => null }))

const CONFIG = {
  monedaLocal: "ARS",
  monedaExtranjera: "USD",
  habilitada: true,
  fuentesDisponibles: ["MANUAL", "OFICIAL", "BLUE", "MEP"],
  fuente: "BLUE",
  tipoCambioManual: null,
  tipoCambioReferencia: null,
  referenciaEn: null,
  redondeoConversion: 10,
  aceptaUsdEfectivo: false,
  vueltoMonedaDefault: "LOCAL",
}
function tcVivo(valor: number) {
  return { disponible: true, valor, fuente: "BLUE", moneda: "USD", en: new Date().toISOString(), estado: "vivo" }
}
function setMoneda(config: object, tipoCambio: object | undefined) {
  useMonedaMock.mockReturnValue({ config: { ...CONFIG, ...config }, tipoCambio })
}

type Respuesta = { status: number; body: unknown }
let ventasRespuestas: Respuesta[] = []
let monedasCheckStock: Record<string, string | null> = { u1: "USD" }
let barcodePendiente: Promise<void> | null = null
const CARGANDO = "Cargando la cotización, probá de nuevo en un instante."
let ventasBodies: any[] = []

function stubFetch() {
  ventasBodies = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
      if (url.startsWith("/api/configuracion/operativa")) {
        return json(200, { ivaRegimen: "EXENTO", ivaTasa: 0, redondeoEfectivo: 0, garantiaDiasDefault: 0 })
      }
      if (url.startsWith("/api/configuracion/recargos-metodo")) return json(200, { recargos: [] })
      if (url.startsWith("/api/operadores")) return json(200, [])
      if (url.startsWith("/api/inventario/check-stock")) {
        return json(200, { stock: { u1: 5 }, precios: { u1: 10 }, monedas: monedasCheckStock })
      }
      if (url.startsWith("/api/inventario/barcode")) {
        if (barcodePendiente) await barcodePendiente
        return json(200, { found: true, item: { ...USD_10, trackeaSeries: false, diasGarantiaDefault: null } })
      }
      if (url === "/api/ventas" && init?.method === "POST") {
        ventasBodies.push(JSON.parse(String(init.body)))
        const r = ventasRespuestas.shift() ?? { status: 201, body: { id: "v1", numeroVenta: 1, items: [], total: 0 } }
        return json(r.status, r.body)
      }
      return json(404, {})
    })
  )
}

function textoCarrito(): string {
  return screen.getAllByText(/Carrito/)[0].closest(".flex.flex-col.h-full")!.textContent ?? ""
}

async function agregarUsd() {
  fireEvent.click(screen.getAllByTestId("agregar-usd")[0])
}

describe("PosTerminal — productos con precio en divisa", () => {
  beforeEach(() => {
    showError.mockClear()
    ventasRespuestas = []
    monedasCheckStock = { u1: "USD" }
    barcodePendiente = null
    localStorage.clear()
    stubFetch()
  })

  it("una línea USD 10 con tc 1200 y redondeo 10 entra convertida: US$ 10 → $ 12.000", async () => {
    setMoneda({}, tcVivo(1200))
    render(<PosTerminal />)
    await agregarUsd()

    await waitFor(() => expect(textoCarrito()).toMatch(/US\$ 10 → \$ 12\.000 c\/u/))
    expect(textoCarrito()).toMatch(/TOTAL\$ 12\.000/)
    expect(showError).not.toHaveBeenCalled()
  })

  it("un producto en USD escaneado entra por el mismo camino, convertido", async () => {
    setMoneda({}, tcVivo(1200))
    render(<PosTerminal />)
    for (const ch of "779001") fireEvent.keyDown(document.body, { key: ch, code: `Digit${ch}` })
    fireEvent.keyDown(document.body, { key: "Enter", code: "Enter" })

    await waitFor(() => expect(textoCarrito()).toMatch(/US\$ 10 → \$ 12\.000 c\/u/))
  })

  it("con la función apagada no se agrega y se avisa por qué", async () => {
    setMoneda({ habilitada: false }, undefined)
    render(<PosTerminal />)
    await agregarUsd()

    await waitFor(() =>
      expect(showError).toHaveBeenCalledWith('"Funda" tiene precio en USD y la moneda extranjera está deshabilitada.')
    )
    expect(textoCarrito()).toMatch(/Carrito vacío/)
  })

  it("el precio de la línea se edita en la divisa y se reconvierte", async () => {
    setMoneda({}, tcVivo(1200))
    render(<PosTerminal />)
    await agregarUsd()
    await waitFor(() => expect(textoCarrito()).toMatch(/US\$ 10/))

    fireEvent.click(screen.getAllByRole("button", { name: /editar/i })[0])
    const input = screen.getAllByLabelText("Precio unitario en USD")[0]
    fireEvent.change(input, { target: { value: "12" } })

    await waitFor(() => expect(textoCarrito()).toMatch(/TOTAL\$ 14\.400/))
    expect(textoCarrito()).toMatch(/US\$ 12 → \$ 14\.400/)
  })

  it("409 COTIZACION_CAMBIO: reconvierte, avisa, deja el diálogo abierto y reintenta con la nueva y la misma clave", async () => {
    setMoneda({}, tcVivo(1200))
    ventasRespuestas = [
      {
        status: 409,
        body: {
          error: "La cotización cambió de $ 1.200,00 a $ 1.300,00. Revisá el total y confirmá de nuevo.",
          code: "COTIZACION_CAMBIO",
          anterior: 1200,
          nueva: tcVivo(1300),
        },
      },
    ]
    render(<PosTerminal />)
    await agregarUsd()
    await waitFor(() => expect(textoCarrito()).toMatch(/TOTAL\$ 12\.000/))

    const cobrar = screen.getAllByRole("button", { name: /cobrar \(f8\)/i })[0]
    await waitFor(() => expect(cobrar).toBeEnabled())
    fireEvent.click(cobrar)

    fireEvent.click(await botonConfirmarListo())
    await waitFor(() => expect(showError).toHaveBeenCalledWith(expect.stringMatching(/La cotización cambió/)))
    expect(ventasBodies[0].tipoCambio).toBe(1200)

    const dialogo = screen.getByRole("dialog")
    await waitFor(() => expect(within(dialogo).getByText("$ 13.000", { selector: "span" })).toBeInTheDocument())

    fireEvent.click(await botonConfirmarListo())
    await waitFor(() => expect(ventasBodies).toHaveLength(2))
    expect(ventasBodies[1].tipoCambio).toBe(1300)
    expect(ventasBodies[1].idempotencyKey).toBe(ventasBodies[0].idempotencyKey)
    expect(ventasBodies[1].items[0]).toMatchObject({ precioOrigen: 10, precioUnitario: 13000 })
  })

  it("409 DIVISA_NO_DISPONIBLE: avisa y el diálogo queda abierto", async () => {
    setMoneda({}, tcVivo(1200))
    ventasRespuestas = [
      {
        status: 409,
        body: { error: "No hay cotización de USD disponible para vender \"Funda\".", code: "DIVISA_NO_DISPONIBLE", motivo: "SIN_COTIZACION" },
      },
    ]
    render(<PosTerminal />)
    await agregarUsd()
    const cobrar = screen.getAllByRole("button", { name: /cobrar \(f8\)/i })[0]
    await waitFor(() => expect(cobrar).toBeEnabled())
    fireEvent.click(cobrar)
    fireEvent.click(await botonConfirmarListo())

    await waitFor(() => expect(showError).toHaveBeenCalledWith(expect.stringMatching(/No hay cotización de USD/)))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.queryByTestId("exito")).not.toBeInTheDocument()
  })

  it("mientras carga la configuración de moneda no agrega y pide reintentar", async () => {
    useMonedaMock.mockReturnValue({ config: undefined, tipoCambio: undefined, error: undefined })
    render(<PosTerminal />)
    await agregarUsd()

    await waitFor(() => expect(showError).toHaveBeenCalledWith(CARGANDO))
    expect(textoCarrito()).toMatch(/Carrito vacío/)
  })

  it("si la configuración de moneda no cargó, agregar se trata como deshabilitada", async () => {
    useMonedaMock.mockReturnValue({ config: undefined, tipoCambio: undefined, error: new Error("500") })
    render(<PosTerminal />)
    await agregarUsd()

    await waitFor(() =>
      expect(showError).toHaveBeenCalledWith('"Funda" tiene precio en USD y la moneda extranjera está deshabilitada.')
    )
  })

  it("con la función habilitada y la cotización todavía en camino no agrega y pide reintentar", async () => {
    useMonedaMock.mockReturnValue({ config: CONFIG, tipoCambio: undefined, error: undefined, tipoCambioError: undefined })
    render(<PosTerminal />)
    await agregarUsd()

    await waitFor(() => expect(showError).toHaveBeenCalledWith(CARGANDO))
    expect(textoCarrito()).toMatch(/Carrito vacío/)
  })

  it("si la cotización no se pudo pedir, agregar avisa que no hay cotización (no queda cargando)", async () => {
    useMonedaMock.mockReturnValue({ config: CONFIG, tipoCambio: undefined, error: undefined, tipoCambioError: new Error("500") })
    render(<PosTerminal />)
    await agregarUsd()

    await waitFor(() => expect(showError).toHaveBeenCalledWith(expect.stringMatching(/^No hay cotización de USD disponible para vender "Funda"/)))
    expect(showError).not.toHaveBeenCalledWith(CARGANDO)
  })

  it("una línea escaneada usa la cotización vigente cuando llega la respuesta, no la del momento del escaneo", async () => {
    let soltar: () => void = () => {}
    barcodePendiente = new Promise<void>((r) => { soltar = r })
    setMoneda({}, tcVivo(1200))
    const { rerender } = render(<PosTerminal />)
    for (const ch of "779001") fireEvent.keyDown(document.body, { key: ch, code: `Digit${ch}` })
    fireEvent.keyDown(document.body, { key: "Enter", code: "Enter" })

    setMoneda({}, tcVivo(1300))
    rerender(<PosTerminal />)
    soltar()

    await waitFor(() => expect(textoCarrito()).toMatch(/US\$ 10 → \$ 13\.000 c\/u/))
  })

  describe("venta apartada", () => {
    const lineaUsd: PosCartItem = {
      lineId: "l1", inventarioId: "u1", codigo: "U1", nombre: "Funda",
      precioUnitario: 12000, cantidad: 1, stockDisponible: 5, diasGarantia: 0,
      trackeaSeries: false, serieIds: [], moneda: "USD", precioOrigen: 10,
    }
    const lineaLocal: PosCartItem = {
      lineId: "l2", inventarioId: null, codigo: "", nombre: "Mano de obra",
      precioUnitario: 500, cantidad: 1, stockDisponible: 999, diasGarantia: 0,
      trackeaSeries: false, serieIds: [],
    }
    function apartar(items: PosCartItem[]) {
      const held: HeldSale = {
        id: "h1", timestamp: Date.now(), cliente: { id: null, nombre: "", telefono: "" }, items, nota: "",
      }
      localStorage.setItem("pos_held_sales", JSON.stringify([held]))
    }

    it("se reconvierte con la cotización en uso", async () => {
      apartar([lineaUsd])
      setMoneda({}, tcVivo(1300))
      render(<PosTerminal />)

      fireEvent.click(screen.getByTestId("recuperar"))

      await waitFor(() => expect(textoCarrito()).toMatch(/TOTAL\$ 13\.000/))
      expect(textoCarrito()).toMatch(/US\$ 10 → \$ 13\.000/)
    })

    it("con la función apagada la línea en divisa se quita y se avisa; la local queda", async () => {
      apartar([lineaUsd, lineaLocal])
      setMoneda({ habilitada: false }, undefined)
      render(<PosTerminal />)

      fireEvent.click(screen.getByTestId("recuperar"))

      await waitFor(() =>
        expect(showError).toHaveBeenCalledWith(
          expect.stringContaining('"Funda" tiene precio en USD y la moneda extranjera está deshabilitada.')
        )
      )
      expect(textoCarrito()).toMatch(/Mano de obra/)
      expect(textoCarrito()).not.toMatch(/Funda/)
      expect(textoCarrito()).toMatch(/TOTAL\$ 500/)
    })

    it("mientras carga la configuración de moneda no se recupera ni se pierde la línea en divisa", async () => {
      apartar([lineaUsd, lineaLocal])
      useMonedaMock.mockReturnValue({ config: undefined, tipoCambio: undefined, error: undefined })
      render(<PosTerminal />)

      fireEvent.click(screen.getByTestId("recuperar"))

      await waitFor(() => expect(showError).toHaveBeenCalledWith(CARGANDO))
      expect(textoCarrito()).toMatch(/Carrito vacío/)
      expect(JSON.parse(localStorage.getItem("pos_held_sales")!)[0].items).toHaveLength(2)
    })

    it("con la cotización todavía en camino no se recupera y la apartada queda", async () => {
      apartar([lineaUsd, lineaLocal])
      useMonedaMock.mockReturnValue({ config: CONFIG, tipoCambio: undefined, error: undefined, tipoCambioError: undefined })
      render(<PosTerminal />)

      fireEvent.click(screen.getByTestId("recuperar"))

      await waitFor(() => expect(showError).toHaveBeenCalledWith(CARGANDO))
      expect(textoCarrito()).toMatch(/Carrito vacío/)
      expect(JSON.parse(localStorage.getItem("pos_held_sales")!)[0].items).toHaveLength(2)
    })

    it("si la configuración de moneda no cargó, tampoco se recupera (la apartada queda)", async () => {
      apartar([lineaUsd])
      useMonedaMock.mockReturnValue({ config: undefined, tipoCambio: undefined, error: new Error("500") })
      render(<PosTerminal />)

      fireEvent.click(screen.getByTestId("recuperar"))

      await waitFor(() => expect(showError).toHaveBeenCalledWith(CARGANDO))
      expect(textoCarrito()).toMatch(/Carrito vacío/)
      expect(JSON.parse(localStorage.getItem("pos_held_sales")!)).toHaveLength(1)
    })

    it("si el producto cambió de moneda, el aviso pide quitarla y volver a agregarla", async () => {
      apartar([lineaUsd])
      monedasCheckStock = { u1: null }
      setMoneda({}, tcVivo(1200))
      render(<PosTerminal />)

      fireEvent.click(screen.getByTestId("recuperar"))

      await waitFor(() =>
        expect(showError).toHaveBeenCalledWith(
          expect.stringContaining("Funda: ahora tiene precio en moneda local (en la venta apartada: USD). Quitala y volvé a agregarla.")
        )
      )
    })

    it("avisa si el precio de lista en divisa cambió desde que se apartó", async () => {
      apartar([{ ...lineaUsd, precioOrigen: 9 }])
      setMoneda({}, tcVivo(1200))
      render(<PosTerminal />)

      fireEvent.click(screen.getByTestId("recuperar"))

      await waitFor(() =>
        expect(showError).toHaveBeenCalledWith(expect.stringMatching(/Funda: precio de lista actual US\$ 10 \(en la venta apartada: US\$ 9\)/))
      )
    })
  })

  it("con la función apagada y sin líneas en divisa no hay chip de cotización", async () => {
    setMoneda({ habilitada: false }, undefined)
    render(<PosTerminal />)
    await waitFor(() => expect(screen.getAllByRole("button", { name: /cobrar \(f8\)/i })[0]).toBeInTheDocument())
    expect(screen.queryByText(/USD Blue/)).not.toBeInTheDocument()
  })

  it("con la función habilitada el chip va arriba del carrito", async () => {
    setMoneda({}, tcVivo(1200))
    render(<PosTerminal />)
    await waitFor(() => expect(screen.getAllByText(/USD Blue · /).length).toBeGreaterThan(0))
  })
})
