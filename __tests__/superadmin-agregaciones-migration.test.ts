// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/396_probes.sql compares each function with a direct query on the real schema).

const mig = () => readBySuffix("_superadmin_agregaciones_sql.sql")
const rollback = () => readByMarker("rollback", "Rollback de superadmin_agregaciones_sql")
const probes = () => readByMarker("verify", "Verificación de superadmin_agregaciones_sql")

const FIRMAS = [
  "public.superadmin_pagos_por_moneda(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[])",
  "public.superadmin_ingresos_por_mes(TIMESTAMPTZ)",
  "public.superadmin_campania_segmentos()",
  "public.superadmin_engagement_metricas(TIMESTAMPTZ, TIMESTAMPTZ)",
  "public.superadmin_feature_usage_ultimo()",
]

/** The body of one function: from its CREATE to the closing `$$;`. */
function cuerpo(nombre: string): string {
  const sql = collapse(mig())
  const desde = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nombre}(`)
  expect(desde).toBeGreaterThanOrEqual(0)
  return sql.slice(desde, sql.indexOf("$$;", sql.indexOf("AS $$", desde)) + 3)
}

describe("superadmin_agregaciones_sql", () => {
  it("arranca con lock_timeout y no abre transacción propia", () => {
    expect(collapse(mig()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(mig())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("las funciones son SECURITY INVOKER y solo las ejecuta service_role", () => {
    const sql = collapse(mig())
    expect(sql).not.toMatch(/SECURITY DEFINER/i)
    for (const firma of FIRMAS) {
      for (const rol of ["PUBLIC", "anon", "authenticated"]) {
        expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION ${firma} FROM ${rol};`)
      }
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${firma} TO service_role;`)
    }
    expect(sql.match(/GRANT EXECUTE/g)).toHaveLength(FIRMAS.length)
  })

  it("los pagos se agrupan por moneda, nunca se suman monedas distintas", () => {
    for (const fn of ["superadmin_pagos_por_moneda", "superadmin_ingresos_por_mes"]) {
      const body = cuerpo(fn)
      expect(body).toContain("COALESCE(upper(sp.currency), 'SIN_MONEDA')")
      expect(body).toMatch(/GROUP BY 1(, 2)?\s/)
    }
    expect(cuerpo("superadmin_pagos_por_moneda")).toContain("RETURNS TABLE (moneda TEXT, total NUMERIC, cantidad BIGINT)")
  })

  it("el segmento inactivos es: orgs activas SIN órdenes reales en la ventana (por fecha_ingreso)", () => {
    const body = cuerpo("superadmin_campania_segmentos")
    expect(body).toContain("o.activo = TRUE AND o.deleted_at IS NULL AND o.slug IS DISTINCT FROM 'superadmin'")
    expect(body).toContain(
      "WHERE NOT EXISTS ( SELECT 1 FROM ordenes_servicio os WHERE os.organization_id = o.id AND os.es_practica = FALSE AND os.fecha_ingreso >= now() - make_interval(days => d.dias) )"
    )
    expect(body).toContain("FROM (VALUES (7), (30)) AS d(dias)")
  })

  it("ninguna función lee columnas que ordenes_servicio no tiene (created_at / updated_at)", () => {
    const sql = collapse(mig())
    expect(sql).not.toMatch(/os\.(created_at|updated_at)/)
  })

  it("engagement deja afuera la práctica del onboarding en órdenes y clientes", () => {
    const body = cuerpo("superadmin_engagement_metricas")
    const ordenes = body.match(/FROM ordenes_servicio os WHERE [^)]*/g) ?? []
    expect(ordenes.length).toBe(2)
    for (const where of ordenes) expect(where).toContain("os.es_practica = FALSE")
    expect(body).toContain("FROM clientes c WHERE c.es_practica = FALSE")
  })

  it("feature usage toma el último registro de cada org", () => {
    expect(cuerpo("superadmin_feature_usage_ultimo")).toContain(
      "SELECT DISTINCT ON (f.organization_id) f.* FROM feature_usage f ORDER BY f.organization_id, f.fecha DESC"
    )
  })

  it("las funciones jsonb nunca devuelven null (COALESCE a [] / {})", () => {
    for (const fn of ["superadmin_campania_segmentos", "superadmin_engagement_metricas", "superadmin_feature_usage_ultimo"]) {
      expect(cuerpo(fn)).toContain("'[]'::jsonb")
    }
  })

  it("rollback y probes", () => {
    const rb = collapse(rollback())
    for (const firma of FIRMAS) expect(rb).toContain(`DROP FUNCTION IF EXISTS ${firma};`)
    const p = stripComments(probes())
    expect(p).toMatch(/^\s*BEGIN\s*;/m)
    expect(p).toMatch(/SELECT orden, probe, esperado, obtenido, esperado = obtenido AS ok FROM _r ORDER BY orden, probe;\s*ROLLBACK;\s*$/)
    for (const fn of ["superadmin_pagos_por_moneda", "superadmin_ingresos_por_mes", "superadmin_campania_segmentos", "superadmin_engagement_metricas", "superadmin_feature_usage_ultimo"]) {
      expect(p).toContain(fn)
    }
  })
})
