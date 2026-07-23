import type { EmitirInput } from "./types"

export function mapVentaToEmitirInput(venta: any, items: any[]): EmitirInput {
  const alic = venta.iva_tasa == null ? 21 : Number(venta.iva_tasa)
  return {
    ventaId: venta.id,
    moneda: "PES",
    total: Number(venta.total) || 0,
    receptor: {
      razonSocial: venta.cliente_nombre || "Consumidor Final",
      documentoTipo: "CONSUMIDOR FINAL",
      documentoNro: "0",
      condicionIva: "CF",
    },
    items: (items || []).map((it) => ({
      cantidad: it.cantidad == null ? 1 : Number(it.cantidad),
      descripcion: it.descripcion || "Item",
      importeUnitario: Number(it.precio_unitario) || 0,
      alicuotaIva: alic,
    })),
  }
}
