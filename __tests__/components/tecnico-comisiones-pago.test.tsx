import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

const { data, mutate, confirm, swrError, swrKeys } = vi.hoisted(() => ({
  swrKeys: [] as string[],
  data: { value: null as any },
  mutate: vi.fn(),
  confirm: vi.fn(),
  swrError: { value: undefined as any },
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("swr", () => ({
  default: (key: string | null) => {
    if (key) swrKeys.push(key)
    return {
    data: key?.startsWith("/api/comisiones?") ? data.value : undefined,
    error: key?.startsWith("/api/comisiones?") ? swrError.value : undefined,
    isLoading: false,
    mutate,
    }
  },
}))
vi.mock("@/contexts/modal-context", () => ({ useModal: () => ({ confirm }) }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (d: string) => `fmt(${d})`,
  }),
}))

import { toast } from "sonner"
import { TecnicoComisiones } from "@/components/tecnicos/tecnico-comisiones"

function item(over: Record<string, unknown> = {}) {
  return {
    clave: "k",
    ordenId: "o1",
    tecnicoId: "t1",
    tecnicoNombre: "Ana",
    rol: "TECNICO",
    tipo: "ORIGINAL",
    pagoId: null,
    codigoOrden: "OR-1",
    numeroOrden: 1,
    dispositivo: "Equipo",
    estado: "ENTREGADO",
    fechaCompletado: null,
    costoFinal: 0,
    costoRepuestos: 0,
    ganancia: 0,
    porcentajeComision: 10,
    montoComision: 0,
    comisionPagada: false,
    fechaPagoComision: null,
    ...over,
  }
}

const renderScreen = (readOnly = false) =>
  render(<TecnicoComisiones tecnicoId="tec-9" tecnicoNombre="Ana" readOnly={readOnly} />)

describe("TecnicoComisiones paying and annulling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirm.mockResolvedValue(true)
    swrError.value = undefined
  })

  it("posts beneficiarioId = tecnicoId with the displayed amounts", async () => {
    data.value = {
      items: [
        item({ clave: "a", codigoOrden: "a", montoComision: 100 }),
        item({ clave: "b", codigoOrden: "b", ordenId: "o2", montoComision: 50 }),
      ],
      resumen: [],
    }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pagoId: "p1" }) }) as any
    renderScreen()
    fireEvent.click(screen.getByLabelText("Seleccionar comisión a"))
    fireEvent.click(screen.getByLabelText("Seleccionar comisión b"))
    fireEvent.click(screen.getByRole("button", { name: /Liquidar seleccionadas/ }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, init] = (global.fetch as any).mock.calls[0]
    expect(url).toBe("/api/comisiones/pagar")
    expect(JSON.parse(init.body)).toEqual({
      beneficiarioId: "tec-9",
      filas: [{ clave: "a", monto: 100 }, { clave: "b", monto: 50 }],
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Comisiones liquidadas"))
  })

  it("readOnly hides the selection controls and the annul control", () => {
    data.value = {
      items: [
        item({ clave: "a", codigoOrden: "a", montoComision: 100 }),
        item({ clave: "p", codigoOrden: "p", ordenId: "o3", montoComision: 40, comisionPagada: true, pagoId: "p9", fechaPagoComision: "2026-10-20T12:00:00Z" }),
      ],
      resumen: [],
    }
    renderScreen(true)
    expect(screen.getByText("Pagada")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Pagada/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  })

  it("without readOnly a paid row opens the annul dialog", async () => {
    data.value = {
      items: [item({ clave: "p", codigoOrden: "p", montoComision: 40, comisionPagada: true, pagoId: "p9", fechaPagoComision: "2026-10-20T12:00:00Z" })],
      resumen: [],
    }
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as any
    renderScreen()
    fireEvent.click(screen.getByRole("button", { name: /Pagada/ }))
    expect(await screen.findByText("Anular pago", { selector: "h2" })).toBeInTheDocument()
  })

  it("lists a zero-amount row but cannot select it, and never posts it", async () => {
    data.value = {
      items: [
        item({ clave: "a", codigoOrden: "a", montoComision: 100 }),
        item({ clave: "z", codigoOrden: "z", ordenId: "o3", montoComision: 0 }),
      ],
      resumen: [],
    }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pagoId: "p1" }) }) as any
    renderScreen()
    expect(screen.getByText("z")).toBeInTheDocument()
    expect(screen.getByLabelText("Seleccionar comisión z")).toBeDisabled()
    // The header select-all is the only checkbox without an aria-label
    const selectAll = screen.getAllByRole("checkbox").find((c) => !c.getAttribute("aria-label"))!
    fireEvent.click(selectAll)
    fireEvent.click(screen.getByRole("button", { name: /Liquidar seleccionadas/ }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({
      beneficiarioId: "tec-9",
      filas: [{ clave: "a", monto: 100 }],
    })
  })

  it("says plainly when the selected total is negative", async () => {
    data.value = { items: [item({ clave: "n", codigoOrden: "n", tipo: "AJUSTE_DEVOLUCION", montoComision: -30 })], resumen: [] }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pagoId: "p1" }) }) as any
    renderScreen()
    fireEvent.click(screen.getByLabelText(/Seleccionar comisión n/))
    fireEvent.click(screen.getByRole("button", { name: /Liquidar seleccionadas/ }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(confirm.mock.calls[0][0].description).toBe(
      "El total es negativo ($-30): se registra como descuento a favor del taller. ¿Confirmás?"
    )
  })

  it("shows an error line, not an empty state, when the read fails", () => {
    data.value = undefined
    swrError.value = new Error("boom")
    renderScreen()
    expect(screen.getByText("No se pudieron cargar las comisiones.")).toBeInTheDocument()
    expect(screen.queryByText("Sin órdenes")).not.toBeInTheDocument()
    expect(screen.queryByText("Comisión pendiente")).not.toBeInTheDocument()
  })
})

