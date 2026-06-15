import type { PosCartItem, PosCliente } from "./pos-types"
import type { PagoLineItem } from "@/components/pagos/multi-pago-input"

export interface BuildVentaPayloadInput {
  items: PosCartItem[]
  cliente: PosCliente
  pagosLines: PagoLineItem[]
  pagoParcial: boolean
  observaciones: string
  idempotencyKey: string
}

export interface VentaPayload {
  clienteId: string | null
  clienteNombre: string
  clienteTelefono?: string
  pagosParcial: boolean
  idempotencyKey: string
  items: {
    inventarioId: string | null
    descripcion: string
    cantidad: number
    precioUnitario: number
    diasGarantia: number
    descuento: number
    tipoDescuento: "MONTO"
    porcentajeDescuento: number
    serieIds?: string[]
    costo?: number
  }[]
  descuento: number
  tipoDescuento: "MONTO"
  porcentajeDescuento: number
  metodoPago: string
  observaciones?: string
  pagos?: {
    metodo: string
    monto: number
    referencia?: string
    cuotas?: number
    recargo?: number
    montoOriginal?: number
  }[]
}

export function buildVentaPayload(input: BuildVentaPayloadInput): VentaPayload {
  const { items, cliente, pagosLines, pagoParcial, observaciones, idempotencyKey } = input
  const pagosConMonto = pagosLines.filter((p) => p.monto > 0)

  return {
    clienteId: cliente.id || null,
    clienteNombre: cliente.nombre || "Consumidor Final",
    ...(cliente.telefono ? { clienteTelefono: cliente.telefono } : {}),
    pagosParcial: pagoParcial,
    idempotencyKey,
    items: items.map((item) => ({
      inventarioId: item.inventarioId || null,
      descripcion: item.nombre,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
      diasGarantia: item.diasGarantia,
      descuento: 0,
      tipoDescuento: "MONTO" as const,
      porcentajeDescuento: 0,
      ...(item.trackeaSeries && item.serieIds.length > 0 && { serieIds: item.serieIds }),
      ...(item.costo != null && { costo: item.costo }),
    })),
    descuento: 0,
    tipoDescuento: "MONTO" as const,
    porcentajeDescuento: 0,
    metodoPago: pagosConMonto.length > 0 ? pagosConMonto[0].metodo : "EFECTIVO",
    ...(observaciones ? { observaciones } : {}),
    ...(pagosConMonto.length > 0 && {
      pagos: pagosConMonto.map((p) => ({
        metodo: p.metodo,
        monto: p.monto,
        ...(p.referencia && { referencia: p.referencia }),
        ...(p.cuotas && { cuotas: p.cuotas }),
        ...(p.recargo && p.recargo > 0 && { recargo: p.recargo }),
        ...(p.recargo && p.recargo > 0 && { montoOriginal: p.monto + p.monto * (p.recargo / 100) }),
      })),
    }),
  }
}
