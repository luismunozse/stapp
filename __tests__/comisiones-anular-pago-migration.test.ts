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
  it("cover annul, re-annul, reason, the adjustment guard via a sale annulled after payment", () => {
    for (const c of ["MOTIVO_REQUERIDO", "PAGO_YA_ANULADO", "AJUSTES_PAGADOS", "AJUSTE_ANULACION", "fecha_anulacion", "audit_logs"]) expect(probes()).toContain(c)
    expect(stripComments(probes()).trimEnd().endsWith("ROLLBACK;")).toBe(true)
  })
})
