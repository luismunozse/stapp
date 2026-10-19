import type { EmitirInput } from "./types"

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const aCentavos = (n: number) => Math.round(n * 100)
const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * Importe de una línea después de su propio descuento. items_venta guarda el
 * precio con el recargo del método ya aplicado; el descuento en monto es el
 * de toda la línea, el porcentual viaja como porcentaje.
 */
function importeLinea(it: any): number {
  const cantidad = it.cantidad == null ? 1 : Number(it.cantidad)
  const bruto = round2(cantidad * (Number(it.precio_unitario) || 0))
  const descuento =
    it.tipo_descuento === "PORCENTAJE"
      ? round2((bruto * (Number(it.porcentaje_descuento) || 0)) / 100)
      : round2(Number(it.descuento) || 0)
  return Math.max(bruto - Math.min(descuento, bruto), 0)
}

/**
 * Reparte `totalCentavos` entre las líneas en proporción a su peso, sin perder
 * ni inventar un centavo: el resto cae en la última línea con peso. Así el
 * descuento global, el IVA aditivo y el redondeo de efectivo quedan metidos en
 * las líneas y estas suman exactamente el total de la venta.
 */
function repartir(totalCentavos: number, pesos: number[]): number[] {
  const sumaPesos = pesos.reduce((a, b) => a + b, 0)
  const conPeso = pesos.map((p, i) => (p > 0 ? i : -1)).filter((i) => i >= 0)
  if (pesos.length === 0) return []
  if (sumaPesos <= 0 || conPeso.length === 0) {
    // Nada que prorratear: todo a la última línea.
    return pesos.map((_, i) => (i === pesos.length - 1 ? totalCentavos : 0))
  }
  const ultima = conPeso[conPeso.length - 1]
  const reparto = pesos.map((p) => Math.round((totalCentavos * p) / sumaPesos))
  const resto = totalCentavos - reparto.reduce((a, b) => a + b, 0)
  reparto[ultima] += resto
  return reparto
}

export function mapVentaToEmitirInput(venta: any, items: any[]): EmitirInput {
  const alic = venta.iva_tasa == null ? 21 : Number(venta.iva_tasa)
  const total = Number(venta.total) || 0
  const lista = items || []

  const importes = repartir(aCentavos(total), lista.map((it) => aCentavos(importeLinea(it)))).map((c) => c / 100)

  // El neto y el IVA que guardó la venta valen solo si hay IVA discriminado y
  // cierran con el total (con redondeo de efectivo ya no suman).
  const neto = Number(venta.iva_neto)
  const iva = Number(venta.iva_monto)
  const guardadoCierra =
    (venta.iva_regimen === "INCLUIDO" || venta.iva_regimen === "ADITIVO") &&
    alic > 0 &&
    iva > 0 &&
    aCentavos(neto + iva) === aCentavos(total)

  return {
    ventaId: venta.id,
    moneda: "PES",
    total,
    receptor: {
      razonSocial: venta.cliente_nombre || "Consumidor Final",
      documentoTipo: "CONSUMIDOR FINAL",
      documentoNro: "0",
      condicionIva: "CF",
    },
    items: lista.map((it, i) => {
      const cantidad = it.cantidad == null ? 1 : Number(it.cantidad)
      return {
        cantidad,
        descripcion: it.descripcion || "Item",
        importeUnitario: cantidad > 0 ? round6(importes[i] / cantidad) : importes[i],
        importe: importes[i],
        alicuotaIva: alic,
      }
    }),
    ...(guardadoCierra ? { desgloseIva: { neto: round2(neto), iva: round2(iva), alicuota: alic } } : {}),
  }
}
