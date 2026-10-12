// @vitest-environment node
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

// Migrations are applied by hand and there is no Postgres in CI: this test pins
// by text what vitest cannot execute.
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/348_orden_practica_onboarding.sql"),
  "utf8"
)
const ROLLBACK = readFileSync(
  join(process.cwd(), "supabase/migrations/rollback/348_rollback.sql"),
  "utf8"
)

const FILES: Array<[string, string]> = [
  ["migration", MIGRATION],
  ["rollback", ROLLBACK],
]

// borrar_datos_practica, from its header to its LANGUAGE line.
const BORRAR =
  MIGRATION.match(/CREATE OR REPLACE FUNCTION borrar_datos_practica\(p_org_id TEXT\)[\s\S]*?\$\$ LANGUAGE plpgsql[^;]*;/)?.[0] ?? ""

// Tables the practice itself writes to. Any other reference to the practice
// order means it was used for real work.
const EFECTOS_DE_LA_PRACTICA = [
  "checklist_recepcion",
  "fotos_orden",
  "notification_logs",
  "orden_eventos",
  "orden_tiempos_estado",
  "user_notifications",
]

describe("migration 348: practice order (es_practica)", () => {
  it.each(FILES)("%s recreates v_clientes_resumen with security_invoker", (_name, sql) => {
    expect(sql).toMatch(/CREATE VIEW v_clientes_resumen WITH \(security_invoker = true\)/)
  })

  it.each(FILES)("%s does not own its transaction", (_name, sql) => {
    expect(sql).not.toMatch(/^\s*BEGIN\s*;/im)
  })

  it.each(FILES)("%s uses the 348 temp table names, no stale 346", (_name, sql) => {
    expect(sql).not.toMatch(/_346/)
  })

  it("snapshots and restores the view ACL", () => {
    expect(MIGRATION).toMatch(
      /CREATE TEMP TABLE _acl_v_clientes_resumen_348 ON COMMIT DROP AS\s+SELECT relacl FROM pg_class/
    )
    expect(MIGRATION).toMatch(/aclexplode\(t\.relacl\)/)
    expect(MIGRATION).toMatch(/GRANT %s ON public\.v_clientes_resumen TO/)
  })

  it("rollback snapshots and restores the view ACL", () => {
    expect(ROLLBACK).toMatch(/CREATE TEMP TABLE _acl_v_clientes_resumen_348r ON COMMIT DROP AS/)
    expect(ROLLBACK).toMatch(/GRANT %s ON public\.v_clientes_resumen TO/)
  })

  it("autocheck asserts the view keeps security_invoker", () => {
    expect(MIGRATION).toMatch(/reloptions @> ARRAY\['security_invoker=true'\]/)
    expect(MIGRATION).toMatch(/SELECT relacl::text AS acl_v_clientes_resumen,\s+reloptions::text AS/)
    expect(ROLLBACK).toMatch(/SELECT relacl::text AS acl_v_clientes_resumen,\s+reloptions::text AS/)
  })

  it.each(["borrar_datos_practica(TEXT)", "registrar_camino_onboarding(TEXT, TEXT)"])(
    "revokes EXECUTE on %s from anon and authenticated",
    (sig) => {
      const esc = sig.replace(/[()]/g, "\\$&")
      expect(MIGRATION).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${esc} FROM PUBLIC;`))
      expect(MIGRATION).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${esc} FROM anon;`))
      expect(MIGRATION).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${esc} FROM authenticated;`))
      expect(MIGRATION).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${esc} TO service_role;`))
    }
  )

  it("the clientes count trigger fires on es_practica updates", () => {
    expect(MIGRATION).toMatch(/AFTER INSERT OR DELETE OR UPDATE OF es_practica ON clientes/)
    expect(ROLLBACK).toMatch(/AFTER INSERT OR DELETE ON clientes/)
  })

  it("autocheck seeds clientes_count before the cleanup and covers 'real' over 'omitido'", () => {
    expect(MIGRATION).toMatch(/UPDATE organization_usage SET clientes_count = 5 WHERE organization_id = v_org;/)
    expect(MIGRATION).toMatch(/registrar_camino_onboarding\(v_org, 'real'\)/)
  })

  it("es_practica is server-only: BEFORE guard triggers on both tables, no SECURITY DEFINER", () => {
    for (const t of ["clientes", "ordenes_servicio"]) {
      expect(MIGRATION).toMatch(
        new RegExp(`BEFORE INSERT OR UPDATE OF es_practica ON ${t}\\s+FOR EACH ROW EXECUTE FUNCTION es_practica_solo_servidor\\(\\)`)
      )
    }
    const fn = MIGRATION.match(/CREATE OR REPLACE FUNCTION es_practica_solo_servidor\(\)[\s\S]*?LANGUAGE plpgsql[^;]*;/)
    expect(fn).not.toBeNull()
    expect(fn![0]).not.toMatch(/SECURITY DEFINER/)
    expect(fn![0]).toMatch(/SET search_path = public, pg_temp/)
    expect(fn![0]).toMatch(/current_user IN \('anon', 'authenticated'\)/)
    expect(fn![0]).toMatch(/ERRCODE = '42501'/)
  })

  it("autocheck runs the guard as authenticated and expects the guard's own message", () => {
    expect(MIGRATION).toMatch(/SET LOCAL ROLE authenticated;/)
    expect(MIGRATION).toMatch(/SQLERRM <> 'es_practica lo escribe solo el servidor'/)
  })

  it("rollback drops the guard triggers and function", () => {
    expect(ROLLBACK).toMatch(/DROP TRIGGER IF EXISTS trigger_clientes_es_practica_guard ON clientes;/)
    expect(ROLLBACK).toMatch(/DROP TRIGGER IF EXISTS trigger_ordenes_es_practica_guard ON ordenes_servicio;/)
    expect(ROLLBACK).toMatch(/DROP FUNCTION IF EXISTS es_practica_solo_servidor\(\);/)
  })

  it("registrar_camino_onboarding is STRICT; count checks tolerate a missing usage row", () => {
    expect(MIGRATION).toMatch(/\$\$ LANGUAGE sql STRICT SET search_path/)
    expect(MIGRATION).toMatch(/IF v_n IS DISTINCT FROM 5 THEN/)
    expect(MIGRATION).toMatch(/IF v_n IS DISTINCT FROM v_antes \+ 1 THEN/)
  })

  it("sets a lock_timeout without owning the transaction", () => {
    expect(MIGRATION).toMatch(/^SET LOCAL lock_timeout = '5s';/m)
  })

  describe("borrar_datos_practica keeps a practice order that other tables reference", () => {
    it("locks the order, then reads its FKs from pg_constraint before deleting", () => {
      expect(BORRAR).toMatch(/SELECT id FROM ordenes_servicio\s+WHERE organization_id = p_org_id AND es_practica\s+FOR UPDATE/)
      const lock = BORRAR.search(/SELECT id FROM ordenes_servicio\s+WHERE organization_id = p_org_id AND es_practica\s+FOR UPDATE/)
      const check = BORRAR.indexOf("c.confrelid = 'public.ordenes_servicio'::regclass")
      const borrado = BORRAR.indexOf("DELETE FROM ordenes_servicio WHERE id = v_orden_id;")
      expect(check).toBeGreaterThan(lock)
      expect(borrado).toBeGreaterThan(check)
    })

    it("exempts only the practice's own side-effect tables", () => {
      const lista = BORRAR.match(/c\.confrelid = 'public\.ordenes_servicio'::regclass\s+AND c\.conrelid NOT IN \(([^)]*)\)/)
      expect(lista).not.toBeNull()
      const tablas = [...lista![1].matchAll(/'public\.(\w+)'::regclass/g)].map((m) => m[1]).sort()
      expect(tablas).toEqual(EFECTOS_DE_LA_PRACTICA)
    })

    it("turns a referenced order into a real one instead of deleting it", () => {
      expect(BORRAR).toMatch(
        /IF v_orden_usada THEN\s+(?:--.*\s+)*UPDATE ordenes_servicio SET es_practica = FALSE WHERE id = v_orden_id;\s+v_orden_conservada := TRUE;\s+ELSE/
      )
    })

    it("treats a composite FK as a reference, like the client check", () => {
      const ordenCheck = BORRAR.slice(BORRAR.indexOf("c.confrelid = 'public.ordenes_servicio'::regclass"))
      expect(ordenCheck).toMatch(/IF array_length\(v_fk\.conkey, 1\) <> 1 THEN\s+(?:--.*\s+)*v_orden_usada := TRUE;/)
    })

    it("reports orden_conservada on every return", () => {
      const salidas = BORRAR.match(/RETURN jsonb_build_object\([\s\S]*?\);/g) ?? []
      expect(salidas).toHaveLength(2)
      for (const salida of salidas) {
        expect(salida).toMatch(/'orden_borrada'/)
        expect(salida).toMatch(/'orden_conservada'/)
        expect(salida).toMatch(/'cliente_conservado'/)
      }
    })

    it("autocheck (i): an order with a payment survives as real, with its payment and client", () => {
      const caso = MIGRATION.slice(MIGRATION.indexOf("-- (i)"))
      expect(MIGRATION.indexOf("-- (i)")).toBeGreaterThan(-1)
      expect(MIGRATION.indexOf("-- (i)")).toBeLessThan(MIGRATION.lastIndexOf("RAISE EXCEPTION 'autocheck-348-rollback';"))
      expect(caso).toMatch(/INSERT INTO cobros_orden \(orden_id, organization_id, monto, metodo_pago\)/)
      expect(caso).toMatch(/\(v_res->>'orden_conservada'\)::BOOLEAN IS NOT TRUE/)
      expect(caso).toMatch(/\(v_res->>'orden_borrada'\)::BOOLEAN IS NOT FALSE/)
      expect(caso).toMatch(/\(v_res->>'cliente_conservado'\)::BOOLEAN IS NOT TRUE/)
      expect(caso).toMatch(/NOT EXISTS \(SELECT 1 FROM ordenes_servicio WHERE id = v_orden_c AND NOT es_practica\)/)
      expect(caso).toMatch(/NOT EXISTS \(SELECT 1 FROM cobros_orden WHERE orden_id = v_orden_c\)/)
      expect(caso).toMatch(/NOT EXISTS \(SELECT 1 FROM clientes WHERE id = v_cli_c AND NOT es_practica\)/)
    })

    it("autocheck (c): an order with only side-effect rows is still deleted", () => {
      expect(MIGRATION).toMatch(
        /\(v_res->>'orden_borrada'\)::BOOLEAN IS NOT TRUE\s+OR \(v_res->>'orden_conservada'\)::BOOLEAN IS NOT FALSE\s+OR EXISTS \(SELECT 1 FROM ordenes_servicio WHERE id = v_orden_a\)/
      )
    })

    it("rollback cleans the practices with the function before dropping it", () => {
      const limpieza = ROLLBACK.indexOf("borrar_datos_practica(o.id)")
      const drop = ROLLBACK.indexOf("DROP FUNCTION IF EXISTS borrar_datos_practica(TEXT);")
      expect(limpieza).toBeGreaterThan(-1)
      expect(drop).toBeGreaterThan(limpieza)
    })
  })
})
