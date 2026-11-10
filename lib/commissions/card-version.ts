// Every card request key starts with this prefix, so one `mutate` matcher can refresh them all.
export function orderCommissionKeyPrefix(ordenId: string): string {
  return `/api/comisiones/orden/${ordenId}?`
}

// Cache key for the card's request. It carries no logic: the amounts come from the server.
export function commissionCardVersion(o: {
  costoFinal?: number | null
  porcentajeComision?: number | null
  tecnicoId?: string | null
  estado?: string | null
  estadoCobro?: string | null
  descuentoCobro?: number | null
  fechaEntrega?: string | Date | null
  repuestos?: Array<{ cantidad: number; precioUnitario: number | string }>
}): string {
  return JSON.stringify({
    costoFinal: o.costoFinal ?? null,
    porcentajeComision: o.porcentajeComision ?? null,
    tecnicoId: o.tecnicoId ?? null,
    estado: o.estado ?? null,
    estadoCobro: o.estadoCobro ?? null,
    descuentoCobro: o.descuentoCobro ?? null,
    fechaEntrega: o.fechaEntrega ? String(o.fechaEntrega) : null,
    repuestos: (o.repuestos ?? []).map((r) => [r.cantidad, r.precioUnitario]),
  })
}
