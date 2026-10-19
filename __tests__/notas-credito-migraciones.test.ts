// @vitest-environment node
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "fs"
import { join } from "path"

// Las migraciones se aplican a mano con scripts/db-run.mjs y no hay Postgres en
// CI: las reglas viven en los probes (supabase/migrations/verify). Este test fija
// lo que vitest sí puede ver: que cada migración del grupo trae probes y
// rollback, y que ninguna abre su propia transacción. Lo último importa:
// db-run.mjs ejecuta TAL CUAL un archivo con BEGIN en sus primeras 40 líneas,
// así que `npm run db:dry` sobre una migración con BEGIN/COMMIT la aplicaría.
const MIGRACIONES = ["350_notas_credito_bases", "356_nc_numeracion_y_vista", "360_pendiente_orden", "365_nc_monto_ventas"]

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")
const existe = (rel: string) => existsSync(join(process.cwd(), rel))
const abreTransaccion = (sql: string) =>
  /^\s*BEGIN\s*;/im.test(sql.split("\n").slice(0, 40).join("\n"))

describe.each(MIGRACIONES)("migración %s", (nombre) => {
  const numero = nombre.slice(0, 3)
  const migracion = `supabase/migrations/${nombre}.sql`
  const probes = `supabase/migrations/verify/${numero}_probes.sql`
  const rollback = `supabase/migrations/rollback/${numero}_rollback.sql`

  it("trae probes y rollback", () => {
    expect(existe(migracion)).toBe(true)
    expect(existe(probes)).toBe(true)
    expect(existe(rollback)).toBe(true)
  })

  it("ni la migración ni el rollback abren su propia transacción", () => {
    expect(abreTransaccion(leer(migracion))).toBe(false)
    expect(leer(migracion)).not.toMatch(/^\s*COMMIT\s*;/im)
    expect(abreTransaccion(leer(rollback))).toBe(false)
    expect(leer(rollback)).not.toMatch(/^\s*COMMIT\s*;/im)
  })

  it("los probes abren su transacción en las primeras 40 líneas y la revierten", () => {
    const sql = leer(probes)
    expect(abreTransaccion(sql)).toBe(true)
    expect(sql.trimEnd()).toMatch(/ROLLBACK;$/)
  })
})

