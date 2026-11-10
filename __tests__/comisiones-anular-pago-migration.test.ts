// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readBySuffix, readByMarker, collapse, stripComments } from "./helpers/sql-text"

const mig = () => collapse(readBySuffix("_comisiones_anular_pago_rpc.sql"))
const probes = () => readByMarker("verify", "Verification of comisiones_anular_pago_rpc")

describe("379: anular_pago_comisiones", () => {
  it("requires ADMIN and a non-blank reason", () => {
    expect(mig()).toContain("COMISION_ERROR:NO_AUTORIZADO")
    expect(mig()).toMatch(/btrim\(COALESCE\(p_motivo, ''\)\) = ''.*COMISION_ERROR:MOTIVO_REQUERIDO/)
  })
  it("refuses while a later payout holds adjustments of its ORIGINAL rows", () => {
    expect(mig()).toMatch(/tipo IN \('AJUSTE_DEVOLUCION', 'AJUSTE_ANULACION'\).*COMISION_ERROR:AJUSTES_PAGADOS/)
    expect(mig().indexOf("AJUSTES_PAGADOS")).toBeLessThan(mig().indexOf("SET anulado = true"))
  })
  it("also guards a paid AJUSTE_DEVOLUCION that a later paid AJUSTE_ANULACION nets", () => {
    expect(mig()).toContain("AND NOT o.anulado AND (o.tipo = 'ORIGINAL' OR (o.tipo = 'AJUSTE_DEVOLUCION' AND a.tipo = 'AJUSTE_ANULACION'))")
    expect(mig()).not.toContain("AND o.tipo = 'ORIGINAL' AND NOT o.anulado")
  })
  it("soft-annuls payout and items, resyncs flags, audits in the same transaction", () => {
    const s = mig()
    expect(s).toMatch(/UPDATE comisiones_pagos SET anulado = true, anulado_por = p_usuario_id, anulado_at = now\(\), motivo_anulacion = btrim\(p_motivo\)/)
    expect(s).toMatch(/UPDATE comisiones_pagos_items SET anulado = true WHERE pago_id = p_pago_id/)
    expect(s).toContain("comisiones_sincronizar_flags(")
    expect(s).toMatch(/INSERT INTO audit_logs \(organization_id, user_id, action, entity, entity_id, changes, description\)/)
    expect(s).not.toMatch(/DELETE FROM comisiones_pagos/)
  })
})
describe("379: probes", () => {
  it("run every RPC call as service_role and cover the return-adjustment chain", () => {
    expect(probes()).toContain("SET LOCAL ROLE service_role"); expect(probes()).toContain("RESET ROLE")
    expect(probes()).toContain("AJUSTE_DEVOLUCION"); expect(probes()).toContain("devoluciones_venta")
    expect(probes()).toContain("c.dev_at - interval '1 day'")
    // the chain fixture does not depend on the seller's real rate: fixed 5%, and never the sale of probes 7-11
    expect(probes()).toContain("* 5 / 100")
    expect(probes()).toContain("v.id NOT IN (SELECT doc_id FROM _cv)")
    expect(probes()).not.toContain("f.porcentaje")
    expect(probes()).toMatch(/COUNT\(DISTINCT orden\)/)
  })
  it("cover annul, re-annul, reason, the adjustment guard via a sale annulled after payment", () => {
    for (const c of ["MOTIVO_REQUERIDO", "PAGO_YA_ANULADO", "AJUSTES_PAGADOS", "AJUSTE_ANULACION", "fecha_anulacion", "audit_logs"]) expect(probes()).toContain(c)
    expect(stripComments(probes()).trimEnd().endsWith("ROLLBACK;")).toBe(true)
  })
})
