import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))

// Radix Select no se maneja bien en jsdom: un <select> nativo con la misma API.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select aria-label="metodo" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

import { CambiarMetodoDialog, type MovimientoEditable } from "@/components/caja/cambiar-metodo-dialog"

const credito: MovimientoEditable = {
  id: "pv-1",
  fuente: "pagos_venta",
  metodoPago: "TARJETA_CREDITO",
  monto: 1000,
  descripcion: "Venta V-0001",
  costoFinancieroPorcentaje: 4,
}

const efectivo: MovimientoEditable = {
  id: "co-1",
  fuente: "cobros_orden",
  metodoPago: "EFECTIVO",
  monto: 1000,
  descripcion: "Cobro de orden · ORD-0012",
  costoFinancieroPorcentaje: null,
  numeroReferencia: null,
  observaciones: null,
}

function abrir(mov: MovimientoEditable = credito) {
  render(<CambiarMetodoDialog movimiento={mov} onOpenChange={vi.fn()} onSuccess={vi.fn()} />)
}
// Los pagos se corrigen con el formulario de cobro: el método es un botón.
const BOTON: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA_DEBITO: "T. Débito",
  TARJETA_CREDITO: "T. Crédito",
  MERCADOPAGO: "MercadoPago",
}
function elegir(metodo: string) {
  fireEvent.click(screen.getByRole("button", { name: BOTON[metodo] }))
}
const costo = () => screen.queryByLabelText(/costo terminal/i) as HTMLInputElement | null
const referencia = () => screen.queryByPlaceholderText(/nro\. de operación/i) as HTMLInputElement | null
const comentario = () => screen.queryByLabelText("Comentario") as HTMLTextAreaElement | null
const guardar = () => screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement

