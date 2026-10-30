// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readBySuffix, readByMarker, collapse, stripComments } from "./helpers/sql-text"

const mig = () => readBySuffix("_comisiones_fundacion.sql")
const rb = () => readByMarker("rollback", "Rollback of comisiones_fundacion")

describe("376: hygiene", () => {
  it("starts with SET LOCAL lock_timeout and opens no transaction", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })
})
describe("376: ventas.fecha_anulacion", () => {
  it("adds the column and a trigger on INSERT OR UPDATE OF estado", () => {
    expect(collapse(mig())).toContain("ADD COLUMN IF NOT EXISTS fecha_anulacion TIMESTAMPTZ")
    expect(collapse(mig())).toMatch(/BEFORE INSERT OR UPDATE OF estado ON ventas FOR EACH ROW EXECUTE FUNCTION set_fecha_anulacion_venta\(\)/)
  })
  it("backfills annulled sales from updated_at with ventas_updated_at disabled around it", () => {
    const s = collapse(mig())
    const off = s.indexOf("ALTER TABLE ventas DISABLE TRIGGER ventas_updated_at")
    const upd = s.indexOf("UPDATE ventas SET fecha_anulacion = updated_at WHERE estado = 'ANULADA' AND fecha_anulacion IS NULL")
    const on = s.indexOf("ALTER TABLE ventas ENABLE TRIGGER ventas_updated_at")
    expect(off).toBeGreaterThan(-1); expect(upd).toBeGreaterThan(off); expect(on).toBeGreaterThan(upd)
  })
})
describe("376: tables", () => {
  it.each(["comisiones_pagos", "comisiones_pagos_items", "comisiones_ajustes"])("%s: RLS on, service_role only", (t) => {
    const s = collapse(mig())
    expect(s).toContain(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`)
    expect(s).toContain(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated`)
    expect(s).not.toMatch(new RegExp(`GRANT [A-Z, ]+ ON public\\.${t} TO authenticated`))
  })
  it("a row can carry only one non-annulled payout item", () => {
    expect(collapse(mig())).toContain("CREATE UNIQUE INDEX IF NOT EXISTS comisiones_pagos_items_fila_vigente_uq ON comisiones_pagos_items (organization_id, COALESCE(documento_tipo, '-'), COALESCE(documento_id, '-'), rol, tipo, COALESCE(ajuste_ref, '-')) WHERE NOT anulado")
  })
  it("pins the role, kind and origin vocabularies", () => {
    const s = collapse(mig())
    expect(s).toContain("CHECK (rol IN ('VENDEDOR', 'TECNICO', 'RECEPCION'))")
    expect(s).toContain("CHECK (tipo IN ('ORIGINAL', 'AJUSTE_DEVOLUCION', 'AJUSTE_ANULACION', 'AJUSTE_MANUAL'))")
    expect(s).toContain("CHECK (origen IN ('APP', 'BACKFILL'))")
    expect(s).toContain("CHECK (origen IN ('MANUAL', 'CAMBIO_TASA'))")
  })
})
describe("376: rollback", () => {
  it("warns about data loss, exports first, and drops in dependency order", () => {
    const head = rb().slice(0, rb().indexOf("DROP"))
    expect(head).toMatch(/pierde|loses/i); expect(head).toMatch(/377_rollback/)
    const s = collapse(rb())
    expect(s.indexOf("DROP TABLE IF EXISTS comisiones_pagos_items")).toBeLessThan(s.indexOf("DROP TABLE IF EXISTS comisiones_pagos;"))
    expect(s).toContain("DROP COLUMN IF EXISTS fecha_anulacion")
  })
})
