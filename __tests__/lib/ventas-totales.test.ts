import { describe, it, expect } from "vitest"
import {
  calcularTotalesVenta,
  condicionDeCobro,
  conciliarPagos,
  descuentoGlobalDeVenta,
  lineaConRecargo,
  metodoPagoCabecera,
} from "@/lib/ventas/totales"

const SIN_FISCAL = { regimen: "EXENTO" as const, tasa: 0, redondeoEfectivo: 0 }

describe("calcularTotalesVenta — recargo del método", () => {
  it("el recargo cae sobre el precio ya descontado (descuento en monto)", () => {
    // $10.000 con $1.000 de descuento y tarjeta +10%: lo que el cajero le dice
    // al cliente es $9.900. Antes el servidor calculaba $10.000.
    const t = calcularTotalesVenta(
      [{ cantidad: 1, precioUnitario: 10000, tipoDescuento: "MONTO", descuento: 1000 }],
      null,
      SIN_FISCAL,
      false,
      1.1
    )
    expect(t.subtotal).toBe(11000)
    expect(t.descuentoTotal).toBe(1100)
    expect(t.total).toBe(9900)
  })

  it("escala también el descuento global en monto", () => {
    const t = calcularTotalesVenta(
      [{ cantidad: 2, precioUnitario: 500 }],
      { tipo: "MONTO", valor: 100 },
      SIN_FISCAL,
      false,
      1.1
    )
    expect(t.total).toBe(990) // (1000 − 100) × 1,10
  })

  it("redondea el precio unitario a centavos antes de multiplicar por la cantidad", () => {
    // 33,33 × 1,03 = 34,3299 → 34,33 por unidad, que es lo que se guarda en items_venta
    const t = calcularTotalesVenta([{ cantidad: 10, precioUnitario: 33.33 }], null, SIN_FISCAL, false, 1.03)
    expect(t.total).toBe(343.3)
  })

  it("con factor 1 da lo mismo que sin recargo", () => {
    const lineas = [
      { cantidad: 3, precioUnitario: 1234.5, tipoDescuento: "PORCENTAJE" as const, porcentajeDescuento: 10 },
      { cantidad: 1, precioUnitario: 99.99, tipoDescuento: "MONTO" as const, descuento: 9.99 },
    ]
    const fiscal = { regimen: "ADITIVO" as const, tasa: 21, redondeoEfectivo: 0 }
    expect(calcularTotalesVenta(lineas, { tipo: "PORCENTAJE", valor: 5 }, fiscal, false, 1)).toEqual(
      calcularTotalesVenta(lineas, { tipo: "PORCENTAJE", valor: 5 }, fiscal)
    )
  })

  it("el redondeo de efectivo es lo último: después del recargo y del IVA", () => {
    const t = calcularTotalesVenta(
      [{ cantidad: 1, precioUnitario: 1003 }],
      null,
      { regimen: "EXENTO", tasa: 0, redondeoEfectivo: 10 },
      true,
      1
    )
    expect(t.redondeo).toBe(-3)
    expect(t.total).toBe(1000)
  })
})

describe("lineaConRecargo — lo que se guarda en items_venta", () => {
  it("el descuento en monto se escala igual que el precio", () => {
    expect(
      lineaConRecargo({ cantidad: 1, precioUnitario: 10000, tipoDescuento: "MONTO", descuento: 1000 }, 1.1)
    ).toEqual({ precioUnitario: 11000, descuento: 1100 })
  })

  it("el descuento no supera el bruto de la línea", () => {
    expect(
      lineaConRecargo({ cantidad: 1, precioUnitario: 100, tipoDescuento: "MONTO", descuento: 500 }, 1)
    ).toEqual({ precioUnitario: 100, descuento: 100 })
  })

  it("con descuento porcentual el monto queda en 0 (lo define el porcentaje)", () => {
    expect(
      lineaConRecargo({ cantidad: 1, precioUnitario: 100, tipoDescuento: "PORCENTAJE", porcentajeDescuento: 10, descuento: 7 }, 1.1)
    ).toEqual({ precioUnitario: 110, descuento: 0 })
  })
})

