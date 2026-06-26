import type { PosCartItem, PosCliente, DescuentoConfig, TipoDescuento } from "./pos-types"
import type { PagoLineItem } from "@/components/pagos/multi-pago-input"

export interface BuildVentaPayloadInput {
  items: PosCartItem[]
  cliente: PosCliente
  pagosLines: PagoLineItem[]
  pagoParcial: boolean
  observaciones: string
  idempotencyKey: string
  /** Descuento global sobre toda la venta (opcional). */
  descuentoGlobal?: DescuentoConfig | null
  /** Motivo del descuento (opcional, para auditoría). */
  descuentoMotivo?: string
  /** Vendedor que realiza la venta (opcional; default = usuario de sesión en el servidor). */
  vendedorId?: string | null
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
    tipoDescuento: TipoDescuento
    porcentajeDescuento: number
    serieIds?: string[]
    costo?: number
  }[]
  descuento: number
  tipoDescuento: TipoDescuento
  porcentajeDescuento: number
  descuentoMotivo?: string
  metodoPago: string
  vendedorId?: string
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
  const { items, cliente, pagosLines, pagoParcial, observaciones, idempotencyKey, descuentoGlobal = null, descuentoMotivo, vendedorId } = input
  const pagosConMonto = pagosLines.filter((p) => p.monto > 0)

  const globalTipo: TipoDescuento = descuentoGlobal?.tipo ?? "MONTO"
  const globalValor = descuentoGlobal?.valor ?? 0

  return {
    clienteId: cliente.id || null,
    clienteNombre: cliente.nombre || "Consumidor Final",
    ...(cliente.telefono ? { clienteTelefono: cliente.telefono } : {}),
    pagosParcial: pagoParcial,
    idempotencyKey,
    items: items.map((item) => {
      const tipo: TipoDescuento = item.tipoDescuento ?? "MONTO"
      return {
        inventarioId: item.inventarioId || null,
        descripcion: item.nombre,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
        diasGarantia: item.diasGarantia,
        descuento: tipo === "MONTO" ? (item.descuento ?? 0) : 0,
        tipoDescuento: tipo,
        porcentajeDescuento: tipo === "PORCENTAJE" ? (item.porcentajeDescuento ?? 0) : 0,
        ...(item.trackeaSeries && item.serieIds.length > 0 && { serieIds: item.serieIds }),
        ...(item.costo != null && { costo: item.costo }),
      }
    }),
    descuento: globalTipo === "MONTO" ? globalValor : 0,
    tipoDescuento: globalTipo,
    porcentajeDescuento: globalTipo === "PORCENTAJE" ? globalValor : 0,
    ...(descuentoMotivo ? { descuentoMotivo } : {}),
    ...(vendedorId ? { vendedorId } : {}),
    metodoPago: pagosConMonto.length > 0 ? pagosConMonto[0].metodo : "EFECTIVO",
    ...(observaciones ? { observaciones } : {}),
    ...(pagosConMonto.length > 0 && {
      pagos: pagosConMonto.map((p) => ({
        metodo: p.metodo,
        monto: p.monto,
        ...(p.referencia && { referencia: p.referencia }),
        ...(p.cuotas && { cuotas: p.cuotas }),
        ...(p.recargo && p.recargo > 0 && { recargo: p.recargo }),
        // monto_original queda deprecado: `monto` es la base y `recargo` el %;
        // el total con recargo se deriva (monto + monto*recargo/100). No se escribe
        // el valor invertido que tenia antes (guardaba el total con recargo).
      })),
    }),
  }
}
