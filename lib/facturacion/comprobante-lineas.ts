// Lineas que imprime el PDF fiscal, derivadas SOLO del snapshot persistido
// (`detalle` JSONB = EmitirInput.items al emitir) y de los importes que ARCA
// autorizo. Despues de PR0 las lineas ya llegan con el IVA incluido y
// descontadas, asi que no se les suma IVA: en Factura B el "IVA contenido"
// (Ley 27.743, Regimen de Transparencia Fiscal) es el importe_iva persistido.

export interface LineaComprobante {
  descripcion: string
  cantidad: number
  unitario: number
  importe: number
}

export interface LineasComprobante {
  lineas: LineaComprobante[]
  /** Solo Factura B; en C no se informa IVA. */
  ivaContenido: number | null
  total: number
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function esLinea(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null
}

export function lineasComprobante(
  detalle: unknown,
  tipo: "B" | "C",
  persistidos: { importeIva: number; importeTotal: number }
): LineasComprobante {
  const crudas = Array.isArray(detalle) ? detalle : []
  const lineas: LineaComprobante[] = []

  for (const cruda of crudas) {
    if (!esLinea(cruda)) continue
    const cantidad = Number(cruda.cantidad)
    const unitarioCrudo = Number(cruda.importeUnitario)
    if (!Number.isFinite(cantidad) || !Number.isFinite(unitarioCrudo)) continue
    const importe = Number.isFinite(Number(cruda.importe)) && cruda.importe != null
      ? round2(Number(cruda.importe))
      : round2(unitarioCrudo * cantidad)
    lineas.push({
      descripcion: typeof cruda.descripcion === "string" ? cruda.descripcion : "",
      cantidad,
      unitario: round2(unitarioCrudo),
      importe,
    })
  }

  return {
    lineas,
    ivaContenido: tipo === "B" ? persistidos.importeIva : null,
    total: persistidos.importeTotal,
  }
}
