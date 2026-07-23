import type { EmitirInput } from "./types"

export function mapVentaToEmitirInput(venta: any, items: any[]): EmitirInput {
  const alic = Number(venta.iva_tasa) || 21
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
      cantidad: Number(it.cantidad) || 1,
      descripcion: it.descripcion || "Item",
      importeUnitario: Number(it.precio_unitario) || 0,
      alicuotaIva: alic,
    })),
  }
}
