/**
 * Cubre la adopcion de lib/thermal-paper.ts en el comprobante de recepcion
 * multiple (ver thermal-print-orden.tsx, que ya soporta 58/80mm desde el
 * PR #252 y sirvio de referencia aca). El riesgo puntual: el componente
 * fue escrito antes de que ese modulo existiera y tenia el ancho de 80mm
 * hardcodeado en varios lugares (estilos del iframe de impresion, titulo,
 * copy del preview y el ancho en px del preview en pantalla). Este archivo
 * no duplica __tests__/lib/thermal-paper.test.ts (que cubre el modulo en
 * si) -- testea que el componente efectivamente lee y usa ese ancho.
 *
 * No hace falta mockear nada para montar ThermalPrintRecepcion: a
 * diferencia de ThermalPrintOrden, no usa useThermalPrinter ni genera QR,
 * y useTerminologia cae al valor por defecto del contexto (sin Provider)
 * porque CurrencyContext se crea con un default value real, no undefined.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import {
  ThermalPrintRecepcion,
  type RecepcionReceiptData,
} from "@/components/ordenes/thermal-print-recepcion"
import { anchoToPx, readAncho } from "@/lib/thermal-paper"

const baseData: RecepcionReceiptData = {
  codigo: "REC-0007",
  fecha: "01/01/2026 10:00",
  clienteNombre: "Juan Perez",
  clienteTelefono: "123456",
  organizationName: "Taller Test",
  equipos: [
    {
      codigoOrden: "A-001",
      tipoDispositivo: "Celular",
      marca: "Samsung",
      dispositivo: "Galaxy S21",
      problemaReportado: "No enciende",
    },
  ],
}

function abrirDialogo() {
  fireEvent.click(screen.getByRole("button", { name: /comprobante/i }))
}

describe("ThermalPrintRecepcion — ancho de rollo termico (58/80mm)", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("sin nada guardado, el preview usa el ancho por defecto (80mm -> 302px)", () => {
    render(<ThermalPrintRecepcion data={baseData} />)
    abrirDialogo()

    const preview = document.getElementById("recepcion-receipt-print-area")
    expect(preview).not.toBeNull()
    expect(preview).toHaveStyle({ width: `${anchoToPx(80)}px` })
  })

  it("con 58mm guardado en localStorage, el preview usa 58mm (219px) en vez de 80mm", () => {
    localStorage.setItem("stapp:comprobante-ancho", "58")

    render(<ThermalPrintRecepcion data={baseData} />)
    abrirDialogo()

    const preview = document.getElementById("recepcion-receipt-print-area")
    expect(preview).toHaveStyle({ width: `${anchoToPx(58)}px` })
    expect(preview).not.toHaveStyle({ width: `${anchoToPx(80)}px` })
  })

  it("el selector de ancho cambia el preview y persiste la eleccion en localStorage", () => {
    render(<ThermalPrintRecepcion data={baseData} />)
    abrirDialogo()

    // Arranca en 80mm (default, nada guardado todavia).
    let preview = document.getElementById("recepcion-receipt-print-area")
    expect(preview).toHaveStyle({ width: `${anchoToPx(80)}px` })

    fireEvent.click(screen.getByRole("button", { name: "58mm" }))

    preview = document.getElementById("recepcion-receipt-print-area")
    expect(preview).toHaveStyle({ width: `${anchoToPx(58)}px` })
    expect(readAncho()).toBe(58)
  })
})
