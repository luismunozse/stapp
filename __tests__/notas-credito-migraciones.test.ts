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
const MIGRACIONES = ["350_notas_credito_bases", "356_nc_numeracion_y_vista", "360_pendiente_orden", "367_nc_monto_ventas", "368_nc_anuladas_no_cuentan", "369_nc_anular_venta"]

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

describe("367: NC por monto y egreso de caja adentro de la RPC", () => {
  const sql = () => leer("supabase/migrations/367_nc_monto_ventas.sql")
  const rollback = () => leer("supabase/migrations/rollback/367_rollback.sql")
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

  it("acota la espera de locks antes de tocar movimientos_caja: si no consigue el lock, aborta sin aplicar nada", () => {
    const s = sql()
    const lock = s.indexOf("SET LOCAL lock_timeout = '3s';")
    expect(lock).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(s.indexOf("ALTER TABLE movimientos_caja"))
  })

  it("el reintento con una clave ya usada en OTRA venta se rechaza en vez de devolver esa NC", () => {
    expect(sql()).toMatch(/IF v_existente\.venta_id <> p_venta_id THEN\s+RAISE EXCEPTION/)
  })

  it("por productos, el dialogo nuevo (manda el motivo) no deja una NC con reintegro y sin medio; sin motivo no cambia", () => {
    const items = sql().match(/IF v_modo = 'ITEMS' THEN([\s\S]*?)\n\s*ELSE\s*\n\s*v_res := registrar_devolucion_monto/)
    expect(items).not.toBeNull()
    expect(items![1]).toMatch(
      /IF NULLIF\(p_motivo_nc, ''\) IS NOT NULL[^;]*montoReembolso[^;]*NULLIF\(p_metodo_reembolso, ''\) IS NULL THEN\s+RAISE EXCEPTION 'Falta el medio de reintegro';/,
    )
  })

  it("el rollback vuelve a la firma de 10 con sus permisos y conserva el vinculo egreso-NC", () => {
    expect(rollback()).toContain(`DROP FUNCTION IF EXISTS public.registrar_devolucion_atomica(${FIRMA_14});`)
    expect(rollback()).toMatch(/p_idempotency_key\s+TEXT DEFAULT NULL\s*\)\s*RETURNS JSONB/)
    expect(rollback()).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.registrar_devolucion_atomica\\(${esc(FIRMA_10)}\\)\\s+FROM PUBLIC, anon, authenticated;`))
    // La columna y el indice quedan: con el codigo de la 356 nadie los escribe, y
    // borrarlos perderia que egreso salio de que NC (lo que el PR4 revierte).
    expect(rollback()).not.toMatch(/^\s*ALTER TABLE movimientos_caja DROP COLUMN/im)
    expect(rollback()).not.toMatch(/^\s*DROP INDEX[^;]*movimientos_caja_devolucion_tipo_unique/im)
  })
})

// ── Copias textuales (368) ─────────────────────────────────────────────────
// La 368 redefine cinco objetos copiando su ultima version con una lista
// contada de cambios, y su rollback los copia tal cual. Se compara sin
// comentarios ni espacios: los comentarios "-- 368: ..." son libres. Lo que se
// revisa en el PR son estas listas, no las copias.
const plano = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim()

function tramo(rel: string, desde: string, hasta: string, incluirHasta = true): string {
  const texto = leer(rel).replace(/\r\n/g, "\n")
  const i = texto.indexOf(desde)
  if (i < 0) throw new Error(`${rel}: no esta "${desde}"`)
  const j = texto.indexOf(hasta, i + desde.length)
  if (j < 0) throw new Error(`${rel}: no esta "${hasta}"`)
  return texto.slice(i, incluirHasta ? j + hasta.length : j)
}

type Cambios = ReadonlyArray<readonly [string, string]>

/** La copia esperada: el original con cada cambio aplicado exactamente una vez. */
function conCambios(original: string, cambios: Cambios): string {
  let out = plano(original)
  for (const [viejo, nuevo] of cambios) {
    const v = plano(viejo)
    const veces = out.split(v).length - 1
    if (veces !== 1) throw new Error(`"${v.slice(0, 60)}..." aparece ${veces} veces en el original`)
    out = out.replace(v, () => plano(nuevo))
  }
  return out
}

const NUCLEO_330 = () =>
  tramo("supabase/migrations/330_devolucion_descuenta_saldo.sql", "CREATE OR REPLACE FUNCTION public.registrar_devolucion_atomica(", "$function$;")
const PAGOS_331 = () =>
  tramo("supabase/migrations/331_cobros_venta_idempotencia_y_cliente.sql", "CREATE OR REPLACE FUNCTION registrar_pagos_venta_atomica(", "$$ LANGUAGE plpgsql;")
const TRIGGER_334 = () =>
  tramo("supabase/migrations/334_anular_venta_series_y_garantias.sql", "CREATE OR REPLACE FUNCTION restore_stock_on_cancel()", "$$ LANGUAGE plpgsql;")
const COMISIONES_333 = () =>
  tramo("supabase/migrations/333_comision_neta_de_devoluciones.sql", "CREATE OR REPLACE VIEW v_comisiones_ventas AS", "WHERE v.estado = 'COMPLETADA';")
const DRIFT_245 = () =>
  tramo("supabase/migrations/245_v_cc_drift.sql", "CREATE OR REPLACE VIEW v_cc_drift AS", "COMMENT ON VIEW v_cc_drift", false)

// Los cambios de cada copia, contados. Cada viejo tiene que aparecer exactamente una
// vez en el original (sin comentarios ni espacios); si no, conCambios tira.
const RENOMBRE = [
  "CREATE OR REPLACE FUNCTION public.registrar_devolucion_atomica(",
  "CREATE OR REPLACE FUNCTION public.registrar_devolucion_nucleo(",
] as const
const CAMBIOS_NUCLEO: Cambios = [
  RENOMBRE,
  [
    "v_cobertura DECIMAL := 0; BEGIN",
    "v_cobertura DECIMAL := 0; v_serie_ids TEXT[]; v_series JSONB; BEGIN",
  ],
  [
    "WHERE dv.venta_id = p_venta_id AND id2.item_venta_id = elem->>'itemVentaId';",
    "WHERE dv.venta_id = p_venta_id AND dv.anulada = false AND id2.item_venta_id = elem->>'itemVentaId';",
  ],
  [
    "WHERE dv3.venta_id = p_venta_id AND id3.item_venta_id = v_iv.id;",
    "WHERE dv3.venta_id = p_venta_id AND dv3.anulada = false AND id3.item_venta_id = v_iv.id;",
  ],
  [
    "INTO v_prior_refunded FROM devoluciones_venta WHERE venta_id = p_venta_id;",
    "INTO v_prior_refunded FROM devoluciones_venta WHERE venta_id = p_venta_id AND anulada = false;",
  ],
  [
    "INTO v_aplicado_prev FROM devoluciones_venta WHERE venta_id = p_venta_id;",
    "INTO v_aplicado_prev FROM devoluciones_venta WHERE venta_id = p_venta_id AND anulada = false;",
  ],
  [
    "WHERE dv4.venta_id = p_venta_id AND id4.item_venta_id = elem->>'itemVentaId';",
    "WHERE dv4.venta_id = p_venta_id AND dv4.anulada = false AND id4.item_venta_id = elem->>'itemVentaId';",
  ],
  [
    `IF (elem->>'restaurarStock')::boolean THEN
      UPDATE inventario_series
      SET estado = 'DISPONIBLE', fecha_venta = NULL, venta_id = NULL,
          cliente_id = NULL, fecha_garantia_vence = CASE
            WHEN COALESCE(v_line_warranty_days, 0) > 0 THEN NULL
            ELSE fecha_garantia_vence END, updated_at = now()
      WHERE id IN (
        SELECT id FROM inventario_series
        WHERE organization_id = p_org_id
          AND inventario_id   = v_inv_id
          AND venta_id        = p_venta_id
          AND estado::text   IN ('VENDIDO', 'GARANTIA_ACTIVA')
        ORDER BY fecha_venta DESC
        LIMIT (elem->>'cantidad')::integer
      );
    ELSE
      UPDATE inventario_series
      SET estado = 'DEVUELTO', fecha_garantia_vence = CASE
            WHEN COALESCE(v_line_warranty_days, 0) > 0 THEN NULL
            ELSE fecha_garantia_vence END, updated_at = now()
      WHERE id IN (
        SELECT id FROM inventario_series
        WHERE organization_id = p_org_id
          AND inventario_id   = v_inv_id
          AND venta_id        = p_venta_id
          AND estado::text   IN ('VENDIDO', 'GARANTIA_ACTIVA')
        ORDER BY fecha_venta DESC
        LIMIT (elem->>'cantidad')::integer
      );
    END IF;`,
    `SELECT COALESCE(array_agg(s.id), ARRAY[]::TEXT[]),
           COALESCE(jsonb_agg(jsonb_build_object(
             'id', s.id, 'numero_serie', s.numero_serie, 'estado', s.estado,
             'cliente_id', s.cliente_id, 'fecha_venta', s.fecha_venta,
             'fecha_garantia_vence', s.fecha_garantia_vence)), '[]'::jsonb)
    INTO v_serie_ids, v_series
    FROM (
      SELECT id, numero_serie, estado, cliente_id, fecha_venta, fecha_garantia_vence
      FROM inventario_series
      WHERE organization_id = p_org_id
        AND inventario_id   = v_inv_id
        AND venta_id        = p_venta_id
        AND estado::text   IN ('VENDIDO', 'GARANTIA_ACTIVA')
      ORDER BY fecha_venta DESC
      LIMIT (elem->>'cantidad')::integer
      FOR UPDATE
    ) s;

    IF (elem->>'restaurarStock')::boolean THEN
      UPDATE inventario_series
      SET estado = 'DISPONIBLE', fecha_venta = NULL, venta_id = NULL,
          cliente_id = NULL, fecha_garantia_vence = CASE
            WHEN COALESCE(v_line_warranty_days, 0) > 0 THEN NULL
            ELSE fecha_garantia_vence END, updated_at = now()
      WHERE id = ANY(v_serie_ids);
    ELSE
      UPDATE inventario_series
      SET estado = 'DEVUELTO', fecha_garantia_vence = CASE
            WHEN COALESCE(v_line_warranty_days, 0) > 0 THEN NULL
            ELSE fecha_garantia_vence END, updated_at = now()
      WHERE id = ANY(v_serie_ids);
    END IF;

    UPDATE items_devolucion
    SET series_devueltas = v_series
    WHERE id = (
      SELECT id FROM items_devolucion
      WHERE devolucion_id = v_dev_id
        AND item_venta_id = elem->>'itemVentaId'
        AND series_devueltas IS NULL
      ORDER BY id
      LIMIT 1
    );`,
  ],
]
const CAMBIOS_PAGOS: Cambios = [
  [
    "INTO v_aplicado_dev FROM devoluciones_venta WHERE venta_id = p_venta_id;",
    "INTO v_aplicado_dev FROM devoluciones_venta WHERE venta_id = p_venta_id AND anulada = false;",
  ],
]
const CAMBIOS_TRIGGER: Cambios = [
  [
    "WHERE dv.venta_id = NEW.id AND id2.item_venta_id = v_item.item_id;",
    "WHERE dv.venta_id = NEW.id AND dv.anulada = false AND id2.item_venta_id = v_item.item_id;",
  ],
]
const INVOKER_COMISIONES = [
  "CREATE OR REPLACE VIEW v_comisiones_ventas AS",
  "CREATE OR REPLACE VIEW v_comisiones_ventas WITH (security_invoker = true) AS",
] as const
const CAMBIOS_COMISIONES: Cambios = [INVOKER_COMISIONES, ["WHERE d.venta_id = v.id", "WHERE d.venta_id = v.id AND d.anulada = false"]]
const INVOKER_DRIFT = [
  "CREATE OR REPLACE VIEW v_cc_drift AS",
  "CREATE OR REPLACE VIEW v_cc_drift WITH (security_invoker = true) AS",
] as const
const CAMBIOS_DRIFT: Cambios = [
  INVOKER_DRIFT,
  ["WHERE dv.estado::text = 'COMPLETADA'", "WHERE dv.estado::text = 'COMPLETADA' AND dv.anulada = false"],
]

describe("368: las NC anuladas no cuentan en SQL y el nucleo registra las series", () => {
  const sql = () => leer("supabase/migrations/368_nc_anuladas_no_cuentan.sql")
  const rollback = () => leer("supabase/migrations/rollback/368_rollback.sql")
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

  it("el nucleo es la 330 con sus cambios contados: nombre, cinco filtros y las series del paso 6", () => {
    expect(plano(sql())).toContain(conCambios(NUCLEO_330(), CAMBIOS_NUCLEO))
  })

  it("cobros (331), anular venta (334), comision (333) y reconciliacion (245): copias con su filtro", () => {
    expect(plano(sql())).toContain(conCambios(PAGOS_331(), CAMBIOS_PAGOS))
    expect(plano(sql())).toContain(conCambios(TRIGGER_334(), CAMBIOS_TRIGGER))
    expect(plano(sql())).toContain(conCambios(COMISIONES_333(), CAMBIOS_COMISIONES))
    expect(plano(sql())).toContain(conCambios(DRIFT_245(), CAMBIOS_DRIFT))
  })

  it("la FK de items_devolucion a inventario pasa a SET NULL, sin IF EXISTS", () => {
    expect(sql()).toContain("ALTER TABLE items_devolucion DROP CONSTRAINT items_devolucion_inventario_id_fkey;")
    expect(sql()).toMatch(
      /ADD CONSTRAINT items_devolucion_inventario_id_fkey\s+FOREIGN KEY \(inventario_id\) REFERENCES inventario\(id\) ON DELETE SET NULL;/
    )
  })

  it("lock_timeout antes del primer ALTER", () => {
    const s = sql()
    expect(s.indexOf("SET LOCAL lock_timeout = '3s';")).toBeGreaterThan(-1)
    expect(s.indexOf("SET LOCAL lock_timeout = '3s';")).toBeLessThan(s.indexOf("ALTER TABLE items_devolucion"))
  })

  it("el cambio de la FK va al final: el ACCESS EXCLUSIVE sobre inventario dura lo minimo", () => {
    const s = sql()
    const fk = s.indexOf("ALTER TABLE items_devolucion DROP CONSTRAINT items_devolucion_inventario_id_fkey;")
    expect(fk).toBeGreaterThan(s.lastIndexOf("CREATE OR REPLACE"))
    expect(fk).toBeGreaterThan(s.lastIndexOf("GRANT "))
  })

  it("nucleo, cobros y el trigger de anular la venta solo para service_role; las vistas sin acceso para anon ni authenticated", () => {
    for (const firma of [
      "registrar_devolucion_nucleo(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)",
      "registrar_pagos_venta_atomica(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT)",
      "restore_stock_on_cancel()",
    ]) {
      expect(sql()).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${esc(firma)}\\s+FROM PUBLIC, anon, authenticated;`))
      expect(sql()).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc(firma)}\\s+TO service_role;`))
    }
    for (const vista of ["v_comisiones_ventas", "v_cc_drift"]) {
      expect(sql()).toContain(`REVOKE ALL ON public.${vista} FROM PUBLIC, anon, authenticated;`)
      expect(sql()).toContain(`GRANT SELECT ON public.${vista} TO service_role;`)
    }
  })

  it("el rollback vuelve a las versiones anteriores tal cual", () => {
    const r = plano(rollback())
    expect(r).toContain(conCambios(NUCLEO_330(), [RENOMBRE]))
    expect(r).toContain(plano(PAGOS_331()))
    expect(r).toContain(plano(TRIGGER_334()))
    expect(r).toContain(conCambios(COMISIONES_333(), [INVOKER_COMISIONES]))
    expect(r).toContain(conCambios(DRIFT_245(), [INVOKER_DRIFT]))
  })

  it("el rollback no corre con NC anuladas ni con la 369, y no deshace la columna ni la FK", () => {
    expect(rollback()).toContain("IF EXISTS (SELECT 1 FROM devoluciones_venta WHERE anulada) THEN")
    expect(rollback()).toContain("to_regprocedure('public.anular_devolucion_venta(text,text,text,text,text)') IS NOT NULL")
    expect(rollback()).not.toMatch(/DROP COLUMN/i)
    expect(rollback()).not.toMatch(/DROP CONSTRAINT/i)
  })
})

describe("369: anular una NC de venta", () => {
  const sql = () => leer("supabase/migrations/369_nc_anular_venta.sql")
  const rollback = () => leer("supabase/migrations/rollback/369_rollback.sql")
  const FIRMA = "anular_devolucion_venta(TEXT, TEXT, TEXT, TEXT, TEXT)"
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

  it("crea una sola funcion nueva, sin OR REPLACE: un segundo apply falla y no cambia nada", () => {
    expect(sql()).toContain("CREATE FUNCTION public.anular_devolucion_venta(")
    expect(sql()).not.toMatch(/CREATE OR REPLACE FUNCTION/i)
  })

  it("solo service_role la ejecuta", () => {
    expect(sql()).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${esc(FIRMA)}\\s+FROM PUBLIC, anon, authenticated;`))
    expect(sql()).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc(FIRMA)}\\s+TO service_role;`))
  })

  it("aborta sin la 368", () => {
    expect(sql()).toContain("Aplicar la 368 antes de la 369.")
  })

  it("bloquea la venta antes de mirar la NC y anula de la mas reciente a la primera, por numero", () => {
    const s = sql()
    expect(s.indexOf("FOR UPDATE")).toBeLessThan(s.indexOf("IF v_dev.anulada THEN"))
    // created_at es now(), el inicio de la transaccion: no sigue el orden del lock de la venta.
    expect(s).toMatch(/WHERE venta_id = p_venta_id AND anulada = false\s+ORDER BY numero_devolucion COLLATE "C" DESC\s+LIMIT 1;/)
    expect(s).not.toMatch(/ORDER BY created_at DESC/)
  })

  it("el egreso que grababa la ruta se busca por su concepto exacto, su monto y su fecha, entre los que no tienen enlace", () => {
    expect(sql()).toContain("AND metodo_pago = 'EFECTIVO' AND concepto = 'Devolución ' || v_dev.numero_devolucion")
    expect(sql()).toContain("WHERE organization_id = p_org_id AND tipo = 'EGRESO' AND devolucion_id IS NULL")
    expect(sql()).toContain("AND monto = v_reembolso AND created_at >= v_dev.created_at")
  })

  it("valida las series antes que el stock, con los locks en el orden de la venta: inventario antes que series", () => {
    const s = sql()
    const lockInventario = s.search(/PERFORM 1 FROM inventario\s+WHERE organization_id = p_org_id/)
    expect(lockInventario).toBeGreaterThan(0)
    expect(lockInventario).toBeLessThan(s.indexOf("SELECT * INTO v_actual FROM inventario_series"))
    expect(s.indexOf("ya no está como la dejó la nota de crédito")).toBeLessThan(s.indexOf("No hay stock de"))
  })

  it("los probes van del 1 al 30 sin huecos y el ultimo cuenta que no falte ninguna fila", () => {
    const probes = leer("supabase/migrations/verify/369_probes.sql")
    const numeros = [...probes.matchAll(/INSERT INTO _r (?:SELECT |VALUES \()(\d+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b)
    expect(numeros).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
    expect(probes).toMatch(/INSERT INTO _r SELECT 30, [^;]*FROM _r WHERE orden BETWEEN 1 AND 29;/)
  })

  it("los CARGO van con referencia a la venta: la anulacion de la venta (334) los neta", () => {
    expect(sql()).toMatch(
      /cargar_deuda_cuenta_corriente\(\s*p_org_id, v_venta\.cliente_id, v_dev\.monto_aplicado_deuda, 'VENTA', p_venta_id/
    )
    expect(sql()).toMatch(/cargar_deuda_cuenta_corriente\(\s*p_org_id, v_venta\.cliente_id, v_reembolso, 'VENTA', p_venta_id/)
  })

  it("el rollback solo borra la funcion", () => {
    expect(rollback()).toContain(`DROP FUNCTION IF EXISTS public.${FIRMA};`)
    expect(plano(rollback()).match(/\b(DROP|ALTER|CREATE|UPDATE|DELETE|INSERT)\b/g)).toEqual(["DROP"])
  })
})
