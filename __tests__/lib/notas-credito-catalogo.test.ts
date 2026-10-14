import { describe, it, expect } from "vitest"
import {
  MOTIVOS_NC,
  MOTIVO_NC_LABELS,
  MODO_NC_LABELS,
  ORIGEN_NC_LABELS,
  esMotivoNC,
  etiquetaMotivo,
  etiquetaMetodo,
  etiquetaReintegro,
  numeroOperacion,
} from "@/lib/notas-credito/catalogo"

describe("catálogo de motivos", () => {
  it("es el mismo catálogo que los CHECK de la migración 350", () => {
    expect([...MOTIVOS_NC]).toEqual([
      "DEVOLUCION", "AJUSTE_PRECIO", "GARANTIA", "ERROR_FACTURACION",
      "DESCUENTO_RETRO", "TRABAJO_NO_REALIZADO", "OTRO",
    ])
  })

  it("todo motivo tiene etiqueta", () => {
    for (const m of MOTIVOS_NC) expect(MOTIVO_NC_LABELS[m].length).toBeGreaterThan(0)
  })

  it("esMotivoNC reconoce solo códigos del catálogo", () => {
    expect(esMotivoNC("GARANTIA")).toBe(true)
    expect(esMotivoNC("garantia")).toBe(false)
    expect(esMotivoNC(null)).toBe(false)
  })
})

describe("etiquetaMotivo", () => {
  it("con motivo de catálogo usa su etiqueta, aunque haya detalle libre", () => {
    expect(etiquetaMotivo("TRABAJO_NO_REALIZADO", "No se cambió la pantalla")).toBe("Trabajo no realizado")
  })

  // Review Focus 1: el historial DEV- tiene motivo_nc NULL y el motivo en texto libre.
  it("sin motivo de catálogo (historial) muestra el detalle libre", () => {
    expect(etiquetaMotivo(null, "  Producto con falla  ")).toBe("Producto con falla")
  })

  it("sin nada dice 'Sin motivo', nunca null ni undefined", () => {
    expect(etiquetaMotivo(null, null)).toBe("Sin motivo")
    expect(etiquetaMotivo(undefined, "   ")).toBe("Sin motivo")
  })
})

describe("etiquetaMetodo", () => {
  it("traduce los medios de la UI", () => {
    expect(etiquetaMetodo("EFECTIVO")).toBe("Efectivo")
    expect(etiquetaMetodo("TRANSFERENCIA")).toBe("Transferencia")
    expect(etiquetaMetodo("TARJETA")).toBe("Tarjeta")
    expect(etiquetaMetodo("CUENTA_CORRIENTE")).toBe("Cuenta corriente")
    expect(etiquetaMetodo("OTRO")).toBe("Otro medio")
  })

  // Review Focus 1: valores históricos que siguen siendo válidos en la base.
  it("traduce los medios históricos", () => {
    expect(etiquetaMetodo("CREDITO_TIENDA")).toBe("Crédito en el local")
    expect(etiquetaMetodo("NOTA_CREDITO_INTERNA")).toBe("Crédito en el local")
    expect(etiquetaMetodo("MERCADOPAGO")).toBe("Mercado Pago")
  })

  it("sin medio devuelve null y un código desconocido nunca sale crudo", () => {
    expect(etiquetaMetodo(null)).toBeNull()
    expect(etiquetaMetodo("")).toBeNull()
    expect(etiquetaMetodo("BITCOIN")).toBe("Otro medio")
  })
})

// El renglón del reintegro lo lee el cliente en el PDF y en el ticket.
describe("etiquetaReintegro", () => {
  it("plata que salió del local: 'Te devolvimos' con el medio", () => {
    expect(etiquetaReintegro("EFECTIVO")).toBe("Te devolvimos (Efectivo)")
    expect(etiquetaReintegro("TRANSFERENCIA")).toBe("Te devolvimos (Transferencia)")
    expect(etiquetaReintegro("MERCADOPAGO")).toBe("Te devolvimos (Mercado Pago)")
  })

  it("plata que quedó adentro: saldo a favor, no 'te devolvimos'", () => {
    expect(etiquetaReintegro("CUENTA_CORRIENTE")).toBe("A tu favor en cuenta corriente")
    expect(etiquetaReintegro("CREDITO_TIENDA")).toBe("Crédito a tu favor en el local")
    expect(etiquetaReintegro("NOTA_CREDITO_INTERNA")).toBe("Crédito a tu favor en el local")
  })

  it("sin medio registrado (historial) no afirma que se devolvió plata", () => {
    expect(etiquetaReintegro(null)).toBe("Reintegro")
    expect(etiquetaReintegro(undefined)).toBe("Reintegro")
  })
})

describe("numeroOperacion", () => {
  it("una venta se muestra como en el resto del sistema (V + 4 dígitos)", () => {
    expect(numeroOperacion("VENTA", "42")).toBe("V0042")
    expect(numeroOperacion("VENTA", "12345")).toBe("V12345")
  })

  it("una orden muestra su código, o # + número cuando no tiene código", () => {
    expect(numeroOperacion("ORDEN", "CEL099")).toBe("CEL099")
    expect(numeroOperacion("ORDEN", "7")).toBe("#0007")
  })

  it("sin número devuelve un guion", () => {
    expect(numeroOperacion("VENTA", null)).toBe("—")
    expect(numeroOperacion("ORDEN", " ")).toBe("—")
  })
})

describe("etiquetas de modo y origen", () => {
  it("cubren los dos valores", () => {
    expect(MODO_NC_LABELS).toEqual({ ITEMS: "Por productos", MONTO: "Por monto" })
    expect(ORIGEN_NC_LABELS).toEqual({ VENTA: "Venta", ORDEN: "Orden" })
  })
})
