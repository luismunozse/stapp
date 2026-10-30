// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readByMarker, collapse, stripComments } from "./helpers/sql-text"

const bf = () => readByMarker("backfill", "Backfill of comisiones_pagos from legacy flags")
describe("payout backfill", () => {
  it("opens no transaction (db-run decides dry-run vs apply)", () => {
    expect(stripComments(bf())).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im)
  })
  it("takes amounts from today's views, and annulled paid sales from 333's paid branch", () => {
    const s = collapse(bf())
    expect(s).toContain("FROM v_comisiones_ordenes c WHERE c.comision_pagada")
    expect(s).toContain("FROM v_comisiones_ventas c JOIN ventas v ON v.id = c.venta_id WHERE c.comision_pagada AND c.vendedor_id IS NOT NULL")
    expect(s).toContain("ROUND(COALESCE(v.iva_neto, v.total) * COALESCE(v.porcentaje_comision, 0) / 100, 2)")
    expect(s).toContain("WHERE v.comision_pagada AND v.estado = 'ANULADA' AND v.vendedor_id IS NOT NULL")
  })
  it("is idempotent: skips documents that already have a live ORIGINAL item", () => {
    expect(collapse(bf())).toMatch(/DELETE FROM _bf b WHERE EXISTS \( SELECT 1 FROM comisiones_pagos_items i WHERE NOT i\.anulado AND i\.documento_tipo = b\.documento_tipo AND i\.documento_id = b\.documento_id AND i\.rol = b\.rol AND i\.tipo = 'ORIGINAL' \)/)
  })
  it("groups by beneficiary, org-timezone day and notes; NULL date = migration date", () => {
    const s = collapse(bf())
    expect(s).toContain("COALESCE(c.fecha_pago_comision, now())")
    expect(s).toContain("AT TIME ZONE org.zona_horaria)::date")
    expect(s).toContain("MAX(b.pagado_at) AS fecha_pago")
    expect(s).toContain("p.notas IS NOT DISTINCT FROM b.notas")
  })
  it("locks the payout items against the pay/annul RPCs before it builds _bf", () => {
    const s = collapse(bf())
    expect(s).toContain("SET LOCAL lock_timeout = '3s'; LOCK TABLE comisiones_pagos_items IN EXCLUSIVE MODE;")
    expect(s.indexOf("LOCK TABLE comisiones_pagos_items IN EXCLUSIVE MODE")).toBeLessThan(s.indexOf("CREATE TEMP TABLE _bf"))
  })
  it("documents that check [2] only means something before the first APP payout", () => {
    expect(bf()).toMatch(/\[2\] is meaningful only before any APP payout/)
  })
  it("ends with the checks the spec asks for", () => {
    for (const s of ["[2] por beneficiario", "[3] filas post-pago", "[4] pagadas fuera de los filtros de hoy", "[5] pagadas sin beneficiario"]) expect(bf()).toContain(s)
  })
})
