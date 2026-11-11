// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/400_probes.sql covers the runtime against the real schema).

const mig = () => readBySuffix("_garantias_vista_unificada.sql")
const rollback = () => readByMarker("rollback", "Rollback de garantias_vista_unificada")
const probes = () => readByMarker("verify", "Verificación de garantias_vista_unificada")

describe("garantias_vista_unificada", () => {
  it("arranca con lock_timeout y no abre transacción propia", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("agrega organization_id con backfill desde la orden, NOT NULL, FK validada e índice", () => {
    const sql = collapse(mig())
    expect(sql).toContain("ALTER TABLE garantias ADD COLUMN IF NOT EXISTS organization_id TEXT;")
    expect(sql).toMatch(/UPDATE garantias g SET organization_id = o\.organization_id FROM ordenes_servicio o WHERE o\.id = g\.orden_id/)
    expect(sql).toContain("ALTER TABLE garantias ALTER COLUMN organization_id SET NOT NULL;")
    expect(sql).toContain("FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE NOT VALID;")
    expect(sql).toContain("ALTER TABLE garantias VALIDATE CONSTRAINT garantias_organization_id_fkey;")
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS garantias_organization_vencimiento_idx")
  })

  it("un trigger fija la org desde la orden en INSERT y UPDATE (los inserts viejos no la mandan)", () => {
    const sql = collapse(mig())
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF orden_id, organization_id ON garantias")
    expect(sql).toMatch(/SELECT o\.organization_id INTO NEW\.organization_id FROM ordenes_servicio o WHERE o\.id = NEW\.orden_id/)
  })

  it("la vista es security_invoker, une los dos orígenes y solo la lee service_role", () => {
    const sql = collapse(mig())
    expect(sql).toContain("CREATE VIEW public.v_garantias WITH (security_invoker = true) AS")
    expect(sql).toContain("'REPARACION'::TEXT")
    expect(sql).toContain("'VENTA'::TEXT")
    expect(sql).toContain("UNION ALL")
    expect(sql).toContain("REVOKE ALL ON public.v_garantias FROM PUBLIC, anon, authenticated;")
    expect(sql).toContain("GRANT SELECT ON public.v_garantias TO service_role;")
    expect(sql).not.toMatch(/GRANT [^;]* ON public\.v_garantias TO (anon|authenticated)/)
  })

  it("dia_vencimiento en la zona de la org; reclamos abiertos; anuladas; sin órdenes de práctica", () => {
    const sql = collapse(mig())
    expect(sql).toContain("(g.fecha_vencimiento AT TIME ZONE org.zona_horaria)::DATE AS dia_vencimiento")
    expect(sql).toContain("(gv.fecha_vencimiento AT TIME ZONE org.zona_horaria)::DATE")
    expect(sql).toContain("r.estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO')")
    expect(sql).toContain("(gv.estado = 'ANULADA' OR v.estado = 'ANULADA')")
    expect(sql).toContain("WHERE NOT o.es_practica")
  })

  it("es idempotente", () => {
    const sql = collapse(mig())
    expect(sql).toContain("DROP TRIGGER IF EXISTS garantias_organization_id ON garantias;")
    expect(sql).toContain("DROP VIEW IF EXISTS public.v_garantias;")
    expect(sql).toMatch(/IF NOT EXISTS \( SELECT 1 FROM pg_constraint WHERE conname = 'garantias_organization_id_fkey'/)
  })

  it("el rollback borra la vista, el trigger y la columna", () => {
    const sql = collapse(rollback())
    expect(sql).toContain("DROP VIEW IF EXISTS public.v_garantias;")
    expect(sql).toContain("DROP TRIGGER IF EXISTS garantias_organization_id ON garantias;")
    expect(sql).toContain("ALTER TABLE garantias DROP COLUMN IF EXISTS organization_id;")
  })

  it("las probes chequean permisos y el trigger, y terminan en ROLLBACK", () => {
    const p = collapse(probes())
    expect(p).toContain("has_table_privilege('anon', 'public.v_garantias', 'SELECT')")
    expect(p).toContain("el trigger toma la org de la orden")
    expect(stripComments(probes()).trim()).toMatch(/ROLLBACK;$/)
  })
})