describe("350: contratos que el pre-flight y la app dan por hechos", () => {
  const sql = () => leer("supabase/migrations/350_notas_credito_bases.sql")

  it("aborta si queda alguna NC de venta", () => {
    expect(sql()).toMatch(/FROM notas_credito WHERE venta_id IS NOT NULL/)
    expect(sql()).toMatch(/RAISE EXCEPTION 'Abort:/)
  })

  it("reemplaza las constraints de la 186 sin IF EXISTS (falla fuerte si el nombre cambió)", () => {
    for (const nombre of ["notas_credito_motivo_check", "notas_credito_check", "notas_credito_orden_id_fkey"]) {
      expect(sql()).toContain(`DROP CONSTRAINT ${nombre};`)
    }
  })
})

describe("351: el deposito de los items de NC no bloquea la purga de una organizacion", () => {
  const sql = () => leer("supabase/migrations/351_nc_items_deposito_set_null.sql")
  const rollback = () => leer("supabase/migrations/rollback/351_rollback.sql")

  it("ni la migracion ni el rollback abren su propia transaccion", () => {
    expect(existe("supabase/migrations/351_nc_items_deposito_set_null.sql")).toBe(true)
    expect(existe("supabase/migrations/rollback/351_rollback.sql")).toBe(true)
    expect(abreTransaccion(sql())).toBe(false)
    expect(sql()).not.toMatch(/^\s*COMMIT\s*;/im)
    expect(abreTransaccion(rollback())).toBe(false)
    expect(rollback()).not.toMatch(/^\s*COMMIT\s*;/im)
  })

  it("reemplaza la FK sin IF EXISTS y la recrea con ON DELETE SET NULL", () => {
    expect(sql()).toContain(
      "ALTER TABLE items_nota_credito DROP CONSTRAINT items_nota_credito_deposito_id_fkey;"
    )
    expect(sql()).toMatch(
      /ADD CONSTRAINT items_nota_credito_deposito_id_fkey\s+FOREIGN KEY \(deposito_id\) REFERENCES depositos\(id\) ON DELETE SET NULL;/
    )
  })

  it("el rollback restaura la FK original, sin SET NULL", () => {
    expect(rollback()).toContain("DROP CONSTRAINT items_nota_credito_deposito_id_fkey;")
    expect(rollback()).toMatch(
      /ADD CONSTRAINT items_nota_credito_deposito_id_fkey\s+FOREIGN KEY \(deposito_id\) REFERENCES depositos\(id\);/
    )
    expect(rollback()).not.toMatch(/ON DELETE SET NULL/)
  })
})

describe("356: la ruta llama con la misma firma de siempre", () => {
  const sql = () => leer("supabase/migrations/356_nc_numeracion_y_vista.sql")

  it("renombra el cuerpo vigente (330) en vez de copiarlo", () => {
    expect(sql()).toMatch(
      /ALTER FUNCTION public\.registrar_devolucion_atomica\(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT\)\s+RENAME TO registrar_devolucion_nucleo;/
    )
  })

  it("el envoltorio conserva los 10 parametros y devuelve el numero", () => {
    expect(sql()).toMatch(/p_numero_devolucion\s+TEXT,/)
    expect(sql()).toMatch(/p_idempotency_key\s+TEXT DEFAULT NULL/)
    expect(sql()).toContain("get_next_nota_credito_number(p_org_id)")
    expect(sql()).toContain("jsonb_build_object('numero', v_numero)")
  })

  it("el nucleo no queda expuesto a anon ni authenticated", () => {
    expect(sql()).toMatch(/REVOKE EXECUTE ON FUNCTION public\.registrar_devolucion_nucleo\([^)]*\)\s+FROM PUBLIC, anon, authenticated;/)
    expect(sql()).toMatch(/GRANT EXECUTE ON FUNCTION public\.registrar_devolucion_nucleo\([^)]*\)\s+TO service_role;/)
  })

  it("el envoltorio tampoco: solo service_role", () => {
    expect(sql()).toMatch(/REVOKE EXECUTE ON FUNCTION public\.registrar_devolucion_atomica\([^)]*\)\s+FROM PUBLIC, anon, authenticated;/)
    expect(sql()).toMatch(/GRANT EXECUTE ON FUNCTION public\.registrar_devolucion_atomica\([^)]*\)\s+TO service_role;/)
  })

  it("la vista hereda RLS y no es legible con la anon key", () => {
    expect(sql()).toMatch(/CREATE VIEW v_notas_credito\s+WITH \(security_invoker = true\)/)
    expect(sql()).toMatch(/REVOKE ALL ON public\.v_notas_credito FROM PUBLIC, anon, authenticated;/)
    expect(sql()).toMatch(/GRANT SELECT ON public\.v_notas_credito TO service_role;/)
  })

  it("no toca los numeros ya asignados ni agrega foreign keys", () => {
    expect(sql()).not.toMatch(/UPDATE\s+(devoluciones_venta|notas_credito)/i)
    expect(sql()).not.toMatch(/REFERENCES/i)
  })

  it("el rollback quita la vista y restaura la funcion", () => {
    const rb = leer("supabase/migrations/rollback/356_rollback.sql")
    expect(rb).toContain("DROP VIEW IF EXISTS v_notas_credito;")
    expect(rb).toMatch(/RENAME TO registrar_devolucion_atomica;/)
  })
})

