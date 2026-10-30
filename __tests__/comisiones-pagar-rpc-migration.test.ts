// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readBySuffix, readByMarker, collapse, stripComments } from "./helpers/sql-text"

const mig = () => collapse(readBySuffix("_comisiones_pagar_rpc.sql"))
const probes = () => readByMarker("verify", "Verification of comisiones_pagar_rpc")
const cuerpo = () => mig().slice(mig().indexOf("CREATE OR REPLACE FUNCTION pagar_comisiones("))

describe("378: pagar_comisiones", () => {
  it("checks ADMIN of the org before anything else", () => {
    expect(cuerpo()).toMatch(/rol = 'ADMIN'.*COMISION_ERROR:NO_AUTORIZADO/)
    expect(cuerpo().indexOf("COMISION_ERROR:NO_AUTORIZADO")).toBeLessThan(cuerpo().indexOf("pg_advisory_xact_lock"))
  })
  it("serializes per org and compares every row against the definition, not a total", () => {
    expect(cuerpo()).toContain("pg_advisory_xact_lock(hashtext('comisiones:' || p_organization_id))")
    expect(cuerpo()).toContain("FROM v_comisiones_devengadas")
    for (const c of ["FILA_NO_DISPONIBLE", "FILA_YA_PAGADA", "OTRO_BENEFICIARIO", "MONTO_DISTINTO"]) expect(cuerpo()).toContain(`COMISION_ERROR:${c}`)
    expect(cuerpo().indexOf("MONTO_DISTINTO")).toBeLessThan(cuerpo().indexOf("INSERT INTO comisiones_pagos"))
  })
  it("syncs both legacy flags after inserting the items", () => {
    expect(cuerpo()).toContain("comisiones_sincronizar_flags(p_organization_id, 'VENTA'")
    expect(cuerpo()).toContain("comisiones_sincronizar_flags(p_organization_id, 'ORDEN'")
  })
  it.each(["pagar_comisiones(TEXT, TEXT, TEXT, JSONB, TEXT)", "comisiones_sincronizar_flags(TEXT, TEXT, TEXT[])"])("%s is service_role only", (f) => {
    expect(mig()).toContain(`REVOKE EXECUTE ON FUNCTION ${f} FROM PUBLIC, anon, authenticated`)
    expect(mig()).toContain(`GRANT EXECUTE ON FUNCTION ${f} TO service_role`)
    expect(mig()).not.toMatch(/SECURITY DEFINER/)
  })
})
describe("378: probes", () => {
  it("roll back, never commit, and cover the review-focus cases", () => {
    const s = stripComments(probes())
    expect(s).toMatch(/^\s*BEGIN\s*;/m); expect(s.trimEnd().endsWith("ROLLBACK;")).toBe(true); expect(s).not.toMatch(/\bCOMMIT\b/i)
    for (const c of ["NO_AUTORIZADO", "MONTO_DISTINTO", "OTRO_BENEFICIARIO", "FILA_YA_PAGADA", "FILA_NO_DISPONIBLE"]) expect(probes()).toContain(c)
    expect(probes()).toMatch(/reasign/i); expect(probes()).toMatch(/costo_final/)
    expect(probes()).toContain("has_function_privilege")
    expect(s).toMatch(/COUNT\(DISTINCT orden\)/)
  })
})
