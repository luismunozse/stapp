// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within, waitFor, act } from "@testing-library/react"

const modal = vi.hoisted(() => ({ showError: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/contexts/modal-context", () => ({ useModal: () => modal }))
vi.mock("@/contexts/currency-context", () => ({ useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from "sonner"
import { NotaCreditoVentaDialog, type VentaParaNotaCredito } from "@/components/notas-credito/nota-credito-venta-dialog"

const items: VentaParaNotaCredito["items"] = [
  { id: "iv1", inventarioId: "inv1", descripcion: "Teclado", cantidad: 1, precioUnitario: 200 },
  { id: "iv2", inventarioId: "inv2", descripcion: "Mouse", cantidad: 2, precioUnitario: 50 },
]

const ventaBase = (over: Partial<VentaParaNotaCredito> = {}): VentaParaNotaCredito => ({
  id: "v1", numeroVenta: 7, sucursalId: "suc-1", total: 300, clienteId: "c1",
  saldoPendiente: 0, devoluciones: [], items, ...over,
})

function abrir(venta: VentaParaNotaCredito = ventaBase()) {
  const onEmitida = vi.fn()
  render(<NotaCreditoVentaDialog open onOpenChange={vi.fn()} venta={venta} onEmitida={onEmitida} />)
  return onEmitida
}

const fila = (etiqueta: string) => screen.getByText(etiqueta).closest("div") as HTMLElement
const cargar = (etiqueta: string, value: string) =>
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value } })
const emitirBtn = () => screen.getByRole("button", { name: "Emitir nota de crédito" })
const opciones = (etiqueta: string) =>
  within(screen.getByLabelText(etiqueta)).getAllByRole("option").map((o) => o.getAttribute("value"))

function stubFetch(caja: { sesion: unknown } = { sesion: { id: "ses-1" } }, nc: { ok: boolean; body: unknown } = { ok: true, body: { id: "d9", numeroDevolucion: "NC-000009" } }) {
  const fetchMock = vi.fn(async (url: string) =>
    url.startsWith("/api/caja/")
      ? { ok: true, json: async () => caja }
      : { ok: nc.ok, json: async () => nc.body }
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const bodyEnviado = (fetchMock: ReturnType<typeof stubFetch>) => {
  const llamada = fetchMock.mock.calls.find(([u]) => u === "/api/ventas/v1/devolucion") as unknown as [string, RequestInit]
  return JSON.parse(String(llamada[1].body))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe("NotaCreditoVentaDialog — devolver productos", () => {
  it("descuenta primero lo que el cliente debe y devuelve solo el resto", () => {
    abrir(ventaBase({ saldoPendiente: 150 }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Devolver Teclado" }))
    expect(fila("Se acredita")).toHaveTextContent("$200")
    expect(fila("Baja la deuda de la venta")).toHaveTextContent("$150")
    expect(fila("Se le devuelve")).toHaveTextContent("$50")
    expect(fila("Saldo pendiente después")).toHaveTextContent("$0")
  })

  it("acredita lo que el cliente pagó, no el precio de lista (descuento de línea)", () => {
    abrir(ventaBase({
      total: 900,
      items: [{ id: "iv1", inventarioId: null, descripcion: "Funda", cantidad: 10, precioUnitario: 100, tipoDescuento: "PORCENTAJE", porcentajeDescuento: 10 }],
    }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Devolver Funda" }))
    expect(fila("Se acredita")).toHaveTextContent("$900")
  })

  it("no ofrece lo ya devuelto y limita la cantidad a lo que queda", () => {
    abrir(ventaBase({ devoluciones: [{ montoDevolucion: 250, items: [{ itemVentaId: "iv1", cantidad: 1 }, { itemVentaId: "iv2", cantidad: 1 }] }] }))
    expect(screen.getByRole("checkbox", { name: "Devolver Teclado" })).toBeDisabled()
    fireEvent.click(screen.getByRole("checkbox", { name: "Devolver Mouse" }))
    expect(screen.getByText("Máximo: 1")).toBeInTheDocument()
  })

  it("una NC anulada no cuenta como devuelta ni como acreditada", () => {
    abrir(ventaBase({ devoluciones: [{ montoDevolucion: 200, anulada: true, items: [{ itemVentaId: "iv1", cantidad: 1 }] }] }))
    expect(screen.getByRole("checkbox", { name: "Devolver Teclado" })).not.toBeDisabled()
    expect(screen.getByText("Disponible para acreditar: $300")).toBeInTheDocument()
  })

  it("sin productos elegidos no deja emitir y dice por qué", () => {
    abrir()
    expect(screen.getByText("Elegí al menos un producto.")).toBeInTheDocument()
    expect(emitirBtn()).toBeDisabled()
  })
})

describe("NotaCreditoVentaDialog — por monto", () => {
  it("reparte como el ejemplo del spec: $50 sobre $40 de deuda baja la deuda y devuelve $10", () => {
    abrir(ventaBase({ total: 100, saldoPendiente: 40, items: [] }))
    // Sin productos para devolver arranca por monto
    expect(screen.getByRole("button", { name: "Por monto" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Devolver productos" })).toBeDisabled()
    cargar("Monto a acreditar", "50")
    expect(fila("Baja la deuda de la venta")).toHaveTextContent("$40")
    expect(fila("Se le devuelve")).toHaveTextContent("$10")
    expect(fila("Saldo pendiente después")).toHaveTextContent("$0")
  })

  it("no deja acreditar más de lo disponible (lo facturado menos las NC anteriores)", () => {
    abrir(ventaBase({ total: 100, devoluciones: [{ montoDevolucion: 30, items: [] }], items: [] }))
    expect(screen.getByText("Disponible para acreditar: $70")).toBeInTheDocument()
    cargar("Monto a acreditar", "70.01")
    expect(screen.getByText("El monto no puede superar $70.")).toBeInTheDocument()
    expect(emitirBtn()).toBeDisabled()
  })

  it("pasar de productos a monto deja el motivo para elegir, y en una venta no ofrece 'Trabajo no realizado'", () => {
    abrir()
    fireEvent.click(screen.getByRole("button", { name: "Por monto" }))
    cargar("Monto a acreditar", "20")
    expect(screen.getByText("Elegí el motivo.")).toBeInTheDocument()
    expect(opciones("Motivo")).toContain("AJUSTE_PRECIO")
    expect(opciones("Motivo")).not.toContain("TRABAJO_NO_REALIZADO")
  })

  it("venta fiada: si todo baja la deuda no pregunta cómo se devuelve", () => {
    abrir(ventaBase({ total: 100, saldoPendiente: 100, items: [] }))
    cargar("Monto a acreditar", "50")
    expect(screen.queryByLabelText("Cómo se le devuelve")).not.toBeInTheDocument()
    expect(screen.queryByText("Se le devuelve")).not.toBeInTheDocument()
  })

  it("con plata para devolver pide cómo (obligatorio), y sin cliente no ofrece cuenta corriente", () => {
    abrir(ventaBase({ clienteId: null, items: [] }))
    cargar("Monto a acreditar", "20")
    cargar("Motivo", "AJUSTE_PRECIO")
    expect(screen.getByText("Elegí cómo se le devuelve la plata.")).toBeInTheDocument()
    expect(emitirBtn()).toBeDisabled()
    expect(opciones("Cómo se le devuelve")).toEqual(["", "EFECTIVO", "TRANSFERENCIA", "TARJETA", "OTRO"])
  })

  it("con cliente ofrece el saldo a favor en cuenta corriente", () => {
    abrir(ventaBase({ items: [] }))
    cargar("Monto a acreditar", "20")
    expect(opciones("Cómo se le devuelve")).toContain("CUENTA_CORRIENTE")
  })

  it("venta ya acreditada entera: lo dice y no deja emitir", () => {
    abrir(ventaBase({ total: 100, devoluciones: [{ montoDevolucion: 100, items: [] }], items: [] }))
    expect(screen.getByText("Esta venta ya no tiene saldo para acreditar.")).toBeInTheDocument()
    expect(emitirBtn()).toBeDisabled()
  })
})

describe("NotaCreditoVentaDialog — caja", () => {
  it("efectivo sin caja abierta en la sucursal de la venta: avisa antes de emitir", async () => {
    const fetchMock = stubFetch({ sesion: null })
    abrir(ventaBase({ items: [] }))
    cargar("Monto a acreditar", "20")
    cargar("Motivo", "AJUSTE_PRECIO")
    cargar("Cómo se le devuelve", "EFECTIVO")
    expect(await screen.findByText(/no entra en ningún arqueo/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith("/api/caja/sesiones?current=true&sucursalId=suc-1")
  })

  it("con caja abierta no avisa", async () => {
    const fetchMock = stubFetch({ sesion: { id: "ses-1" } })
    abrir(ventaBase({ items: [] }))
    cargar("Monto a acreditar", "20")
    cargar("Cómo se le devuelve", "EFECTIVO")
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(screen.queryByText(/no entra en ningún arqueo/)).not.toBeInTheDocument()
  })

  it("por transferencia no consulta la caja", () => {
    const fetchMock = stubFetch()
    abrir(ventaBase({ items: [] }))
    cargar("Monto a acreditar", "20")
    cargar("Cómo se le devuelve", "TRANSFERENCIA")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("NotaCreditoVentaDialog — emitir", () => {
  it("manda la NC por monto y avisa con el número", async () => {
    const fetchMock = stubFetch()
    const onEmitida = abrir(ventaBase({ items: [] }))
    cargar("Monto a acreditar", "20")
    cargar("Motivo", "AJUSTE_PRECIO")
    cargar("Detalle (opcional)", "Precio de lista viejo")
    cargar("Cómo se le devuelve", "EFECTIVO")
    fireEvent.click(emitirBtn())

    await waitFor(() => expect(onEmitida).toHaveBeenCalledWith({ id: "d9", numero: "NC-000009" }))
    expect(bodyEnviado(fetchMock)).toEqual({
      modo: "MONTO", motivoNc: "AJUSTE_PRECIO", motivo: "Precio de lista viejo", monto: 20,
      metodoReembolso: "EFECTIVO", idempotencyKey: expect.any(String),
    })
    expect(toast.success).toHaveBeenCalledWith("Nota de crédito NC-000009 emitida")
  })

  it("por productos manda las líneas, y si todo baja la deuda no manda medio", async () => {
    const fetchMock = stubFetch()
    abrir(ventaBase({ saldoPendiente: 300 }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Devolver Teclado" }))
    fireEvent.click(emitirBtn())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(bodyEnviado(fetchMock)).toEqual({
      modo: "ITEMS", motivoNc: "DEVOLUCION", idempotencyKey: expect.any(String),
      items: [{ itemVentaId: "iv1", cantidad: 1, precioUnitario: 200, restaurarStock: true }],
    })
  })

  it("doble click emite una sola NC con clave de idempotencia", async () => {
    let resolver: (v: unknown) => void = () => {}
    const fetchMock = vi.fn(() => new Promise((r) => { resolver = r }))
    vi.stubGlobal("fetch", fetchMock)
    const onEmitida = abrir(ventaBase({ saldoPendiente: 300 }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Devolver Teclado" }))
    // Los dos clicks caen antes de que React repinte: solo la ref los frena.
    const b = emitirBtn()
    act(() => {
      b.click()
      b.click()
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    resolver({ ok: true, json: async () => ({ id: "d1", numeroDevolucion: "NC-000001" }) })
    await waitFor(() => expect(onEmitida).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("si el servidor rechaza, muestra su motivo y no da la NC por emitida", async () => {
    stubFetch({ sesion: { id: "ses-1" } }, { ok: false, body: { error: "La venta ya no tiene saldo para acreditar" } })
    const onEmitida = abrir(ventaBase({ items: [] }))
    cargar("Monto a acreditar", "20")
    cargar("Motivo", "AJUSTE_PRECIO")
    cargar("Cómo se le devuelve", "TRANSFERENCIA")
    fireEvent.click(emitirBtn())

    await waitFor(() => expect(modal.showError).toHaveBeenCalledWith("La venta ya no tiene saldo para acreditar"))
    expect(onEmitida).not.toHaveBeenCalled()
  })
})