describe("CambiarMetodoDialog", () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const cuerpo = () => JSON.parse(fetchMock.mock.calls[0][1].body)
  const enviar = async () => {
    fireEvent.click(guardar())
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  }

  describe("flujo completo del pago", () => {
    it("de efectivo a transferencia pide el número de operación y el comentario, y los envía", async () => {
      abrir(efectivo)
      expect(referencia()).toBeNull()
      elegir("TRANSFERENCIA")
      fireEvent.change(referencia()!, { target: { value: "OP-99812" } })
      fireEvent.change(comentario()!, { target: { value: "Banco Nación" } })
      await enviar()
      expect(cuerpo()).toEqual({
        fuente: "cobros_orden",
        id: "co-1",
        metodoPago: "TRANSFERENCIA",
        referencia: "OP-99812",
        observaciones: "Banco Nación",
      })
    })

    it("precarga la referencia y el comentario guardados", () => {
      abrir({ ...efectivo, metodoPago: "TRANSFERENCIA", numeroReferencia: "OP-1", observaciones: "nota vieja" })
      expect(referencia()!.value).toBe("OP-1")
      expect(comentario()!.value).toBe("nota vieja")
    })

    it("sin cambios no deja guardar; corregir solo la referencia sí", async () => {
      abrir({ ...efectivo, metodoPago: "TRANSFERENCIA", numeroReferencia: "OP-1" })
      expect(guardar().disabled).toBe(true)
      fireEvent.change(referencia()!, { target: { value: "OP-2" } })
      expect(guardar().disabled).toBe(false)
      await enviar()
      expect(cuerpo()).toMatchObject({ metodoPago: "TRANSFERENCIA", referencia: "OP-2" })
    })

    it("al volver a un método sin referencia la manda vacía", async () => {
      abrir({ ...efectivo, metodoPago: "TRANSFERENCIA", numeroReferencia: "OP-1" })
      elegir("EFECTIVO")
      await enviar()
      expect(cuerpo().referencia).toBeNull()
    })

    it("el monto no se puede editar ni se puede partir el pago", () => {
      abrir(efectivo)
      expect(screen.queryByLabelText(/monto \*/i)).toBeNull()
      expect(screen.queryByRole("button", { name: /agregar otro método/i })).toBeNull()
      expect(screen.getByText("Monto del pago")).toBeTruthy()
    })

    it("no ofrece saldo a favor (cuenta corriente) como destino", () => {
      abrir(efectivo)
      expect(screen.queryByRole("button", { name: "Saldo a favor" })).toBeNull()
    })

    it("no deja editar ni envía el comentario que marca una seña", async () => {
      abrir({ ...efectivo, observaciones: "Seña al ingreso del equipo" })
      expect(comentario()).toBeNull()
      elegir("TRANSFERENCIA")
      await enviar()
      expect(cuerpo()).not.toHaveProperty("observaciones")
    })

    it("a crédito no pide cuotas y avisa que queda como pago único", () => {
      abrir(efectivo)
      elegir("TARJETA_CREDITO")
      expect(screen.queryByText("Cuotas")).toBeNull()
      expect(screen.getByText(/queda como pago único/i)).toBeTruthy()
    })
  })

  describe("costo de terminal", () => {
    it("con tarjeta muestra el campo precargado con el costo actual", () => {
      abrir()
      elegir("TARJETA_DEBITO")
      expect(costo()!.value).toBe("4")
    })

    it("el campo queda vacío si el pago no tenía costo", () => {
      abrir(efectivo)
      elegir("TARJETA_CREDITO")
      expect(costo()!.value).toBe("")
    })

    it("con un método que no es tarjeta no hay campo ni se envía el porcentaje", async () => {
      abrir()
      elegir("EFECTIVO")
      expect(costo()).toBeNull()
      await enviar()
      expect(cuerpo()).not.toHaveProperty("costoFinancieroPorcentaje")
      expect(cuerpo().metodoPago).toBe("EFECTIVO")
    })

    it("envía el porcentaje parseado con coma decimal", async () => {
      abrir()
      elegir("TARJETA_DEBITO")
      fireEvent.change(costo()!, { target: { value: "2,5" } })
      await enviar()
      expect(cuerpo()).toMatchObject({ metodoPago: "TARJETA_DEBITO", costoFinancieroPorcentaje: 2.5 })
    })

    it("vacío se envía como null (sin costo)", async () => {
      abrir()
      elegir("TARJETA_DEBITO")
      fireEvent.change(costo()!, { target: { value: "" } })
      await enviar()
      expect(cuerpo().costoFinancieroPorcentaje).toBeNull()
    })

    it("no envía nada y avisa si el porcentaje no está entre 0 y 100", async () => {
      abrir()
      elegir("TARJETA_DEBITO")
      fireEvent.change(costo()!, { target: { value: "101" } })
      fireEvent.click(guardar())
      expect(await screen.findByText(/entre 0 y 100/i)).toBeTruthy()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("si el campo no se tocó no envía el porcentaje (conserva el costo guardado)", async () => {
      abrir({ ...credito, costoFinancieroPorcentaje: null })
      elegir("TARJETA_DEBITO")
      await enviar()
      expect(cuerpo()).not.toHaveProperty("costoFinancieroPorcentaje")
    })

    it("si se escribe y se vuelve al valor original tampoco lo envía", async () => {
      abrir()
      elegir("TARJETA_DEBITO")
      fireEvent.change(costo()!, { target: { value: "9" } })
      fireEvent.change(costo()!, { target: { value: "4" } })
      await enviar()
      expect(cuerpo()).not.toHaveProperty("costoFinancieroPorcentaje")
    })

    it("muestra el campo en pagos de remitos (pagos_parciales)", () => {
      abrir({ ...credito, fuente: "pagos_parciales" })
      elegir("TARJETA_DEBITO")
      expect(costo()).not.toBeNull()
    })

    it("no avisa que se borra el costo de terminal al pasar a otra tarjeta", () => {
      abrir()
      elegir("TARJETA_DEBITO")
      expect(screen.queryByText(/borrar.*costo de terminal/i)).toBeNull()
    })
  })

  describe("depósitos a cuenta y movimientos manuales", () => {
    it("solo cambian de método: sin referencia, comentario ni costo", async () => {
      abrir({ ...credito, fuente: "cuenta_corriente", metodoPago: "EFECTIVO" })
      expect(comentario()).toBeNull()
      fireEvent.change(screen.getByLabelText("metodo"), { target: { value: "TARJETA_DEBITO" } })
      expect(costo()).toBeNull()
      await enviar()
      expect(cuerpo()).toEqual({ fuente: "cuenta_corriente", id: "pv-1", metodoPago: "TARJETA_DEBITO" })
    })
  })
})
