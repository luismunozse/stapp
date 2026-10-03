// @vitest-environment node
import { describe, it, expect } from "vitest"
import { generateTicketCommands, type TicketData } from "@/lib/escpos"

// Los bytes del ticket son ASCII/CP858; para buscar texto alcanza con latin1.
function texto(data: TicketData): string {
  return Buffer.from(generateTicketCommands(data, 58)).toString("latin1")
}

const base: TicketData = {
  numeroVenta: 12,
  fecha: "01/10/2026 10:00",
  cliente: { nombre: "Ana" },
  vendedor: "Caja",
  items: [{ descripcion: "Mouse", cantidad: 1, precioUnitario: 1000, subtotal: 1000, diasGarantia: 0 }],
  subtotal: 1000,
  descuento: 0,
  total: 1210,
  metodoPago: "EFECTIVO",
}

describe("ticket térmico de venta", () => {
  it("con IVA aditivo muestra la línea de IVA para que el total cierre", () => {
    const t = texto({ ...base, ivaRegimen: "ADITIVO", ivaTasa: 21, ivaMonto: 210 })
    expect(t).toContain("IVA (21%):")
    expect(t).toContain("$210")
  })

  it("una venta fiada dice cuenta corriente y el saldo pendiente", () => {
    const t = texto({ ...base, total: 1000, metodoPago: "CUENTA_CORRIENTE", saldoPendiente: 1000 })
    expect(t).toContain("Cta. Cte.")
    expect(t).toContain("Saldo pendiente:")
  })

  it("con varios pagos los lista", () => {
    const t = texto({
      ...base,
      total: 1000,
      pagos: [
        { metodoPago: "EFECTIVO", monto: 400 },
        { metodoPago: "TARJETA_DEBITO", monto: 600 },
      ],
    })
    expect(t).toContain("Pagos:")
    expect(t).toContain("T. Debito")
    expect(t).toContain("$600")
  })
})
