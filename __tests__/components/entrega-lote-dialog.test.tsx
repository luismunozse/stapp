// __tests__/components/entrega-lote-dialog.test.tsx
//
// EntregaLoteDialog — confirma el cobro unico del lote al entregarlo.
// Mockea fetch, igual que entrega-dialog-total.test.tsx hace para diálogos
// de entrega que no dependen del SessionProvider real.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { EntregaLoteDialog } from "@/components/ordenes/entrega-lote-dialog"
import { toast } from "sonner"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const ordenes = [
  { id: "o1", numeroOrden: 1, dispositivo: "iPhone 13", costoFinal: 200, presupuesto: null },
  { id: "o2", numeroOrden: 2, dispositivo: "Notebook HP", costoFinal: null, presupuesto: 150 },
]

function renderDialog(over: Record<string, unknown> = {}) {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  render(
    <EntregaLoteDialog
      open
      onClose={onClose}
      onSuccess={onSuccess}
      recepcionId="rec-1"
      ordenes={ordenes}
      descuentoTipo="porcentaje"
      descuentoValor={10}
      {...over}
    />
  )
  return { onClose, onSuccess }
}

/** Body del POST a /entregar. */
function entregarBody(mockFetch: ReturnType<typeof vi.fn>) {
  const call = mockFetch.mock.calls.find(
    ([url]) => typeof url === "string" && url.includes("/entregar")
  )
  return call ? JSON.parse((call[1] as RequestInit).body as string) : null
}

