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

function abrir(mov: MovimientoEditable = credito) {
  render(<CambiarMetodoDialog movimiento={mov} onOpenChange={vi.fn()} onSuccess={vi.fn()} />)
}
function elegir(metodo: string) {
  fireEvent.change(screen.getByLabelText("metodo"), { target: { value: metodo } })
}
const campo = () => screen.queryByLabelText(/costo de terminal/i) as HTMLInputElement | null

describe("CambiarMetodoDialog: costo de terminal", () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const cuerpo = () => JSON.parse(fetchMock.mock.calls[0][1].body)

  it("al elegir débito muestra el campo precargado con el costo actual y el texto de ayuda", () => {
    abrir()
    expect(campo()).toBeNull()
    elegir("TARJETA_DEBITO")
    expect(campo()!.value).toBe("4")
    expect(screen.getByText("Lo que cobra el posnet. Se descuenta como costo financiero.")).toBeTruthy()
  })

  it("el campo queda vacío si el pago no tenía costo", () => {
    abrir({ ...credito, metodoPago: "EFECTIVO", costoFinancieroPorcentaje: null })
    elegir("TARJETA_CREDITO")
    expect(campo()!.value).toBe("")
  })

  it("con un método que no es tarjeta no hay campo ni se envía el porcentaje", async () => {
    abrir()
    elegir("EFECTIVO")
    expect(campo()).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(cuerpo()).toEqual({ fuente: "pagos_venta", id: "pv-1", metodoPago: "EFECTIVO" })
  })

  it("envía el porcentaje parseado con coma decimal", async () => {
    abrir()
    elegir("TARJETA_DEBITO")
    fireEvent.change(campo()!, { target: { value: "2,5" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(cuerpo()).toMatchObject({ metodoPago: "TARJETA_DEBITO", costoFinancieroPorcentaje: 2.5 })
  })

  it("vacío se envía como null (sin costo)", async () => {
    abrir()
    elegir("TARJETA_DEBITO")
    fireEvent.change(campo()!, { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(cuerpo().costoFinancieroPorcentaje).toBeNull()
  })

  it("no envía nada y avisa si el porcentaje no está entre 0 y 100", async () => {
    abrir()
    elegir("TARJETA_DEBITO")
    fireEvent.change(campo()!, { target: { value: "101" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    expect(await screen.findByText(/entre 0 y 100/i)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("solo muestra el campo y envía el porcentaje para fuentes de pago", async () => {
    abrir({ ...credito, fuente: "cuenta_corriente", metodoPago: "EFECTIVO" })
    elegir("TARJETA_DEBITO")
    expect(campo()).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(cuerpo()).not.toHaveProperty("costoFinancieroPorcentaje")
  })

  it("muestra el campo en pagos de remitos (pagos_parciales)", () => {
    abrir({ ...credito, fuente: "pagos_parciales" })
    elegir("TARJETA_DEBITO")
    expect(campo()).not.toBeNull()
  })

  it("si el campo no se tocó no envía el porcentaje (conserva el costo guardado)", async () => {
    abrir({ ...credito, costoFinancieroPorcentaje: null })
    elegir("TARJETA_DEBITO")
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(cuerpo()).not.toHaveProperty("costoFinancieroPorcentaje")
  })

  it("si se escribe y se vuelve al valor original tampoco lo envía", async () => {
    abrir()
    elegir("TARJETA_DEBITO")
    fireEvent.change(campo()!, { target: { value: "9" } })
    fireEvent.change(campo()!, { target: { value: "4" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(cuerpo()).not.toHaveProperty("costoFinancieroPorcentaje")
  })

  it.each(["2,5abc", "abc", "1,2,3"])("rechaza el valor no numérico %s", async (valor) => {
    abrir()
    elegir("TARJETA_DEBITO")
    fireEvent.change(campo()!, { target: { value: valor } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    expect(await screen.findByText(/número válido/i)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("explica que los decimales van con coma si se escribe 2.500", async () => {
    abrir()
    elegir("TARJETA_DEBITO")
    fireEvent.change(campo()!, { target: { value: "2.500" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    expect(await screen.findByText(/coma para los decimales/i)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("ya no avisa que se borra el costo de terminal al pasar a otra tarjeta", () => {
    abrir()
    elegir("TARJETA_DEBITO")
    expect(screen.queryByText(/borrar.*costo de terminal/i)).toBeNull()
  })
})
