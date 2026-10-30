// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readBySuffix, readByMarker, collapse, stripComments } from "./helpers/sql-text"

const mig = () => collapse(readBySuffix("_comisiones_definicion.sql"))
const m119 = () => collapse(readBySuffix("_comisiones_tecnicos.sql"))
const m333 = () => collapse(readBySuffix("_comision_neta_de_devoluciones.sql"))

describe("377: today's formulas, verbatim", () => {
  it("order base and amount are 119's expressions", () => {
    expect(mig()).toContain("ROUND(GREATEST(COALESCE(o.costo_final, 0) - rep.costo, 0) * COALESCE(o.porcentaje_comision, 0) / 100, 2)")
    expect(mig()).toContain("WHERE o.tecnico_id IS NOT NULL")
  })
  it("an order accrues exactly under the route filters of app/api/comisiones/route.ts:56-57", () => {
    expect(mig()).toContain("(o.estado_cobro = 'COBRADO' AND (o.estado IN ('REPARADO', 'ENTREGADO') OR (o.estado = 'ENTREGADO_SIN_REPARACION' AND org.comision_aplica_sin_reparacion))) AS devengada")
  })
  it("sale base is 333's unpaid branch, shared verbatim with 333", () => {
    const frag = "GREATEST(COALESCE(v.iva_neto, v.total) * (1 - dev.devuelto / v.total), 0)"
    expect(m333()).toContain(frag); expect(mig()).toContain(frag)
    expect(mig()).toContain("WHEN COALESCE(v.total, 0) <= 0 OR dev.devuelto = 0 THEN COALESCE(v.iva_neto, v.total)")
  })
  it("keeps today's bug: unpaid sale returns are summed without estado/anulada filters", () => {
    expect(mig()).toContain("SELECT COALESCE(SUM(d.monto_devolucion), 0) AS devuelto FROM devoluciones_venta d WHERE d.venta_id = v.id )")
  })
  it("119's repuestos sum is the parts cost", () => {
    expect(m119()).toContain("SUM(r.cantidad * r.precio_unitario)")
    expect(mig()).toContain("COALESCE(SUM(r.cantidad * r.precio_unitario), 0) AS costo")
  })
})
describe("377: adjustments and the closed-row rule", () => {
  it("a post-payment return counts only if effective and after the payout", () => {
    expect(mig()).toContain("d.estado = 'COMPLETADA' AND NOT d.anulada AND d.created_at > po.fecha_pago")
  })
  it("an annulment reverses the paid ORIGINAL plus paid return adjustments", () => {
    expect(mig()).toContain("-(po.monto + COALESCE(dp.monto, 0))")
    expect(mig()).toContain("COALESCE(v.fecha_anulacion, v.updated_at)")
  })
  it("a paid row suppresses its live twin by key, never by beneficiary", () => {
    const anti = mig().slice(mig().indexOf("WHERE NOT EXISTS ( SELECT 1 FROM pagadas x"))
    const cuerpo = anti.slice(0, anti.indexOf(")"))
    expect(cuerpo).toContain("x.documento_id IS NOT DISTINCT FROM l.documento_id")
    expect(cuerpo).toContain("x.ajuste_ref IS NOT DISTINCT FROM l.ajuste_ref")
    expect(cuerpo).not.toContain("beneficiario_id")
  })
  it("items of annulled payouts never close a row", () => {
    expect(mig()).toContain("FROM comisiones_pagos_items i JOIN comisiones_pagos p ON p.id = i.pago_id WHERE NOT i.anulado")
  })
})
describe("377: security and hygiene", () => {
  it.each(["v_comisiones_filas", "v_comisiones_devengadas"])("%s is invoker-secured and service_role only", (v) => {
    expect(mig()).toContain(`CREATE OR REPLACE VIEW ${v} WITH (security_invoker = true) AS`)
    expect(mig()).toContain(`REVOKE ALL ON public.${v} FROM PUBLIC, anon, authenticated`)
    expect(mig()).toContain(`GRANT SELECT ON public.${v} TO service_role`)
  })
  it("devengadas is filas filtered, nothing else", () => {
    expect(mig()).toContain("v_comisiones_devengadas WITH (security_invoker = true) AS SELECT * FROM v_comisiones_filas WHERE devengada;")
  })
  it("aborts before creating anything when 376 is missing", () => {
    expect(mig().indexOf("Abort: aplicar 376 antes de 377")).toBeLessThan(mig().indexOf("CREATE OR REPLACE VIEW"))
  })
  it("rollback drops both views, devengadas first", () => {
    const rb = collapse(readByMarker("rollback", "Rollback of comisiones_definicion"))
    expect(rb.indexOf("DROP VIEW IF EXISTS v_comisiones_devengadas")).toBeGreaterThan(-1)
    expect(rb.indexOf("DROP VIEW IF EXISTS v_comisiones_filas")).toBeGreaterThan(rb.indexOf("DROP VIEW IF EXISTS v_comisiones_devengadas"))
  })
})
const audit = () => readByMarker("backfill", "Audit of comisiones_definicion")
describe("377 audit", () => {
  it("is read-only", () => {
    expect(stripComments(audit())).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i)
  })
  it("compares unpaid documents with today's screen filters, both directions", () => {
    const s = collapse(audit())
    expect(s).toContain("FROM v_comisiones_ordenes c JOIN organizations org ON org.id = c.organization_id WHERE NOT c.comision_pagada AND c.estado_cobro = 'COBRADO'")
    expect(s).toContain("FROM v_comisiones_ventas c WHERE NOT c.comision_pagada")
    expect(s.match(/FULL JOIN/g)).toHaveLength(2)
    expect(s).toContain("WHERE COALESCE(h.monto, 0) <> COALESCE(n.monto, 0)")
  })
  it("lists flag/item drift in both directions", () => {
    expect(audit()).toMatch(/\[3\]/); expect(collapse(audit())).toMatch(/comision_pagada AND NOT EXISTS/); expect(collapse(audit())).toMatch(/NOT \w+\.comision_pagada AND EXISTS/)
  })
})
