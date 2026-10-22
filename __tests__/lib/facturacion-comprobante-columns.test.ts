// @vitest-environment node
import { describe, it, expect } from "vitest"

import {
  NC_COLUMNS,
  SAFE_COLUMNS,
  SNAPSHOT_COLUMNS,
  columnasFiscales,
} from "@/lib/facturacion/comprobante-columns"
import type { DatosFiscales } from "@/lib/facturacion/types"

const lista = (columnas: string) => columnas.split(",").map((c) => c.trim())

describe("NC_COLUMNS", () => {
  it("son las cinco columnas de la migración 371 (nota de crédito / anulación)", () => {
    expect(lista(NC_COLUMNS)).toEqual([
      "comprobante_asociado_id",
      "cbte_nro_solicitado",
      "motivo",
      "motivo_detalle",
      "anulado_at",
    ])
  })

  it("no repite columnas de las otras listas ni expone provider_response", () => {
    const otras = [...lista(SAFE_COLUMNS), ...lista(SNAPSHOT_COLUMNS)]
    for (const columna of lista(NC_COLUMNS)) expect(otras).not.toContain(columna)
    expect(NC_COLUMNS).not.toContain("provider_response")
  })

  it("se puede concatenar a las otras listas en un único SELECT", () => {
    const todas = lista(`${SAFE_COLUMNS}, ${SNAPSHOT_COLUMNS}, ${NC_COLUMNS}`)
    expect(new Set(todas).size).toBe(todas.length)
  })
})

describe("columnasFiscales", () => {
  const fiscal: DatosFiscales = {
    fechaEmision: "2026-10-20",
    cuitEmisor: "20111111112",
    cbteTipo: 8,
    concepto: 1,
    moneda: "PES",
    cotizacion: 1,
    importeNeto: 1000,
    importeIva: 210,
    importeTotal: 1210,
    receptorDocTipoCod: 99,
    receptorDocNro: "0",
  }
  const detalle = [{ cantidad: 1, descripcion: "Servicio", importeUnitario: 1210, alicuotaIva: 21 }]

  it("traduce la foto fiscal a las columnas de comprobantes_fiscales", () => {
    expect(columnasFiscales(fiscal, detalle)).toEqual({
      fecha_emision: "2026-10-20",
      cuit_emisor: "20111111112",
      cbte_tipo: 8,
      concepto: 1,
      moneda: "PES",
      cotizacion: 1,
      importe_neto: 1000,
      importe_iva: 210,
      importe_total: 1210,
      receptor_doc_tipo_cod: 99,
      receptor_doc_nro_cod: "0",
      detalle,
    })
  })

  it("las claves son exactamente las que SNAPSHOT_COLUMNS lee, más concepto", () => {
    const claves = Object.keys(columnasFiscales(fiscal, detalle)).sort()
    expect(claves).toEqual([...lista(SNAPSHOT_COLUMNS), "concepto"].sort())
  })
})
