// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/401_probes.sql covers the runtime against the real schema, including the
// RESUELTO-on-delivery trigger).

const mig = () => readBySuffix("_reclamos_garantia_unificados.sql")
const rollback = () => readByMarker("rollback", "Rollback de reclamos_garantia_unificados")
const probes = () => readByMarker("verify", "Verificación de reclamos_garantia_unificados")

describe("reclamos_garantia_unificados (401)", () => {
  it("arranca con lock_timeout y no abre transacción propia", () => {
    expect(collapse(mig())).toContain("SET LOCAL lock_timeout = '3s';")
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("un reclamo apunta a exactamente una garantía (reparación o venta)", () => {
    const sql = collapse(mig())
    expect(sql).toContain("ALTER TABLE reclamos_garantia ALTER COLUMN garantia_id DROP NOT NULL;")
    expect(sql).toMatch(/ADD CONSTRAINT reclamos_garantia_un_origen CHECK \(num_nonnulls\(garantia_id, garantia_venta_id\) = 1\)/)
    expect(sql).toContain("ALTER TABLE reclamos_garantia VALIDATE CONSTRAINT reclamos_garantia_un_origen;")
    expect(sql).toContain("ADD CONSTRAINT reclamos_garantia_rechazo_con_motivo")
  })

  it("organization_id con backfill, NOT NULL y FK validada", () => {
    const sql = collapse(mig())
    expect(sql).toContain("ALTER TABLE reclamos_garantia ADD COLUMN IF NOT EXISTS organization_id TEXT;")
    expect(sql).toContain("ALTER TABLE reclamos_garantia ALTER COLUMN organization_id SET NOT NULL;")
    expect(sql).toContain("ALTER TABLE reclamos_garantia VALIDATE CONSTRAINT reclamos_garantia_organization_id_fkey;")
  })

  it("normaliza los estados viejos antes de los índices únicos", () => {
    const sql = stripComments(mig())
    const normaliza = sql.indexOf("'EN_REVISION'")
    const indice = sql.indexOf("reclamos_garantia_abierto_reparacion_uidx")
    expect(normaliza).toBeGreaterThan(-1)
    expect(normaliza).toBeLessThan(indice)
    expect(collapse(mig())).toMatch(/SET estado = 'PENDIENTE'[^;]*WHERE[^;]*estado = 'EN_REVISION'/)
  })

  it("un solo reclamo abierto por garantía, para los dos orígenes", () => {
    const sql = collapse(mig())
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS reclamos_garantia_abierto_reparacion_uidx ON reclamos_garantia (garantia_id) WHERE garantia_id IS NOT NULL AND estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO');"
    )
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS reclamos_garantia_abierto_venta_uidx ON reclamos_garantia (garantia_venta_id) WHERE garantia_venta_id IS NOT NULL AND estado IN ('PENDIENTE', 'EN_REVISION', 'ACEPTADO');"
    )
  })

  it("triggers: org y espejo de orden_reparacion_id, estado de la garantía y RESUELTO al entregar", () => {
    const sql = collapse(mig())
    expect(sql).toContain("CREATE TRIGGER reclamos_garantia_normalizar BEFORE INSERT OR UPDATE ON reclamos_garantia")
    expect(sql).toContain("NEW.orden_reparacion_id := COALESCE(NEW.orden_reingreso_id, NEW.orden_reparacion_id);")
    expect(sql).toContain("CREATE TRIGGER reclamos_garantia_sincronizar_garantia AFTER INSERT OR DELETE OR UPDATE OF estado ON reclamos_garantia")
    expect(sql).toContain("CREATE TRIGGER reclamos_garantia_resolver_por_entrega AFTER UPDATE OF estado ON ordenes_servicio")
    expect(sql).toMatch(/WHEN \(NEW\.es_reingreso AND NEW\.estado::TEXT IN \('ENTREGADO', 'ENTREGADO_SIN_REPARACION', 'ENTREGADO_SIN_COBRO'\)/)
    expect(sql).toMatch(/SET estado = 'RESUELTO'[^;]*WHERE orden_reingreso_id = NEW\.id AND estado = 'ACEPTADO'/)
    for (const fn of ["reclamos_garantia_sincronizar_garantia", "reclamos_garantia_resolver_por_entrega"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn}() FROM PUBLIC, anon, authenticated;`)
    }
  })

  it("las órdenes nacidas de reclamos viejos quedan marcadas como re-ingreso (misma definición que 381)", () => {
    const sql = collapse(mig())
    expect(sql).toMatch(/UPDATE ordenes_servicio o SET[^;]*es_reingreso = TRUE/)
  })

  it("la vista se recrea security_invoker con el reclamo abierto y solo la lee service_role", () => {
    const sql = collapse(mig())
    expect(sql).toContain("CREATE VIEW public.v_garantias WITH (security_invoker = true) AS")
    expect(sql).toContain("LEFT JOIN LATERAL")
    for (const col of ["reclamo_id", "reclamo_estado", "reclamo_orden_reingreso_id", "reclamo_orden_reingreso_numero"]) {
      expect(sql).toContain(col)
    }
    expect(sql).toContain("REVOKE ALL ON public.v_garantias FROM PUBLIC, anon, authenticated;")
    expect(sql).toContain("GRANT SELECT ON public.v_garantias TO service_role;")
  })

  it("nunca da permisos a anon ni authenticated", () => {
    for (const sql of [mig(), rollback()]) {
      expect(stripComments(sql)).not.toMatch(/GRANT[^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b/i)
    }
  })

  it("el rollback saca triggers, índices, restricciones y columnas, y restaura la vista con sus permisos", () => {
    const sql = collapse(rollback())
    for (const t of ["reclamos_garantia_resolver_por_entrega", "reclamos_garantia_sincronizar_garantia", "reclamos_garantia_normalizar"]) {
      expect(sql).toContain(`DROP TRIGGER IF EXISTS ${t}`)
      expect(sql).toContain(`DROP FUNCTION IF EXISTS public.${t}();`)
    }
    expect(sql).toContain("DROP INDEX IF EXISTS reclamos_garantia_abierto_reparacion_uidx;")
    expect(sql).toContain("DROP INDEX IF EXISTS reclamos_garantia_abierto_venta_uidx;")
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS reclamos_garantia_un_origen;")
    expect(sql).toContain("DROP COLUMN IF EXISTS garantia_venta_id;")
    expect(sql).toContain("ALTER COLUMN garantia_id SET NOT NULL;")
    expect(sql).toContain("WITH (security_invoker = true) AS")
    expect(sql).toContain("REVOKE ALL ON public.v_garantias FROM PUBLIC, anon, authenticated;")
  })

  it("las probes cubren el ciclo y terminan en ROLLBACK", () => {
    const sql = stripComments(probes())
    expect(sql.trim()).toMatch(/ROLLBACK;$/)
    expect(sql).not.toMatch(/^\s*COMMIT\s*;/im)
    expect(sql).toContain("security_invoker")
    expect(sql).toContain("RESUELTO")
    expect(sql).toContain("garantia_venta_id")
  })
})