describe("EntregaLoteDialog", () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ recepcionId: "rec-1", totalCobrado: 315, ordenes: [] }),
      } as Response)
    )
    vi.stubGlobal("fetch", mockFetch)
  })

  it("lista cada equipo con un input de costo final prellenado con costoFinal ?? presupuesto ?? 0", () => {
    renderDialog()

    expect(screen.getByText(/#1/)).toBeInTheDocument()
    expect(screen.getByText(/iPhone 13/)).toBeInTheDocument()
    expect(screen.getByText(/#2/)).toBeInTheDocument()
    expect(screen.getByText(/Notebook HP/)).toBeInTheDocument()

    const input1 = screen.getByDisplayValue("200") // o1: costoFinal
    const input2 = screen.getByDisplayValue("150") // o2: sin costoFinal, cae al presupuesto
    expect(input1).toBeInTheDocument()
    expect(input2).toBeInTheDocument()
  })

  it("recalcula subtotal, descuento y total en vivo al editar los costos (calcularTotalLote)", () => {
    renderDialog()

    // Subtotal inicial: 200 + 150 = 350, descuento 10% => total 315
    expect(screen.getByText(/315/)).toBeInTheDocument()

    const input1 = screen.getByDisplayValue("200")
    fireEvent.change(input1, { target: { value: "300" } })

    // Nuevo subtotal: 300 + 150 = 450, descuento 10% => total 405
    expect(screen.getByText(/405/)).toBeInTheDocument()
  })

  it("el boton de confirmar esta deshabilitado hasta elegir un metodo de pago", () => {
    renderDialog()

    const btn = screen.getByRole("button", { name: /confirmar entrega/i })
    expect(btn).toBeDisabled()

    fireEvent.click(screen.getByRole("radio", { name: /efectivo/i }))
    expect(btn).not.toBeDisabled()
  })

  it("al confirmar hace POST con ordenes/costoFinal, metodoPago e idempotencyKey, y llama a onSuccess", async () => {
    const { onSuccess } = renderDialog()

    fireEvent.click(screen.getByRole("radio", { name: /efectivo/i }))
    fireEvent.click(screen.getByRole("button", { name: /confirmar entrega/i }))

    await waitFor(() => {
      const body = entregarBody(mockFetch)
      expect(body).toMatchObject({
        ordenes: [
          { id: "o1", costoFinal: 200 },
          { id: "o2", costoFinal: 150 },
        ],
        metodoPago: "EFECTIVO",
      })
      expect(typeof body.idempotencyKey).toBe("string")
      expect(body.idempotencyKey.length).toBeGreaterThan(0)
    })

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })

  it("normaliza el costo una sola vez: el total mostrado y el costoFinal enviado coinciden", async () => {
    renderDialog()

    const input1 = screen.getByDisplayValue("200")
    fireEvent.change(input1, { target: { value: "100.015" } })

    // 100.015 -> redondeado a 100.02. Subtotal: 100.02 + 150 = 250.02.
    // Descuento 10%: 25.002 -> total 225.018 -> redondeado a 225.02.
    //
    // Si el resumen sumara el valor SIN redondear (100.015 + 150 = 250.015)
    // y recién aplicara el redondeo al final, el total mostrado daría 225,01
    // — un centavo menos de lo que el servidor realmente cobra a partir de
    // los costoFinal ya redondeados que viajan en el POST. Este caso puntual
    // hace explícito ese desfase de un centavo.
    expect(await screen.findByText(/225,02/)).toBeInTheDocument()
    expect(screen.queryByText(/225,01/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("radio", { name: /efectivo/i }))
    fireEvent.click(screen.getByRole("button", { name: /confirmar entrega/i }))

    await waitFor(() => {
      const body = entregarBody(mockFetch)
      const o1 = body.ordenes.find((o: { id: string }) => o.id === "o1")
      // Mismo número que se ve en pantalla: 100.02, no 100.015 sin redondear.
      expect(o1.costoFinal).toBe(100.02)
    })
  })

  it("clampea un costo negativo a 0 tanto en el resumen como en lo enviado", async () => {
    renderDialog()

    const input1 = screen.getByDisplayValue("200")
    fireEvent.change(input1, { target: { value: "-50" } })

    // Subtotal: 0 (clampeado) + 150 = 150. Descuento 10% -> total 135.
    expect(await screen.findByText(/135,00/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("radio", { name: /efectivo/i }))
    fireEvent.click(screen.getByRole("button", { name: /confirmar entrega/i }))

    await waitFor(() => {
      const body = entregarBody(mockFetch)
      const o1 = body.ordenes.find((o: { id: string }) => o.id === "o1")
      expect(o1.costoFinal).toBe(0)
    })
  })

  it("con equipos ya entregados, el total a cobrar espeja la liquidacion del servidor", async () => {
    // Mismo caso que el fixture mixto de __tests__/api/entregar-lote.test.ts:
    // pendientes 100 + 200 + 300, ya entregados por 300 de costo, 280 netos ya
    // cobrados, 10% de descuento sobre el lote completo.
    //   subtotal del lote = 600 + 300 = 900
    //   total del lote    = 810
    //   a cobrar ahora    = 810 - 280 = 530  <- lo que el servidor cobra
    // Sin conciencia de lo ya cobrado, el dialogo mostraba 540 (10% sobre los
    // 600 pendientes) y el operador cobraba de mas.
    renderDialog({
      ordenes: [
        { id: "o1", numeroOrden: 1, dispositivo: "iPhone 13", costoFinal: 100, presupuesto: null },
        { id: "o2", numeroOrden: 2, dispositivo: "Notebook HP", costoFinal: 200, presupuesto: null },
        { id: "o3", numeroOrden: 3, dispositivo: "Tablet", costoFinal: 300, presupuesto: null },
      ],
      subtotalEntregados: 300,
      yaCobrado: 280,
    })

    expect(screen.getByText(/530,00/)).toBeInTheDocument()
    expect(screen.queryByText(/540,00/)).not.toBeInTheDocument()
    // Lineas intermedias para que el numero sea entendible.
    expect(screen.getByText(/total del lote/i)).toBeInTheDocument()
    expect(screen.getByText(/810,00/)).toBeInTheDocument()
    expect(screen.getByText(/ya cobrado/i)).toBeInTheDocument()
    expect(screen.getByText(/280,00/)).toBeInTheDocument()
  })

  it("sin equipos ya entregados no muestra las lineas intermedias (el total del lote ES lo que se cobra)", () => {
    renderDialog()

    expect(screen.queryByText(/ya cobrado/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/total del lote/i)).not.toBeInTheDocument()
    expect(screen.getByText(/315/)).toBeInTheDocument()
  })

  it("nunca muestra un total negativo cuando lo ya cobrado supera el total del lote", () => {
    renderDialog({ subtotalEntregados: 1000, yaCobrado: 1000, descuentoTipo: "monto", descuentoValor: 900 })

    // subtotal 350 + 1000 = 1350, total 450, ya cobrado 1000 -> piso en 0
    const filaTotal = screen.getByText("Total a cobrar").parentElement as HTMLElement
    expect(within(filaTotal).getByText(/^\$\s*0,00$/)).toBeInTheDocument()
  })

  it("muestra como toast los warnings de stock que devuelve la entrega", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          recepcionId: "rec-1",
          totalCobrado: 315,
          ordenes: [],
          warnings: ["Se entrego la orden 1, pero no se pudo descontar el stock de sus repuestos."],
        }),
      } as Response)
    )
    const { onSuccess } = renderDialog()

    fireEvent.click(screen.getByRole("radio", { name: /efectivo/i }))
    fireEvent.click(screen.getByRole("button", { name: /confirmar entrega/i }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(toast.warning).toHaveBeenCalledWith(
      "Se entrego la orden 1, pero no se pudo descontar el stock de sus repuestos.",
      { duration: 10000 }
    )
  })

  it("muestra el mensaje de error de la API (409 no reparado) sin cerrar el dialogo", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        json: async () => ({
          error: "Todos los equipos del lote deben estar reparados para entregar",
        }),
      } as Response)
    )
    const { onClose, onSuccess } = renderDialog()

    fireEvent.click(screen.getByRole("radio", { name: /efectivo/i }))
    fireEvent.click(screen.getByRole("button", { name: /confirmar entrega/i }))

    expect(
      await screen.findByText(/deben estar reparados para entregar/i)
    ).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
