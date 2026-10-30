// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readBySuffix, readByMarker, collapse, stripComments } from "./helpers/sql-text"

const mig = () => collapse(readBySuffix("_comisiones_reparaciones.sql"))
const m377 = () => collapse(readBySuffix("_comisiones_definicion.sql"))
const rb = () => readByMarker("rollback", "Rollback of comisiones_reparaciones")
const vista = (s: string) => s.slice(s.indexOf("CREATE OR REPLACE VIEW v_comisiones_filas"), s.indexOf("SELECT * FROM v_comisiones_filas WHERE devengada;") + 49)

describe("381: hygiene", () => {
  it("lock_timeout first, no transaction, no DML, aborts before anything when 380 is missing", () => {
    expect(mig().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(readBySuffix("_comisiones_reparaciones.sql"))).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;|\b(INSERT INTO|DELETE FROM)\b|\bUPDATE\s+\w+\s+SET\b/im)
    expect(mig().indexOf("Abort: aplicar 380 antes de 381")).toBeLessThan(mig().indexOf("CREATE TEMP TABLE _antes_381"))
  })
})
describe("381: sales are untouched", () => {
  it.each([
    "SELECT COALESCE(SUM(d.monto_devolucion), 0) AS devuelto FROM devoluciones_venta d WHERE d.venta_id = v.id )",
    "GREATEST(COALESCE(v.iva_neto, v.total) * (1 - dev.devuelto / v.total), 0)",
    "d.estado = 'COMPLETADA' AND NOT d.anulada AND d.created_at > po.fecha_pago",
    "-(po.monto + COALESCE(dp.monto, 0))",
  ])("keeps 377's fragment %s", (frag) => { expect(m377()).toContain(frag); expect(mig()).toContain(frag) })
})
describe("381: the order amount and the two roles", () => {
  it("order amount = costo_final − descuento_cobro − non-annulled credit notes, floored at 0", () => {
    expect(mig()).toContain("GREATEST(COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - ncs.monto, 0) AS monto_orden")
    expect(mig()).toContain("WHERE nc.orden_id = o.id AND nc.organization_id = o.organization_id AND NOT nc.anulada")
  })
  it("one row per role from the order's own snapshots; RECEPCION only when its amount is above 0", () => {
    expect(mig()).toContain("('TECNICO'::text, o.tecnico_id, COALESCE(o.porcentaje_comision, 0)::numeric, COALESCE(cfg.tecnico_base, 'MANO_DE_OBRA'))")
    expect(mig()).toContain("('RECEPCION'::text, o.recibido_por, COALESCE(o.porcentaje_comision_recepcion, 0)::numeric, COALESCE(cfg.recepcion_base, 'MONTO_ORDEN'))")
    expect(mig()).toContain("WHERE rr.beneficiario_id IS NOT NULL AND (rr.rol = 'TECNICO' OR ROUND(bb.base * rr.porcentaje / 100, 2) > 0)")
  })
  it("labour base is the order amount minus 119's parts cost", () => {
    expect(mig()).toContain("ELSE GREATEST(m.monto_orden - rep.costo, 0) END AS base")
    expect(mig()).toContain("COALESCE(SUM(r.cantidad * r.precio_unitario), 0) AS costo")
  })
})
describe("381: rules", () => {
  it("defaults when the config row is missing match 380's column defaults", () => {
    for (const d of ["COALESCE(cfg.orden_devengo, 'ENTREGA_Y_COBRO')", "COALESCE(cfg.reingreso_comisiona, false)"]) expect(mig()).toContain(d)
  })
  it("never-commission cases, flag 257 for both roles, then the accrual rule", () => {
    const s = mig()
    expect(s).toContain("WHEN o.es_practica OR o.estado IN ('CANCELADO', 'ENTREGADO_SIN_COBRO') OR (e.reingreso AND NOT COALESCE(cfg.reingreso_comisiona, false)) THEN 'NO_COMISIONA'")
    expect(s).toContain("WHEN o.estado = 'ENTREGADO_SIN_REPARACION' AND NOT org.comision_aplica_sin_reparacion THEN 'SIN_REPARACION'")
    expect(s).toContain("o.estado_cobro IS NOT DISTINCT FROM 'COBRADO' AS cobrada")
    expect(s).toContain("(o.es_reingreso OR EXISTS (SELECT 1 FROM reclamos_garantia rg WHERE rg.orden_reparacion_id = o.id)) AS reingreso")
    expect(s).toContain("(mo.motivo IS NULL) AS devengada")
  })
  it("fecha_devengo follows the rule; cobros and invoice payments ignore annulled ones", () => {
    const s = mig()
    expect(s).toContain("COALESCE(CASE e.regla WHEN 'ENTREGA' THEN o.fecha_entrega WHEN 'COBRO' THEN uc.ultimo_cobro ELSE GREATEST(o.fecha_entrega, uc.ultimo_cobro) END, o.fecha_completado) AS fecha_devengo")
    expect(s).toContain("AND NOT c.anulado")
    expect(s).toContain("f.estado_pago::text <> 'ANULADA'")
  })
})
describe("381: order credit notes after payment", () => {
  it("one negative row per credit note created after the role's ORIGINAL was paid, capped at the paid base", () => {
    const s = mig()
    expect(s).toContain("NOT nc.anulada AND nc.created_at > po.fecha_pago")
    expect(s).toContain("SUM(nc.monto) OVER (ORDER BY nc.created_at, nc.id) AS acumulado")
    expect(s).toContain("LEAST(COALESCE(po.base, 0), x.acumulado) - LEAST(COALESCE(po.base, 0), x.acumulado - x.monto) AS reduccion")
    expect(s).toContain("WHERE po.documento_tipo = 'ORDEN' AND po.tipo = 'ORIGINAL' AND po.rol IN ('TECNICO', 'RECEPCION')")
  })
  it("the closed-row anti-join is still by key, never by beneficiary", () => {
    const anti = mig().slice(mig().indexOf("WHERE NOT EXISTS ( SELECT 1 FROM pagadas x"))
    const cuerpo = anti.slice(0, anti.indexOf(")"))
    expect(cuerpo).not.toContain("beneficiario_id")
  })
})
describe("381: views, security, impact report", () => {
  it("both views invoker-secured, service_role only; devengadas restated; new columns last", () => {
    const s = mig()
    for (const v of ["v_comisiones_filas", "v_comisiones_devengadas"]) {
      expect(s).toContain(`CREATE OR REPLACE VIEW ${v} WITH (security_invoker = true) AS`)
      expect(s).toContain(`REVOKE ALL ON public.${v} FROM PUBLIC, anon, authenticated`)
      expect(s).toContain(`GRANT SELECT ON public.${v} TO service_role`)
    }
    expect(s).toMatch(/rep\.costo::numeric\(12,2\) AS documento_costo_repuestos, f\.base_tipo, f\.documento_monto::numeric\(12,2\) AS documento_monto, f\.motivo_sin_devengo FROM filas f/)
  })
  it("snapshots before replacing and prints every section the PR must state", () => {
    const s = mig()
    expect(s.indexOf("CREATE TEMP TABLE _antes_381 ON COMMIT DROP AS")).toBeLessThan(s.indexOf("CREATE OR REPLACE VIEW v_comisiones_filas"))
    for (const sec of ["[1] TECNICO sin pagar: cambia el monto", "[1b] cambia sin descuento ni nota de credito", "[2] TECNICO sin pagar: deja de devengar", "[3] TECNICO sin pagar: empieza a devengar", "[4] TECNICO sin pagar: cambia la fecha de devengo", "[5] filas pagadas que cambian", "[6] ajustes nuevos por nota de credito posterior al pago", "[7] filas RECEPCION", "[8] pendiente TECNICO devengado"]) expect(s).toContain(sec)
  })
  it("rollback restores 377's views exactly and says what stays visible", () => {
    expect(collapse(rb())).toContain("DROP VIEW IF EXISTS v_comisiones_devengadas; DROP VIEW IF EXISTS v_comisiones_filas;")
    expect(vista(collapse(rb()))).toBe(vista(m377()))
    expect(rb()).not.toContain("Rollback of comisiones_definicion")
  })
})
