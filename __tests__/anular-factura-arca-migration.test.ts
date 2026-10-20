// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/371_probes.sql covers the runtime, against the real schema). Files resolve by
// suffix or marker, never by number, so the renumber at merge time breaks nothing.

const migRaw = () => readBySuffix("_anular_factura_arca.sql")
const rollbackRaw = () => readByMarker("rollback", "Rollback of anular_factura_arca")
const probesRaw = () => readByMarker("verify", "Verification of anular_factura_arca")
const m329Raw = () => readBySuffix("_ventas_protegen_comprobantes.sql")

const abreTransaccion = (sql: string) =>
  /^\s*BEGIN\s*;/im.test(sql.split("\n").slice(0, 40).join("\n"))

/** Collapsed body of `proteger_anulacion_venta()` (the text between the `$$` quotes). */
function triggerBody(raw: string): string {
  const m = /CREATE OR REPLACE FUNCTION proteger_anulacion_venta\(\) RETURNS TRIGGER AS \$\$ (.*?) \$\$ LANGUAGE plpgsql;/.exec(
    collapse(raw)
  )
  if (!m) throw new Error("proteger_anulacion_venta() not found")
  return m[1]
}

const PREDICATE_329 = "WHERE venta_id = NEW.id AND estado IN ('pendiente', 'emitido')) THEN"
const PREDICATE_371 =
  "WHERE venta_id = NEW.id AND estado IN ('pendiente', 'emitido') AND comprobante_asociado_id IS NULL) THEN"
const MESSAGE_329 =
  "'VENTA_NO_ANULABLE: La venta tiene una factura electrónica emitida: para anularla hay que emitir una nota de crédito en ARCA. Registrá la devolución de los productos.'"
const MESSAGE_371 =
  "'VENTA_NO_ANULABLE: La venta tiene una factura electrónica emitida: anulala primero con \"Anular factura\" en el bloque Factura electrónica.'"

