// @vitest-environment node
import { describe, it, expect } from "vitest"
import { origenPorConcepto } from "@/lib/caja-utils"

describe("origenPorConcepto — el respaldo de la columna origen (335)", () => {
  it.each([
    // [caso, fila, origen esperado]
    ["el ingreso de la anulación de una NC de venta", { tipo: "INGRESO", afecta_rentabilidad: false, concepto: "Anulación de nota de crédito NC-000123 - Venta V0042" }, "DEVOLUCION"],
    ["sin tilde, como lo pueda escribir otra herramienta", { tipo: "INGRESO", afecta_rentabilidad: false, concepto: "Anulacion de nota de credito NC-000123 - Venta V0042" }, "DEVOLUCION"],
    ["el de una NC de orden (PR6)", { tipo: "INGRESO", afecta_rentabilidad: false, concepto: "Anulación de nota de crédito NC-000124 - Orden CEL099" }, "NOTA_CREDITO"],
    ["un ingreso manual que afecta la rentabilidad", { tipo: "INGRESO", afecta_rentabilidad: true, concepto: "Anulación de nota de crédito NC-000123 - Venta V0042" }, "MANUAL"],
    ["un ingreso manual cualquiera", { tipo: "INGRESO", afecta_rentabilidad: false, concepto: "Aporte de socio" }, "MANUAL"],
  ])("%s", (_caso, fila, esperado) => {
    expect(origenPorConcepto(fila)).toBe(esperado)
  })

  // Caracterización: lo que ya clasificaba sigue igual.
  it.each([
    ["egreso de una devolución (ruta anterior al PR3b)", { tipo: "EGRESO", afecta_rentabilidad: false, concepto: "Devolución NC-000001" }, "DEVOLUCION"],
    ["egreso de una NC (367)", { tipo: "EGRESO", afecta_rentabilidad: false, concepto: "Nota de crédito NC-000002 - Venta V0042" }, "NOTA_CREDITO"],
    ["costo de mercadería", { tipo: "EGRESO", afecta_rentabilidad: false, concepto: "Costo de mercadería V0042" }, "COGS"],
    ["retiro de socio", { tipo: "EGRESO", afecta_rentabilidad: false, concepto: "Retiro de socio" }, "MANUAL"],
    ["recurrente", { tipo: "EGRESO", afecta_rentabilidad: true, es_recurrente: true, concepto: "Alquiler" }, "RECURRENTE"],
  ])("caracterización: %s", (_caso, fila, esperado) => {
    expect(origenPorConcepto(fila)).toBe(esperado)
  })
})