describe("condicionDeCobro", () => {
  const recargos = { TARJETA_CREDITO: 10, EFECTIVO: 0 }

  it("ignora las líneas sin monto (las que el cajero todavía no completó)", () => {
    const c = condicionDeCobro(
      [
        { metodo: "EFECTIVO", monto: 500 },
        { metodo: "TARJETA_CREDITO", monto: 0 },
      ],
      "EFECTIVO",
      false,
      recargos
    )
    expect(c.metodo).toBe("EFECTIVO")
    expect(c.efectivo).toBe(true)
    expect(c.factor).toBe(1)
  })

  it("el pago más grande fija el recargo; mezcla con tarjeta no redondea", () => {
    const c = condicionDeCobro(
      [
        { metodo: "EFECTIVO", monto: 300 },
        { metodo: "TARJETA_CREDITO", monto: 700 },
      ],
      "EFECTIVO",
      false,
      recargos
    )
    expect(c.metodo).toBe("TARJETA_CREDITO")
    expect(c.porcentaje).toBe(10)
    expect(c.factor).toBeCloseTo(1.1)
    expect(c.efectivo).toBe(false)
  })

  it("una venta fiada no redondea: no se cobra nada en efectivo", () => {
    const c = condicionDeCobro([], "EFECTIVO", true, recargos)
    expect(c.efectivo).toBe(false)
    expect(c.factor).toBe(1)
  })

  it("sin array de pagos ni pago parcial es el pago total con metodoPago", () => {
    expect(condicionDeCobro(undefined, "EFECTIVO", false, recargos).efectivo).toBe(true)
    const tarjeta = condicionDeCobro(undefined, "TARJETA_CREDITO", false, recargos)
    expect(tarjeta.efectivo).toBe(false)
    expect(tarjeta.factor).toBeCloseTo(1.1)
  })

  it("metodoPagoCabecera toma el primer pago cobrado", () => {
    expect(metodoPagoCabecera([{ metodo: "TARJETA_CREDITO", monto: 0 }, { metodo: "TRANSFERENCIA", monto: 10 }])).toBe(
      "TRANSFERENCIA"
    )
    expect(metodoPagoCabecera([])).toBe("EFECTIVO")
  })
})

describe("conciliarPagos", () => {
  it("dos pagos que suman el total en centavos no dejan saldo (2,86 + 11,45 = 14,31)", () => {
    // 2.86 + 11.45 da 14.309999… en binario
    const r = conciliarPagos(
      [
        { metodo: "TRANSFERENCIA", monto: 2.86 },
        { metodo: "EFECTIVO", monto: 11.45 },
      ],
      14.31,
      true
    )
    expect(r.error).toBeUndefined()
    expect(r.saldoPendiente).toBe(0)
  })

  it("con un centavo de diferencia ajusta el pago más grande para sumar exacto", () => {
    const r = conciliarPagos(
      [
        { metodo: "EFECTIVO", monto: 40 },
        { metodo: "TRANSFERENCIA", monto: 59.99 },
      ],
      100,
      false
    )
    expect(r.error).toBeUndefined()
    expect(r.saldoPendiente).toBe(0)
    expect(r.pagos.map((p) => p.monto)).toEqual([40, 60])
  })

  it("no toca el pago con saldo a favor de la cuenta corriente", () => {
    const r = conciliarPagos(
      [
        { metodo: "CUENTA_CORRIENTE", monto: 80 },
        { metodo: "EFECTIVO", monto: 20.01 },
      ],
      100,
      false
    )
    expect(r.pagos.map((p) => p.monto)).toEqual([80, 20])
  })

  it("sin pago parcial, una diferencia mayor a un centavo es un error", () => {
    const r = conciliarPagos([{ metodo: "EFECTIVO", monto: 99.98 }], 100, false)
    expect(r.error).toMatch(/no coincide/)
  })

  it("con pago parcial deja el saldo pendiente y no acepta pagos de más", () => {
    expect(conciliarPagos([{ metodo: "EFECTIVO", monto: 40 }], 100, true)).toMatchObject({ saldoPendiente: 60 })
    expect(conciliarPagos([{ metodo: "EFECTIVO", monto: 100.02 }], 100, true).error).toMatch(/exceder/)
    // Un pago parcial que cubre el total al centavo es un pago total.
    expect(conciliarPagos([{ metodo: "EFECTIVO", monto: 99.99 }], 100, true)).toMatchObject({ saldoPendiente: 0 })
  })

  it("sin pagos: la fiada deja todo pendiente; el camino viejo es pago total", () => {
    expect(conciliarPagos([], 250, true).saldoPendiente).toBe(250)
    expect(conciliarPagos([], 250, false).saldoPendiente).toBe(0)
  })
})

describe("descuentoGlobalDeVenta", () => {
  it("el global en monto es el total de descuentos menos los de línea", () => {
    expect(
      descuentoGlobalDeVenta({
        descuento: 130,
        tipoDescuento: "MONTO",
        items: [{ cantidad: 1, precioUnitario: 1000, tipoDescuento: "MONTO", descuento: 100 }],
      })
    ).toEqual({ tipo: "MONTO", valor: 30 })
  })

  it("sin global devuelve null aunque haya descuentos por línea", () => {
    expect(
      descuentoGlobalDeVenta({
        descuento: 100,
        tipoDescuento: "MONTO",
        items: [{ cantidad: 1, precioUnitario: 1000, tipoDescuento: "PORCENTAJE", porcentajeDescuento: 10 }],
      })
    ).toBeNull()
  })

  it("el porcentual se toma del porcentaje guardado", () => {
    expect(
      descuentoGlobalDeVenta({ descuento: 50, tipoDescuento: "PORCENTAJE", porcentajeDescuento: 5, items: [] })
    ).toEqual({ tipo: "PORCENTAJE", valor: 5 })
  })
})
