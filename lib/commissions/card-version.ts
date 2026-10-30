// Cache key for the card's request. It carries no logic: the amounts come from the server.
export function commissionCardVersion(o: {
  costoFinal?: number | null
  porcentajeComision?: number | null
  tecnicoId?: string | null
  estado?: string | null
  estadoCobro?: string | null
  costoRepuestosCotizaciones?: number | null
  repuestos?: Array<{ cantidad: number; precioUnitario: number | string }>
}): string {
  return JSON.stringify({
    costoFinal: o.costoFinal ?? null,
    porcentajeComision: o.porcentajeComision ?? null,
    tecnicoId: o.tecnicoId ?? null,
    estado: o.estado ?? null,
    estadoCobro: o.estadoCobro ?? null,
    costoRepuestosCotizaciones: o.costoRepuestosCotizaciones ?? null,
    repuestos: (o.repuestos ?? []).map((r) => [r.cantidad, r.precioUnitario]),
  })
}