describe("TecnicoComisiones order roles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirm.mockResolvedValue(true)
    swrError.value = undefined
    swrKeys.length = 0
  })

  const pair = () => [
    item({ clave: "ORDEN:o1:TECNICO:ORIGINAL:-", codigoOrden: "OR-1", montoComision: 65, ganancia: 650 }),
    item({ clave: "ORDEN:o1:RECEPCION:ORIGINAL:-", rol: "RECEPCION", codigoOrden: "OR-1", montoComision: 42.5, ganancia: 650 }),
  ]

  it("asks both order roles and badges the reception rows", () => {
    data.value = { items: pair(), resumen: [] }
    renderScreen()
    expect(swrKeys.some((k) => k.includes("rol=todos"))).toBe(true)
    expect(screen.getAllByText("Recepción")).toHaveLength(1)
  })

  it("pays technician and reception rows of the same order in one payout", async () => {
    data.value = { items: pair(), resumen: [] }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pagoId: "p1" }) }) as any
    renderScreen()
    const selectAll = screen.getAllByRole("checkbox").find((c) => !c.getAttribute("aria-label"))!
    fireEvent.click(selectAll)
    fireEvent.click(screen.getByRole("button", { name: /Liquidar seleccionadas/ }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(JSON.parse((global.fetch as any).mock.calls[0][1].body)).toEqual({
      beneficiarioId: "tec-9",
      filas: [
        { clave: "ORDEN:o1:TECNICO:ORIGINAL:-", monto: 65 },
        { clave: "ORDEN:o1:RECEPCION:ORIGINAL:-", monto: 42.5 },
      ],
    })
  })

  it("averages only technician original rows, totals cover every row", () => {
    data.value = { items: pair(), resumen: [] }
    renderScreen()
    // total pending = 107.5; promedio = 65 over one technician row
    expect(screen.getByText("$107.5")).toBeInTheDocument()
    expect(screen.getByText("Ticket prom. $650")).toBeInTheDocument()
  })

  it("does not divide by zero when there are only reception rows", () => {
    data.value = { items: [pair()[1]], resumen: [] }
    renderScreen()
    expect(screen.getByText("Ticket prom. $0")).toBeInTheDocument()
  })

  it("the CSV has a Rol column", async () => {
    data.value = { items: pair(), resumen: [] }
    let blob: Blob | null = null
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return "blob:x" }) as any
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    renderScreen()
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }))
    const text = await new Promise<string>((res) => {
      const fr = new FileReader()
      fr.onload = () => res(String(fr.result))
      fr.readAsText(blob!)
    })
    const [head, ...rows] = text.split(/\r?\n/)
    expect(head).toBe(
      '"Orden","Rol","Dispositivo","Fecha completado","Costo final","Repuestos","Base","% Comisión","Comisión","Estado pago","Fecha pago"'
    )
    expect(rows[0]).toContain('"Técnico"')
    expect(rows[1]).toContain('"Recepción"')
  })
})
