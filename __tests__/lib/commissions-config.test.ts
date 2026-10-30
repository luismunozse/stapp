// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readBySuffix, collapse } from "../helpers/sql-text"
import { BASE_OPTIONS, COMMISSION_CONFIG_DEFAULTS, ORDER_ACCRUAL_OPTIONS, commissionConfigSchema } from "@/lib/commissions/config"

const ok = { ...COMMISSION_CONFIG_DEFAULTS, sinReparacionComisiona: false }

describe("commission config", () => {
  it("TS defaults equal 380's column defaults and 381's fallbacks", () => {
    const m380 = collapse(readBySuffix("_comisiones_recepcion.sql"))
    const m381 = collapse(readBySuffix("_comisiones_reparaciones.sql"))
    expect(m380).toContain(`orden_devengo TEXT NOT NULL DEFAULT '${COMMISSION_CONFIG_DEFAULTS.ordenDevengo}'`)
    expect(m380).toContain(`tecnico_base TEXT NOT NULL DEFAULT '${COMMISSION_CONFIG_DEFAULTS.tecnicoBase}'`)
    expect(m380).toContain(`recepcion_base TEXT NOT NULL DEFAULT '${COMMISSION_CONFIG_DEFAULTS.recepcionBase}'`)
    expect(m380).toContain(`recepcion_porcentaje_default NUMERIC(5,2) NOT NULL DEFAULT ${COMMISSION_CONFIG_DEFAULTS.recepcionPorcentajeDefault}`)
    expect(m381).toContain(`COALESCE(cfg.tecnico_base, '${COMMISSION_CONFIG_DEFAULTS.tecnicoBase}')`)
    expect(m381).toContain(`COALESCE(cfg.recepcion_base, '${COMMISSION_CONFIG_DEFAULTS.recepcionBase}')`)
  })

  it("schema rejects 101 and unknown options, rounds the rate", () => {
    expect(commissionConfigSchema.safeParse({ ...ok, recepcionPorcentajeDefault: 101 }).success).toBe(false)
    expect(commissionConfigSchema.safeParse({ ...ok, ordenDevengo: "REPARADO" }).success).toBe(false)
    expect(commissionConfigSchema.parse({ ...ok, recepcionPorcentajeDefault: 2.555 }).recepcionPorcentajeDefault).toBe(2.56)
  })

  it("offers every option once, with copy", () => {
    expect(ORDER_ACCRUAL_OPTIONS.map((o) => o.value)).toEqual(["ENTREGA_Y_COBRO", "ENTREGA", "COBRO"])
    expect(BASE_OPTIONS.map((o) => o.value)).toEqual(["MANO_DE_OBRA", "MONTO_ORDEN"])
    for (const o of [...ORDER_ACCRUAL_OPTIONS, ...BASE_OPTIONS]) {
      expect(o.label.length).toBeGreaterThan(0)
      expect(o.implica.length).toBeGreaterThan(0)
    }
  })
})