describe("371: transaction hygiene", () => {
  it("starts with SET LOCAL lock_timeout and opens no transaction of its own", () => {
    expect(collapse(migRaw()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(abreTransaccion(migRaw())).toBe(false)
    expect(stripComments(migRaw())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("aborts before touching anything when 370 (cbte_tipo) is missing or an NC-like row already exists", () => {
    const sql = collapse(migRaw())
    expect(sql).toContain("column_name = 'cbte_tipo'")
    expect(sql).toContain("RAISE EXCEPTION 'Abort: falta comprobantes_fiscales.cbte_tipo")
    expect(sql).toMatch(/WHERE cbte_tipo IN \(8, 13\)/)
    expect(sql.indexOf("Abort: falta")).toBeLessThan(sql.indexOf("ALTER TABLE comprobantes_fiscales"))
  })

  it("aborts when another CHECK mentions estado: the estado rebuild would leave it stale", () => {
    const sql = collapse(migRaw())
    // multi-column CHECKs that mention estado, except the two this migration owns
    expect(sql).toContain("conkey IS DISTINCT FROM ARRAY[v_attnum]")
    expect(sql).toContain("conname NOT IN ('comprobantes_fiscales_nc_check', 'comprobantes_fiscales_anulado_check')")
    expect(sql).toContain("pg_get_constraintdef(oid) ~ '\\mestado\\M'")
    expect(sql).toContain("RAISE EXCEPTION 'Abort: otra CHECK de comprobantes_fiscales menciona estado")
    expect(sql.indexOf("Abort: otra CHECK")).toBeLessThan(sql.indexOf("ALTER TABLE comprobantes_fiscales"))
  })

  it("documents the runbook to release a stuck pendiente NC, with the ARCA check first", () => {
    const header = migRaw().slice(0, migRaw().indexOf("SET LOCAL lock_timeout"))
    expect(header).toContain("RUNBOOK")
    expect(header).toContain("Mis Comprobantes")
    expect(header).toMatch(/UPDATE comprobantes_fiscales\n--\s+SET estado = 'rechazado', error_msg = /)
    expect(header).toMatch(/WHERE id = '<nc id>' AND estado = 'pendiente' AND comprobante_asociado_id IS NOT NULL;/)
    // the warning must come before the statement
    expect(header.indexOf("NOT authorized")).toBeLessThan(header.indexOf("SET estado = 'rechazado'"))
  })

  it("does not claim that bloqueos.ts already repeats the text: PR4/PR5 align it", () => {
    expect(migRaw()).not.toMatch(/bloqueos\.ts repeats the same text/)
    expect(migRaw()).toMatch(/PR4\/PR5/)
  })
})

describe("371: the columns", () => {
  it("adds the five columns in one guarded ALTER: all nullable, no DEFAULT, no inline CHECK", () => {
    expect(collapse(migRaw())).toContain(
      "ALTER TABLE comprobantes_fiscales " +
        "ADD COLUMN IF NOT EXISTS comprobante_asociado_id TEXT REFERENCES comprobantes_fiscales(id), " +
        "ADD COLUMN IF NOT EXISTS cbte_nro_solicitado INTEGER, " +
        "ADD COLUMN IF NOT EXISTS motivo TEXT, " +
        "ADD COLUMN IF NOT EXISTS motivo_detalle TEXT, " +
        "ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMPTZ;"
    )
  })

  it("the self reference is NO ACTION (no ON DELETE): factura and NC die in the same org cascade", () => {
    expect(collapse(migRaw())).not.toMatch(/REFERENCES comprobantes_fiscales\(id\) ON DELETE/)
  })
})

describe("371: constraints", () => {
  it("rebuilds the estado CHECK whatever its name (by conkey) and adds 'anulado'", () => {
    const sql = collapse(migRaw())
    expect(sql).toContain("conkey")
    expect(sql).toContain("DROP CONSTRAINT")
    expect(sql).toContain(
      "ADD CONSTRAINT comprobantes_fiscales_estado_check CHECK (estado IN ('pendiente', 'emitido', 'rechazado', 'anulado'));"
    )
  })

  it("the NC check ties NC columns to comprobante_asociado_id and guards every nullable comparison", () => {
    const sql = collapse(migRaw())
    const m = /ADD CONSTRAINT comprobantes_fiscales_nc_check CHECK \((.*?)\);/.exec(sql)
    expect(m, "nc_check not found").not.toBeNull()
    const body = m![1]
    // factura side: nothing NC-ish
    expect(body).toContain("comprobante_asociado_id IS NULL")
    expect(body).toContain("(cbte_tipo IS NULL OR cbte_tipo NOT IN (8, 13))")
    expect(body).toContain("motivo IS NULL")
    expect(body).toContain("cbte_nro_solicitado IS NULL")
    // NC side. A CHECK passes on NULL, so each nullable comparison needs its own IS NOT NULL.
    expect(body).toContain("comprobante_asociado_id IS NOT NULL")
    expect(body).toContain("comprobante_asociado_id <> id")
    // ARCA numbers per CUIT + PV + type: an NC must carry the issuer CUIT (11 digits, like the 370 column)
    expect(body).toContain("cuit_emisor IS NOT NULL AND cuit_emisor ~ '^[0-9]{11}$'")
    expect(body).toContain("cbte_tipo IS NOT NULL AND cbte_tipo = CASE tipo WHEN 'B' THEN 8 WHEN 'C' THEN 13 END")
    expect(body).toContain("cbte_nro_solicitado IS NOT NULL AND cbte_nro_solicitado > 0")
    expect(body).toContain("estado <> 'anulado'")
    expect(body).toContain("motivo IS NOT NULL AND motivo IN ('error_factura', 'devolucion_total', 'otro')")
    expect(body).toContain("motivo <> 'otro' OR length(btrim(COALESCE(motivo_detalle, ''))) > 0")
    expect(body).toContain("motivo_detalle IS NULL OR length(motivo_detalle) <= 500")
  })

  it("estado = 'anulado' if and only if anulado_at is set", () => {
    expect(collapse(migRaw())).toContain(
      "ADD CONSTRAINT comprobantes_fiscales_anulado_check CHECK ((estado = 'anulado') = (anulado_at IS NOT NULL));"
    )
  })
})

describe("371: indexes", () => {
  const sql = () => collapse(migRaw())

  it("one active FACTURA per venta: the old index is replaced by one that ignores NC rows", () => {
    expect(sql()).toContain("DROP INDEX IF EXISTS uq_comprobante_venta_activo;")
    expect(sql()).toContain(
      "CREATE UNIQUE INDEX uq_comprobante_venta_activo ON comprobantes_fiscales(venta_id) " +
        "WHERE estado IN ('pendiente', 'emitido') AND comprobante_asociado_id IS NULL;"
    )
    expect(sql().indexOf("DROP INDEX IF EXISTS uq_comprobante_venta_activo")).toBeLessThan(
      sql().indexOf("CREATE UNIQUE INDEX uq_comprobante_venta_activo")
    )
  })

  it("one active NC per factura", () => {
    expect(sql()).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobante_nc_activa ON comprobantes_fiscales(comprobante_asociado_id) " +
        "WHERE comprobante_asociado_id IS NOT NULL AND estado IN ('pendiente', 'emitido');"
    )
  })

  it("one in-flight NC per issuer CUIT, point of sale and type (ARCA numbers by CUIT, not by org)", () => {
    expect(sql()).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobante_nc_en_vuelo ON comprobantes_fiscales(cuit_emisor, punto_venta, cbte_tipo) " +
        "WHERE comprobante_asociado_id IS NOT NULL AND estado = 'pendiente';"
    )
    expect(sql()).not.toMatch(/uq_comprobante_nc_en_vuelo ON comprobantes_fiscales\(organization_id/)
  })

  it("one emitted NC per issuer CUIT, point of sale, type and number", () => {
    expect(sql()).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobante_nc_numero ON comprobantes_fiscales(cuit_emisor, punto_venta, cbte_tipo, numero) " +
        "WHERE comprobante_asociado_id IS NOT NULL AND estado = 'emitido';"
    )
  })

  it("a plain index on comprobante_asociado_id serves the self-FK lookups", () => {
    expect(sql()).toContain(
      "CREATE INDEX IF NOT EXISTS idx_comprobantes_asociado ON comprobantes_fiscales(comprobante_asociado_id);"
    )
  })
})

describe("371: proteger_anulacion_venta", () => {
  it("is the 329 body with ONLY the factura-only predicate and the new message", () => {
    const old = triggerBody(m329Raw())
    // the replacements must really exist in 329, otherwise this test proves nothing
    expect(old).toContain(PREDICATE_329)
    expect(old).toContain(MESSAGE_329)
    const expected = old.replace(PREDICATE_329, PREDICATE_371).replace(MESSAGE_329, MESSAGE_371)
    expect(triggerBody(migRaw())).toBe(expected)
  })

  it("keeps the P0022 error code and the remito rule untouched", () => {
    const body = triggerBody(migRaw())
    expect(body.match(/USING ERRCODE = 'P0022'/g)).toHaveLength(2)
    expect(body).toContain("FROM facturas WHERE venta_id = NEW.id AND estado_pago::text <> 'ANULADA'")
    expect(body).toContain("La venta tiene un remito vigente: anulalo primero desde Facturación.")
  })

  it("does not recreate or drop the trigger or the FKs (329 already owns them)", () => {
    const sql = collapse(migRaw())
    expect(sql).not.toMatch(/CREATE TRIGGER|DROP TRIGGER/i)
    expect(sql).not.toMatch(/facturas_venta_id_fkey|comprobantes_fiscales_venta_id_fkey/)
  })
})

describe("371: confirmar_nota_credito_fiscal", () => {
  const sql = () => collapse(migRaw())
  const SIGNATURE = "public.confirmar_nota_credito_fiscal(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)"

  it("has the agreed signature and returns JSONB", () => {
    expect(sql()).toMatch(
      /CREATE OR REPLACE FUNCTION public\.confirmar_nota_credito_fiscal\( p_org_id TEXT, p_nc_id TEXT, p_numero TEXT, p_cae TEXT, p_cae_vencimiento TEXT, p_provider_response JSONB \) RETURNS JSONB/
    )
  })

  it("is SECURITY INVOKER (never DEFINER) with a pinned search_path", () => {
    expect(sql()).not.toMatch(/SECURITY DEFINER/i)
    expect(sql()).toContain("SET search_path = public, pg_temp")
  })

  it("locks the NC first and the factura second, both org scoped", () => {
    const body = sql()
    const nc = body.indexOf("INTO v_nc FROM comprobantes_fiscales WHERE id = p_nc_id AND organization_id = p_org_id FOR UPDATE")
    const fa = body.indexOf("INTO v_fa FROM comprobantes_fiscales WHERE id = v_nc.comprobante_asociado_id AND organization_id = p_org_id FOR UPDATE")
    expect(nc).toBeGreaterThan(0)
    expect(fa).toBeGreaterThan(nc)
  })

  it("flips the NC to emitido and the factura to anulado with anulado_at, never touching ventas", () => {
    const body = sql()
    expect(body).toMatch(/UPDATE comprobantes_fiscales SET estado = 'emitido', numero = p_numero, cae = p_cae, cae_vencimiento = p_cae_vencimiento, provider_response = p_provider_response, error_msg = NULL WHERE id = v_nc\.id/)
    expect(body).toMatch(/UPDATE comprobantes_fiscales SET estado = 'anulado', anulado_at = now\(\) WHERE id = v_fa\.id/)
    expect(body).not.toMatch(/UPDATE (ventas|inventario|movimientos_caja|cuenta_corriente)/i)
  })

  it("raises the agreed messages", () => {
    for (const msg of [
      "Nota de crédito no encontrada",
      "La nota de crédito ya está emitida con otro CAE",
      "La factura asociada no está emitida",
      "La factura asociada no corresponde a la venta o al tipo de la nota de crédito",
      "Faltan el número, el CAE o su vencimiento",
      "El número de la nota de crédito no coincide con el pedido a ARCA",
    ]) {
      expect(sql(), msg).toContain(`RAISE EXCEPTION '${msg}'`)
    }
  })

  it("confirms an NC in pendiente OR rechazado: ARCA may have authorized a send we gave up on", () => {
    const body = sql()
    // only 'emitido' is special (replay); there is no state check left that refuses a rechazada NC
    expect(body).toContain("IF v_nc.estado = 'emitido' THEN")
    expect(body).not.toMatch(/ELSIF v_nc\.estado <> 'pendiente'/)
    expect(body).not.toContain("La nota de crédito no está pendiente")
  })

  it("relies on the unique indexes (23505) when a newer active NC exists, instead of re-checking", () => {
    const body = sql()
    // the NC is flipped by a plain UPDATE: uq_comprobante_nc_activa / uq_comprobante_nc_numero decide
    expect(body).not.toMatch(/EXCEPTION\s+WHEN\s+unique_violation/i)
    expect(body).toMatch(/UPDATE comprobantes_fiscales SET estado = 'emitido', numero = p_numero/)
  })

  it("checks that the number is PPPP-NNNNNNNN, with the NC's own point of sale and requested number", () => {
    const body = sql()
    expect(body).toContain("p_numero ~ '^[0-9]{1,5}-[0-9]{1,8}$'")
    expect(body).toContain("split_part(p_numero, '-', 1)::INTEGER = v_nc.punto_venta")
    expect(body).toContain("split_part(p_numero, '-', 2)::INTEGER = v_nc.cbte_nro_solicitado")
    // the regex guards the casts: it must be evaluated before them (separate statements, not one OR)
    expect(body.indexOf("p_numero ~ '^[0-9]{1,5}-[0-9]{1,8}$'")).toBeLessThan(body.indexOf("split_part(p_numero"))
    expect(body.indexOf("split_part(p_numero")).toBeLessThan(body.indexOf("IF v_nc.estado = 'emitido' THEN"))
  })

  it("is for service_role only", () => {
    expect(sql()).toContain(
      `REVOKE EXECUTE ON FUNCTION ${SIGNATURE} FROM PUBLIC, anon, authenticated;`
    )
    expect(sql()).toContain(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO service_role;`)
    expect(sql()).toContain(`COMMENT ON FUNCTION ${SIGNATURE} IS`)
  })
})

describe("371 rollback", () => {
  const sql = () => collapse(rollbackRaw())

  it("opens no transaction of its own and bounds the lock wait", () => {
    expect(abreTransaccion(rollbackRaw())).toBe(false)
    expect(stripComments(rollbackRaw())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
    expect(sql().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
  })

  it("locks the table right after the lock_timeout, so no NC can slip in between the guard and the drops", () => {
    expect(sql().startsWith("SET LOCAL lock_timeout = '3s'; LOCK TABLE comprobantes_fiscales IN ACCESS EXCLUSIVE MODE;")).toBe(true)
  })

  it("deletes rechazada NC rows (no fiscal effect) before the guard, then refuses on any live NC or annulled factura", () => {
    const body = sql()
    expect(body).toContain("DELETE FROM comprobantes_fiscales WHERE estado = 'rechazado' AND comprobante_asociado_id IS NOT NULL;")
    // the guard keeps looking at every NC left (pendiente or emitido) and at annulled facturas
    expect(body).toContain("WHERE comprobante_asociado_id IS NOT NULL OR estado = 'anulado'")
    expect(body).toContain("RAISE EXCEPTION 'Abort:")
    expect(body.indexOf("DELETE FROM comprobantes_fiscales")).toBeLessThan(body.indexOf("RAISE EXCEPTION 'Abort:"))
    expect(body.indexOf("RAISE EXCEPTION 'Abort:")).toBeLessThan(body.indexOf("DROP FUNCTION"))
  })

  it("says what the rollback loses (the rechazada NC attempts) and how to export them", () => {
    const header = rollbackRaw().slice(0, rollbackRaw().indexOf("SET LOCAL lock_timeout"))
    expect(header).toMatch(/rechazad/i)
    expect(header).toContain("SELECT")
  })

  it("drops the RPC, restores the 329 trigger body verbatim, the old index and the old CHECK, drops the columns", () => {
    const body = sql()
    expect(body).toContain("DROP FUNCTION IF EXISTS public.confirmar_nota_credito_fiscal(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB);")
    expect(triggerBody(rollbackRaw())).toBe(triggerBody(m329Raw()))
    expect(body).toContain("DROP INDEX IF EXISTS uq_comprobante_nc_en_vuelo;")
    expect(body).toContain("DROP INDEX IF EXISTS uq_comprobante_nc_numero;")
    expect(body).toContain("DROP INDEX IF EXISTS uq_comprobante_nc_activa;")
    expect(body).toContain("DROP INDEX IF EXISTS idx_comprobantes_asociado;")
    expect(body).toContain(
      "CREATE UNIQUE INDEX uq_comprobante_venta_activo ON comprobantes_fiscales(venta_id) WHERE estado IN ('pendiente', 'emitido');"
    )
    expect(body).toContain("DROP CONSTRAINT IF EXISTS comprobantes_fiscales_nc_check")
    expect(body).toContain("DROP CONSTRAINT IF EXISTS comprobantes_fiscales_anulado_check")
    expect(body).toContain(
      "ADD CONSTRAINT comprobantes_fiscales_estado_check CHECK (estado IN ('pendiente', 'emitido', 'rechazado'));"
    )
    for (const col of ["anulado_at", "motivo_detalle", "motivo", "cbte_nro_solicitado", "comprobante_asociado_id"]) {
      expect(body, col).toMatch(new RegExp(`DROP COLUMN IF EXISTS ${col}\\b`))
    }
  })

  it("restores the old index only after the new ones are gone, and drops constraints before columns", () => {
    const body = sql()
    expect(body.indexOf("DROP INDEX IF EXISTS uq_comprobante_nc_activa")).toBeLessThan(
      body.indexOf("CREATE UNIQUE INDEX uq_comprobante_venta_activo")
    )
    expect(body.indexOf("DROP CONSTRAINT IF EXISTS comprobantes_fiscales_nc_check")).toBeLessThan(
      body.indexOf("DROP COLUMN IF EXISTS anulado_at")
    )
  })
})

describe("371 probes", () => {
  it("open their own transaction in the first 40 lines and always end in ROLLBACK", () => {
    expect(abreTransaccion(probesRaw())).toBe(true)
    expect(probesRaw().trimEnd()).toMatch(/ROLLBACK;$/)
  })

  it("use a scratch organization plus a foreign one, and prove isolation by name", () => {
    const sql = probesRaw()
    expect(sql).toContain("org-probe-371")
    expect(sql).toContain("org-probe-371-x")
  })

  it("exercise every index, CHECK, trigger branch and RPC outcome the migration adds", () => {
    const sql = probesRaw()
    for (const expected of [
      "23505 uq_comprobante_venta_activo",
      "23505 uq_comprobante_nc_activa",
      "23505 uq_comprobante_nc_en_vuelo",
      "23505 uq_comprobante_nc_numero",
      "23514 comprobantes_fiscales_nc_check",
      "23514 comprobantes_fiscales_anulado_check",
      "23514 comprobantes_fiscales_estado_check",
      "P0022 VENTA_NO_ANULABLE",
      "Nota de crédito no encontrada",
      "La nota de crédito ya está emitida con otro CAE",
      "La factura asociada no está emitida",
      "La factura asociada no corresponde a la venta o al tipo de la nota de crédito",
      "Faltan el número, el CAE o su vencimiento",
      "El número de la nota de crédito no coincide con el pedido a ARCA",
    ]) {
      expect(sql, expected).toContain(expected)
    }
  })

  it("no longer expects a rechazada NC to be refused: it proves the late confirmation instead", () => {
    const sql = probesRaw()
    expect(sql).not.toContain("La nota de crédito no está pendiente")
    expect(sql).toContain("NC rechazada confirmada tarde")
    expect(sql).toContain("NC rechazada confirmada tarde mientras hay otra NC activa de la factura")
  })

  it("seed the awkward rows: a workshop NC linked to another org's factura, a legacy tusfacturas factura, a foreign org", () => {
    const sql = probesRaw()
    expect(sql).toMatch(/pg_temp\.nc\('nc-p371-xlink', 'fac-p371-x1'/)
    expect(sql).toMatch(/p_provider => 'tusfacturas', p_cuit => NULL, p_cbte_tipo => NULL/)
    expect(sql).toMatch(/p_org => 'org-probe-371-x'/)
  })

  it("every venta annulment probe also reads ventas.estado afterwards", () => {
    const sql = probesRaw()
    expect(sql).toContain("CREATE PROCEDURE pg_temp.probe_anular")
    expect(sql).toMatch(/'ok \/ ANULADA'/)
    expect(sql).toMatch(/\/ COMPLETADA'/)
    // no trigger probe goes through the estado-less helper
    expect(sql).not.toMatch(/CALL pg_temp\.probe\([^)]*UPDATE ventas/)
  })

  it("end with a single result set and a count probe", () => {
    const sql = probesRaw()
    expect(sql).toMatch(/SELECT orden, probe, esperado, obtenido,[\s\S]*FROM _r ORDER BY orden;\s*ROLLBACK;\s*$/)
    expect(sql).toMatch(/filas de los probes/)
  })
})