describe("360: pendiente de la orden con fuente unica", () => {
  const sql = () => leer("supabase/migrations/360_pendiente_orden.sql")
  const rollback = () => leer("supabase/migrations/rollback/360_rollback.sql")

  it("get_deuda_cliente_sucursal usa pendiente_orden y conserva el bloqueo a anon/authenticated", () => {
    expect(sql()).toContain("GREATEST(pendiente_orden(o.id), 0)")
    expect(sql()).toContain("REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM PUBLIC;")
    expect(sql()).toContain("REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM anon;")
    expect(sql()).toContain("REVOKE EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) FROM authenticated;")
    expect(sql()).toContain("GRANT EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) TO service_role;")
  })

  it("get_deuda_cliente_sucursal conserva el no-doble-conteo de la 318 y el filtro de estado de la 273", () => {
    expect(sql()).toMatch(/cc2\.tipo\s+=\s+'CARGO'/)
    expect(sql()).toMatch(/cc2\.referencia_tipo\s+=\s+'ORDEN'/)
    expect(sql()).toContain("AND o.estado IN ('REPARADO', 'ENTREGADO')")
    expect(sql()).toContain("AND o.estado_cobro IN ('PENDIENTE', 'PARCIAL')")
    expect(sql()).toContain("SECURITY DEFINER")
    expect(sql()).toContain("SET search_path = public")
  })

  it("recalcular_estado_cobro cuenta lo que bajaron las NC sin tocar total_cobrado", () => {
    expect(sql()).toContain("v_cubierto := v_total_cobrado + nc_aplicado_deuda_orden(p_orden_id);")
    expect(sql()).toContain("SET total_cobrado = v_total_cobrado,")
  })

  it("recalcular_estado_cobro conserva la regla GREATEST de la 345 (total_cobrado_orden) y el lock", () => {
    expect(sql()).toContain("v_total_cobrado := total_cobrado_orden(p_orden_id);")
    expect(sql()).toContain("PERFORM 1 FROM ordenes_servicio WHERE id = p_orden_id FOR UPDATE;")
    // La suma solo de cobros_orden es el cuerpo de la 068 que la 345 reemplazo.
    expect(sql()).not.toMatch(/SELECT COALESCE\(SUM\(monto\), 0\) INTO v_total_cobrado/)
  })

  it("no agrega foreign keys", () => {
    expect(sql()).not.toMatch(/REFERENCES/i)
  })

  it("el rollback restaura el cuerpo de la 345 (GREATEST) y el de la 318, y borra las funciones nuevas", () => {
    expect(rollback()).toContain("v_total_cobrado := total_cobrado_orden(p_orden_id);")
    expect(rollback()).toContain("PERFORM 1 FROM ordenes_servicio WHERE id = p_orden_id FOR UPDATE;")
    expect(rollback()).toContain("COALESCE(o.costo_final, 0) - COALESCE(o.descuento_cobro, 0) - COALESCE(o.total_cobrado, 0)")
    expect(rollback()).toContain("GRANT EXECUTE ON FUNCTION get_deuda_cliente_sucursal(TEXT, TEXT, TEXT) TO service_role;")
    expect(rollback()).toContain("DROP FUNCTION IF EXISTS pendiente_orden(TEXT);")
    expect(rollback()).toContain("DROP FUNCTION IF EXISTS nc_aplicado_deuda_orden(TEXT);")
  })
})

describe("365: NC por monto y egreso de caja adentro de la RPC", () => {
  const sql = () => leer("supabase/migrations/365_nc_monto_ventas.sql")
  const rollback = () => leer("supabase/migrations/rollback/365_rollback.sql")
  const FIRMA_10 = "TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT"
  const FIRMA_14 = `${FIRMA_10}, TEXT, NUMERIC, TEXT, BOOLEAN`
  const FIRMA_MONTO = "TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT"
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

  it("cambia la firma de 10 por la de 14 en la misma migracion: una sola candidata para PostgREST", () => {
    expect(sql()).toContain(`DROP FUNCTION public.registrar_devolucion_atomica(${FIRMA_10});`)
    expect(sql()).toMatch(/p_modo\s+TEXT\s+DEFAULT 'ITEMS'/)
    expect(sql()).toMatch(/p_registrar_egreso\s+BOOLEAN DEFAULT false/)
  })

  it("las dos funciones quedan solo para service_role", () => {
    for (const firma of [`registrar_devolucion_atomica(${FIRMA_14})`, `registrar_devolucion_monto(${FIRMA_MONTO})`]) {
      expect(sql()).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${esc(firma)}\\s+FROM PUBLIC, anon, authenticated;`))
      expect(sql()).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc(firma)}\\s+TO service_role;`))
    }
  })

  it("la FK nueva no traba la purga de la organizacion: ON DELETE SET NULL", () => {
    expect(sql()).toMatch(/ADD COLUMN IF NOT EXISTS devolucion_id TEXT REFERENCES devoluciones_venta\(id\) ON DELETE SET NULL;/)
  })

  it("el rollback vuelve a la firma de 10 con sus permisos y saca la columna", () => {
    expect(rollback()).toContain(`DROP FUNCTION IF EXISTS public.registrar_devolucion_atomica(${FIRMA_14});`)
    expect(rollback()).toMatch(/p_idempotency_key\s+TEXT DEFAULT NULL\s*\)\s*RETURNS JSONB/)
    expect(rollback()).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.registrar_devolucion_atomica\\(${esc(FIRMA_10)}\\)\\s+FROM PUBLIC, anon, authenticated;`))
    expect(rollback()).toContain("ALTER TABLE movimientos_caja DROP COLUMN IF EXISTS devolucion_id;")
  })
})
