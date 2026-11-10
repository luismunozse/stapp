// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

import {
  CBTE_TIPO_FACTURA,
  CBTE_TIPO_NOTA_CREDITO,
  FILTRO_SIN_NC,
  esNotaCreditoFiscal,
} from "@/lib/facturacion/cbte-tipo"

describe("codigos de tipo de comprobante ARCA", () => {
  it("factura B = 6 y C = 11", () => {
    expect(CBTE_TIPO_FACTURA).toEqual({ B: 6, C: 11 })
  })

  it("nota de credito B = 8 y C = 13", () => {
    expect(CBTE_TIPO_NOTA_CREDITO).toEqual({ B: 8, C: 13 })
  })
})

describe("esNotaCreditoFiscal", () => {
  it("8 (NC B) y 13 (NC C) son notas de credito", () => {
    expect(esNotaCreditoFiscal(8)).toBe(true)
    expect(esNotaCreditoFiscal(13)).toBe(true)
  })

  it("6 (factura B) y 11 (factura C) no lo son", () => {
    expect(esNotaCreditoFiscal(6)).toBe(false)
    expect(esNotaCreditoFiscal(11)).toBe(false)
  })

  it("una fila legada sin cbte_tipo (null / undefined) es una factura", () => {
    expect(esNotaCreditoFiscal(null)).toBe(false)
    expect(esNotaCreditoFiscal(undefined)).toBe(false)
  })

  it("los demas codigos (factura A, NC A, basura) tampoco: solo se emiten B y C", () => {
    expect(esNotaCreditoFiscal(1)).toBe(false)
    expect(esNotaCreditoFiscal(3)).toBe(false)
    expect(esNotaCreditoFiscal(0)).toBe(false)
    expect(esNotaCreditoFiscal(Number.NaN)).toBe(false)
  })
})

describe("FILTRO_SIN_NC", () => {
  it("es el filtro de PostgREST .or() que deja pasar facturas y filas legadas", () => {
    expect(FILTRO_SIN_NC).toBe("cbte_tipo.is.null,cbte_tipo.not.in.(8,13)")
  })

  it("nombra exactamente los codigos de nota de credito", () => {
    const codigos = Object.values(CBTE_TIPO_NOTA_CREDITO)
    for (const codigo of codigos) {
      expect(FILTRO_SIN_NC).toContain(String(codigo))
    }
    expect(FILTRO_SIN_NC).toContain(`(${codigos.join(",")})`)
  })
})

describe("cbte-tipo es client-safe", () => {
  it("no importa nada del servidor (lo usan la ruta de emitir y la UI)", () => {
    const fuente = readFileSync(join(process.cwd(), "lib/facturacion/cbte-tipo.ts"), "utf8")

    expect(fuente.length).toBeGreaterThan(0)
    expect(fuente).not.toMatch(/server-only/)
    expect(fuente).not.toMatch(/next\/(headers|server)/)
    expect(fuente).not.toMatch(/lib\/supabase/)
    expect(fuente).not.toMatch(/process\.env/)
  })
})
