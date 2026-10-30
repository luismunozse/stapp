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
  it("takes the advisory lock before reading the definition", () => {
    expect(cuerpo().indexOf("pg_advisory_xact_lock")).toBeLessThan(cuerpo().indexOf("FROM v_comisiones_devengadas"))
  })
  it("locks the source documents after the advisory lock and before the definition is read", () => {
    const c = cuerpo()
    const adv = c.indexOf("pg_advisory_xact_lock"), def = c.indexOf("FROM v_comisiones_devengadas")
    for (const t of ["ventas", "ordenes_servicio"]) {
      const m = c.match(new RegExp("FROM " + t + " WHERE organization_id = p_organization_id AND id = ANY\\([^)]*\\) ORDER BY id FOR UPDATE"))
      expect(m, t).not.toBeNull()
      const at = c.indexOf(m![0])
      expect(at).toBeGreaterThan(adv); expect(at).toBeLessThan(def)
    }
  })
  it("refuses an ORIGINAL row of a legacy-paid document without payout items, after the source locks", () => {
    const c = cuerpo()
    const at = c.indexOf("comision_pagada")
    expect(at).toBeGreaterThan(c.lastIndexOf("FOR UPDATE;"))
    expect(at).toBeLessThan(c.indexOf("INSERT INTO comisiones_pagos"))
    const tramo = c.slice(c.lastIndexOf("IF v_fila.tipo = 'ORIGINAL'"), c.indexOf("COMISION_ERROR:OTRO_BENEFICIARIO"))
    expect(tramo).toContain("v.comision_pagada")
    expect(tramo).toContain("o.comision_pagada")
    expect(tramo).toContain("RAISE EXCEPTION 'COMISION_ERROR:FILA_NO_DISPONIBLE:%'")
    expect(tramo).toContain("i.rol = 'VENDEDOR'"); expect(tramo).toContain("i.rol = 'TECNICO'")
    expect(tramo).toContain("NOT i.anulado")
  })
  it("stamps the real payment time (clock_timestamp, after the locks) as fecha_pago", () => {
    const c = cuerpo()
    expect(c).toContain("clock_timestamp()")
    expect(c.indexOf("clock_timestamp()")).toBeGreaterThan(c.indexOf("FOR UPDATE"))
    expect(c).toMatch(/VALUES \(p_organization_id, p_beneficiario_id, v_pagado_at, /)
    expect(c).not.toMatch(/VALUES \([^)]*\bnow\(\)/)
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
    // the app calls the RPCs as service_role: every call is wrapped, and restored in the exception path too
    expect(probes()).toContain("SET LOCAL ROLE service_role")
    expect((probes().match(/SET LOCAL ROLE service_role;/g) ?? []).length).toBe(5)
    expect((probes().match(/RESET ROLE;/g) ?? []).length).toBe(8)
    expect(probes()).toContain("COMISION_ERROR:FILA_NO_DISPONIBLE:' || c.clave")
    expect(s).toMatch(/COUNT\(DISTINCT orden\)/)
  })
})
