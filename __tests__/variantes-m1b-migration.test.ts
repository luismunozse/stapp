// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// M1b (guardar_grupo_variantes) is applied by hand and there is no Postgres in CI: this pins
// by text what vitest cannot execute. verify/NNN-M1b_probes.sql covers the runtime behavior.

const RAW = readBySuffix("_variantes_rpc.sql")
const SQL = collapse(RAW)
// The header prose (everything before the first statement), wrapped comment lines joined.
const HEADER = RAW.slice(0, RAW.indexOf("SET LOCAL lock_timeout")).replace(/\n--\s?/g, " ")
const SIGNATURE = "guardar_grupo_variantes(TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, TEXT)"
const NINE_SHARED = [
  "descripcion", "categoria", "tipo_dispositivo", "proveedor", "proveedor_id",
  "dias_garantia_default", "trackea_lotes", "trackea_series", "dias_alerta_vencimiento",
]
const need = (re: RegExp, from = SQL) => {
  const m = re.exec(from)
  if (!m) throw new Error(`pattern not found: ${re}`)
  return m
}
const HEAD = need(/CREATE OR REPLACE FUNCTION (guardar_grupo_variantes\(.*?\)) RETURNS JSONB (.*?) AS \$\$/)
const BODY = need(/ AS \$\$(.*)\$\$;/)[1]
const at = (needle: string | RegExp, from = BODY) => {
  const i = typeof needle === "string" ? from.indexOf(needle) : from.search(needle)
  if (i < 0) throw new Error(`body is missing: ${needle}`)
  return i
}
const updates = [...BODY.matchAll(/UPDATE inventario(?: \w+)? SET (.*?);/g)].map((m) => m[0])
const setPart = (u: string) => u.split(" WHERE ")[0]

describe("M1b: file, signature and privileges", () => {
  it("starts with SET LOCAL lock_timeout and has no transaction of its own", () => {
    expect(SQL.startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(stripComments(RAW)).not.toMatch(/^\s*BEGIN\s*;/im)
    expect(SQL).not.toMatch(/\bCOMMIT\b/i)
  })

  it("defines exactly one function with the (org, user, group, shared, rows, archive, depot) signature", () => {
    expect(SQL.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1)
    const params = HEAD[1].replace(/\(\s+/, "(")
    expect(params).toBe("guardar_grupo_variantes(p_org TEXT, p_user TEXT, p_grupo JSONB, p_compartidos JSONB, p_variantes JSONB, p_archivar JSONB, p_deposito_inicial TEXT)")
    expect(params.replace(/\bp_\w+ /g, "")).toBe(SIGNATURE)
  })

  it("is SECURITY INVOKER with a fixed search_path (no DEFINER, no elevated rights)", () => {
    expect(HEAD[2]).toContain("SECURITY INVOKER")
    expect(HEAD[2]).toContain("SET search_path = public, pg_temp")
    expect(SQL).not.toMatch(/SECURITY DEFINER/i)
  })

  it("revokes EXECUTE from PUBLIC, anon and authenticated, then grants service_role only (new functions default to PUBLIC)", () => {
    const revoke = need(new RegExp(`REVOKE (?:ALL|EXECUTE) ON FUNCTION ${SIGNATURE.replace(/[()]/g, "\\$&")} FROM ([\\w, ]+);`))
    expect(revoke[1].split(",").map((s) => s.trim()).sort()).toEqual(["PUBLIC", "anon", "authenticated"])
    const grant = need(new RegExp(`GRANT EXECUTE ON FUNCTION ${SIGNATURE.replace(/[()]/g, "\\$&")} TO ([\\w, ]+);`))
    expect(grant[1].trim()).toBe("service_role")
    expect(SQL.indexOf(revoke[0])).toBeGreaterThan(SQL.indexOf("$$;"))
    expect(SQL.indexOf(grant[0])).toBeGreaterThan(SQL.indexOf(revoke[0]))
    expect(SQL.match(/\bGRANT\b/g)).toHaveLength(1)
  })

})

describe("M1b: the header says what the function really does", () => {
  it("org comes from the server session; 40P01 is the caller's retry; the lock statement itself is pinned", () => {
    expect(HEADER).toContain("p_org is the organization of the caller's SESSION")
    expect(HEADER).toMatch(/can still deadlock with this function \(40P01\): the caller \(lib\/variantes-api\) retries once/)
    expect(BODY).toContain("PERFORM 1 FROM inventario WHERE organization_id = p_org AND (id = ANY (v_ids || v_arch) OR grupo_id = v_gid) ORDER BY id FOR UPDATE;")
  })

  it("is a FULL-STATE save: every ACTIVE member is saved or archived, else miembros_faltantes", () => {
    expect(HEADER).toContain("FULL-STATE")
    expect(HEADER).toMatch(/every ACTIVE member of an existing group must be in p_variantes or in p_archivar/)
    expect(HEADER).toContain("PAYLOAD_INVALIDO:miembros_faltantes:<ids>")
  })

  it("states truthfully what still ends in a raw 23505: swaps and chains among EXISTING rows", () => {
    const limit = need(/KNOWN LIMIT\.(.*?)LOCK ORDER/, HEADER)[1]
    expect(limit).toMatch(/existing rows are written before new ones/)
    expect(limit).toMatch(/swap/)
    expect(limit).toMatch(/chain/)
    expect(limit).toContain("23505")
    expect(limit).not.toMatch(/free slot are fine/)
  })

  it("does not claim that an id of another organization is indistinguishable from a missing one", () => {
    expect(HEADER).not.toMatch(/exactly like a missing one/)
    expect(HEADER).toMatch(/NOT indistinguishable/)
    expect(HEADER).toMatch(/unguessable/)
  })

  it("warns that the DROP rehearsal in the probes blocks saves for a moment, so it runs before PR4 merges", () => {
    expect(HEADER).toMatch(/rollback rehearsal at the end of verify\/NNN-M1b_probes\.sql DROPs this function inside its transaction/)
    expect(HEADER).toMatch(/waits on that lock until the ROLLBACK/)
    expect(HEADER).toMatch(/before PR4 merges/)
  })
})

describe("M1b: images are never touched and nothing is recreated (PI-6 tripwire b)", () => {
  it("the body has no imagen_ column and no gallery table", () => {
    expect(BODY).not.toMatch(/imagen_/)
    expect(BODY).not.toContain("inventario_imagenes")
  })

  it("edits by id: no DELETE or TRUNCATE anywhere (removing a combination archives it)", () => {
    expect(SQL).not.toMatch(/\bDELETE\b|\bTRUNCATE\b/)
  })

  it("rejects any variante key outside a whitelist that has no image key", () => {
    const keys = need(/c_vkeys CONSTANT TEXT\[\] := ARRAY\[(.*?)\];/, BODY)[1]
    expect(keys).not.toMatch(/imagen|nombre|grupo/)
    expect(keys).toContain("'atributos'")
    expect(BODY).toMatch(/jsonb_object_keys\(e\.v\) k WHERE k <> ALL \(c_vkeys\)/)
  })
})

describe("M1b: validation raises clean errors before the 355 constraints can fire", () => {
  it("raises 22023, P0002 and P0030..P0035", () => {
    for (const code of ["22023", "P0002", "P0030", "P0031", "P0032", "P0033", "P0034", "P0035"]) {
      expect(BODY).toContain(`ERRCODE = '${code}'`)
    }
    expect(BODY).toMatch(/'CODIGO_DUPLICADO:%', v_dups USING ERRCODE = 'P0035'/)
  })

  it("a new id must look like a client cuid: ^c[0-9a-f]{24}$", () => {
    expect(BODY).toContain("c_id CONSTANT TEXT := '^c[0-9a-f]{24}$'")
    expect(BODY).toMatch(/!~ c_id/)
  })

  it("duplicate non-empty barcodes inside one save are 22023", () => {
    expect(BODY).toMatch(/btrim\(e\.v ->> 'barcode'\) HAVING count\(\*\) > 1/)
  })

  it("obligation 2: atributos shape is checked with the M1a validity fn before any write", () => {
    const firstWrite = Math.min(at("INSERT INTO inventario_grupos"), at("INSERT INTO inventario ("), at(/UPDATE inventario/))
    expect(at("inventario_atributos_validos(e.v -> 'atributos')")).toBeLessThan(firstWrite)
  })

  it("obligation 3: caps keep the btree entry small (<= 3 elements, valor <= 100 chars) and reject with 22023", () => {
    expect(BODY).toContain("jsonb_array_length(e.v -> 'atributos') <> v_nop")
    expect(BODY).toContain("char_length(a.x ->> 'valor') > 100")
    expect(BODY).toMatch(/jsonb_array_length\(p_grupo -> 'opciones'\) > 3 THEN\s*RAISE EXCEPTION [^;]*ERRCODE = 'P0034'/)
    // codigo, barcode and ubicacion sit in btree indexes too, so they are capped as well
    expect(BODY).toContain("char_length(e.v ->> 'codigo') <= 100")
    expect(BODY).toContain("jsonb_typeof(x) = 'string' AND char_length(x #>> '{}') <= 100")
  })

  it("p_compartidos accepts only the 9 columns the M1a sync trigger fires on (cross-check with M1a)", () => {
    const m1a = collapse(readBySuffix("_variantes_grupos.sql"))
    const trig = need(/AFTER UPDATE OF (.*?) ON inventario FOR EACH ROW/, m1a)[1].split(",").map((c) => c.trim())
    expect(trig).toEqual(NINE_SHARED)
    const rpc = need(/c_shared CONSTANT TEXT\[\] := ARRAY\[(.*?)\];/, BODY)[1].split(",").map((c) => c.trim().replace(/'/g, ""))
    expect(rpc).toEqual(NINE_SHARED)
    expect(BODY).toMatch(/jsonb_object_keys\(v_comp\) k WHERE k <> ALL \(c_shared\)/)
  })

  it("a variante may not carry nombre: names are derived (VG-3), never typed per row", () => {
    expect(need(/c_vkeys CONSTANT TEXT\[\] := ARRAY\[(.*?)\];/, BODY)[1]).not.toContain("'nombre'")
  })
})

describe("M1b: writes", () => {
  it("obligation 1: grupo_id and atributos are written in the SAME statement (insert and every update)", () => {
    const insert = need(/INSERT INTO inventario \((.*?)\) VALUES/, BODY)[1]
    expect(insert).toMatch(/\bgrupo_id\b/)
    expect(insert).toMatch(/\batributos\b/)
    const grouping = updates.filter((u) => /\bgrupo_id = /.test(setPart(u)))
    expect(grouping.length).toBeGreaterThan(0)
    for (const u of grouping) expect(setPart(u)).toMatch(/\batributos = /)
  })

  it("obligation 4: the group and every child use p_org; every UPDATE is org-scoped", () => {
    expect(BODY).toMatch(/INSERT INTO inventario_grupos \(id, organization_id, nombre, opciones, created_by\) VALUES \(v_gid, p_org,/)
    expect(BODY).toMatch(/INSERT INTO inventario \(id, organization_id,.*?\) VALUES \(v_ids\[v_i\], p_org,/)
    expect(updates.length).toBeGreaterThanOrEqual(3)
    for (const u of updates) expect(u).toMatch(/organization_id = p_org/)
  })

  it("locks the group first (SELECT nombre ... FOR UPDATE), then upserts it scoped to the org, then locks the rows ORDER BY id", () => {
    const sel = at("SELECT nombre INTO v_prev FROM inventario_grupos WHERE id = v_gid AND organization_id = p_org FOR UPDATE;")
    const ups = at(/ON CONFLICT \(id\) DO UPDATE SET nombre = EXCLUDED\.nombre, opciones = EXCLUDED\.opciones WHERE inventario_grupos\.organization_id = p_org/)
    const lock = at(/PERFORM 1 FROM inventario WHERE organization_id = p_org AND \(id = ANY \(v_ids \|\| v_arch\) OR grupo_id = v_gid\) ORDER BY id FOR UPDATE;/)
    expect(sel).toBeLessThan(at("INSERT INTO inventario_grupos"))
    expect(at("INSERT INTO inventario_grupos")).toBeLessThan(ups)
    expect(ups).toBeLessThan(lock)
    expect(lock).toBeLessThan(at("INSERT INTO inventario ("))
    expect(BODY).toMatch(/IF NOT FOUND THEN\s*RAISE EXCEPTION [^;]*ERRCODE = 'P0002'/) // another org owns the group id
  })

  it("initial stock goes through adjust_stock_atomic, only for NEW rows, never an overwrite", () => {
    expect(BODY.match(/adjust_stock_atomic\(/g)).toHaveLength(1)
    expect(BODY).toMatch(/PERFORM adjust_stock_atomic\(v_ids\[v_i\], p_org, p_user, 'delta', [^;]*, 'ENTRADA', 'STOCK_INICIAL', p_deposito_inicial\);/)
    const insert = at("INSERT INTO inventario (")
    const call = at("adjust_stock_atomic(")
    expect(call).toBeGreaterThan(insert)
    expect(BODY.slice(at(/IF v_cls\[v_i\] = 'N' THEN/), call)).not.toMatch(/ELSE/) // inside the N branch, before any ELSE
    expect(need(/INSERT INTO inventario \(.*?\) VALUES \((.*?)\); IF/, BODY)[1]).toMatch(/, 0, COALESCE\(\(v_var ->> 'precio_compra'\)::numeric, 0\)/) // stock 0, absent cost = 0 on NEW rows
    for (const u of updates) expect(setPart(u)).not.toMatch(/\bstock = /) // existing stock is never rewritten
  })

  it("the depot of the initial stock is re-validated against the org (active, not deleted) when used", () => {
    expect(BODY).toMatch(/FROM depositos WHERE id = p_deposito_inicial AND organization_id = p_org AND activo AND deleted_at IS NULL/)
  })

  it("an absent precio_compra leaves the stored cost unchanged (presence, not value)", () => {
    expect(BODY).toContain("precio_compra = CASE WHEN v_var ? 'precio_compra' THEN (v_var ->> 'precio_compra')::numeric ELSE precio_compra END")
    expect(BODY).toContain("precio_venta = CASE WHEN v_var ? 'precio_venta' THEN")
  })

  it("shared fields: one UPDATE over the group, wrapped by the sync GUC on/off, only rows that differ", () => {
    const on = at("set_config('stapp.sync_grupo', 'on', true)")
    const upd = at(/UPDATE inventario i SET descripcion = v_s\.descripcion/)
    const off = at("set_config('stapp.sync_grupo', 'off', true)")
    expect(on).toBeLessThan(upd)
    expect(upd).toBeLessThan(off)
    const set = need(/UPDATE inventario i SET (.*?) WHERE i\.organization_id = p_org AND i\.grupo_id = v_gid AND/, BODY)[1]
    expect([...set.matchAll(/(?:^|, )(\w+) = /g)].map((m) => m[1])).toEqual(NINE_SHARED)
    expect(BODY).toMatch(/IS DISTINCT FROM \(v_s\.descripcion,/)
    expect(BODY).not.toMatch(/pg_trigger_depth/)
  })

  it("naming: new rows derive; promoted rows derive only when renombrar; group rows re-derive only a MANAGED name", () => {
    expect(BODY).toContain("r.nombre = inventario_nombre_variante(v_prev, r.atributos)") // PREVIOUS base and PREVIOUS atributos
    expect(BODY).toMatch(/WHEN 'P' THEN CASE WHEN v_ren THEN inventario_nombre_variante\(v_base, /)
    expect(BODY).toMatch(/v_ren := CASE WHEN p_grupo \? 'renombrar' THEN \(p_grupo ->> 'renombrar'\)::boolean ELSE true END/)
  })

  it("archives instead of deleting, blocks on reserved stock (P0033) and never writes a movement", () => {
    expect(BODY).toMatch(/UPDATE inventario SET deleted_at = NOW\(\), deleted_by = p_user WHERE organization_id = p_org AND id = ANY \(v_arch\) AND deleted_at IS NULL/)
    expect(BODY).toMatch(/stock_reservado > 0[^;]*;\s*IF FOUND THEN\s*RAISE EXCEPTION [^;]*ERRCODE = 'P0033'/)
    expect(BODY).not.toMatch(/INSERT INTO movimientos_inventario/)
  })

  it("kits are refused with P0032 before the M1a CHECK, other-group items with P0031", () => {
    expect(BODY).toMatch(/r\.es_kit THEN\s*RAISE EXCEPTION [^;]*ERRCODE = 'P0032'/)
    expect(BODY).toMatch(/r\.grupo_id <> v_gid THEN\s*RAISE EXCEPTION [^;]*ERRCODE = 'P0031'/)
  })

  it("returns the six lists the API turns into events", () => {
    expect(BODY).toMatch(/RETURN jsonb_build_object\('grupoId', v_gid, 'creados', to_jsonb\(v_cre\), 'actualizados', to_jsonb\(v_act\), 'promovidos', to_jsonb\(v_pro\), 'restaurados', to_jsonb\(v_res\), 'archivados', to_jsonb\(v_ar\)\)/)
  })
})

describe("M1b: review fixes", () => {
  it("refuses a save that leaves ACTIVE members out, naming them, after classification and before any write", () => {
    const sel = need(/SELECT string_agg\(i\.id, ',' ORDER BY i\.id\) INTO v_falt FROM inventario i WHERE i\.organization_id = p_org AND i\.grupo_id = v_gid AND i\.deleted_at IS NULL AND NOT \(i\.id = ANY \(v_ids \|\| v_arch\)\);/, BODY)
    const raise = at("RAISE EXCEPTION 'PAYLOAD_INVALIDO:miembros_faltantes:%', v_falt USING ERRCODE = '22023';")
    expect(sel.index).toBeLessThan(raise)
    expect(raise).toBeGreaterThan(at("ERRCODE = 'P0033'"))
    expect(raise).toBeLessThan(at(/WITH a AS \(UPDATE inventario/))
  })

  it("the combination check looks at the payload only (full-state makes the unlisted-member branch dead)", () => {
    expect(BODY).toContain(
      "IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_vars) e(v) GROUP BY inventario_combinacion_clave(e.v -> 'atributos') HAVING count(*) > 1) THEN RAISE EXCEPTION 'COMBINACION_DUPLICADA' USING ERRCODE = 'P0030';"
    )
  })

  it("writes in this order: archive, EXISTING rows, NEW rows, archived-name sync, group-wide shared update", () => {
    const order = [
      at(/WITH a AS \(UPDATE inventario SET deleted_at = NOW\(\)/),
      at("UPDATE inventario SET grupo_id = v_gid"),
      at("INSERT INTO inventario ("),
      at("UPDATE inventario SET nombre = inventario_nombre_variante(v_base, atributos)"),
      at("UPDATE inventario i SET descripcion"),
    ]
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it("keeps the managed names of ARCHIVED members current when the base changes (a restore never shows a stale base)", () => {
    expect(BODY).toContain(
      "IF v_prev IS NOT NULL AND v_prev <> v_base THEN UPDATE inventario SET nombre = inventario_nombre_variante(v_base, atributos) WHERE organization_id = p_org AND grupo_id = v_gid AND deleted_at IS NOT NULL AND nombre = inventario_nombre_variante(v_prev, atributos); END IF;"
    )
  })

  it("validates p_user against users before anything is written (an unknown id would be a raw 23503)", () => {
    const chk = at("IF p_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = p_user) THEN")
    expect(chk).toBeLessThan(at("INSERT INTO inventario_grupos"))
    expect(BODY).toContain("RAISE EXCEPTION 'PAYLOAD_INVALIDO: p_user is not a known user' USING ERRCODE = '22023';")
  })

  it("prices take at most 8 integer digits and 2 decimals (99999999.995 would round past DECIMAL(10,2))", () => {
    expect(BODY).toContain("c_num CONSTANT TEXT := '^[0-9]{1,8}(\\.[0-9]{1,2})?$';")
    expect(BODY).toContain("'prices must be numbers from 0 to 99999999.99 with at most 2 decimals'")
  })

  it("checks the RAW length of group and option names (not only the trimmed one) and refuses repeated option names", () => {
    expect(BODY).toContain("btrim(v_base) = '' OR char_length(v_base) > 200")
    expect(BODY).toContain("btrim(o.e ->> 'nombre') = '' OR char_length(o.e ->> 'nombre') > 100")
    expect(BODY).toMatch(/count\(DISTINCT inventario_combinacion_clave\(jsonb_build_array\(jsonb_build_object\('valor', o\.e -> 'nombre'\)\)\)\) <> count\(\*\)/)
    expect(BODY).toContain("RAISE EXCEPTION 'PAYLOAD_INVALIDO: option names must be different' USING ERRCODE = '22023';")
  })

  it("compares the EFFECTIVE stock_minimo/stock_maximo (payload over the stored row), once, for new and existing rows", () => {
    expect(BODY).toContain("v_min := CASE WHEN v_var ? 'stock_minimo' THEN (v_var ->> 'stock_minimo')::int ELSE r.stock_minimo END;")
    expect(BODY).toContain("v_max := CASE WHEN v_var ? 'stock_maximo' THEN (v_var ->> 'stock_maximo')::int ELSE r.stock_maximo END;")
    expect(BODY).toContain("IF v_min > v_max THEN RAISE EXCEPTION 'PAYLOAD_INVALIDO: stock_minimo cannot exceed stock_maximo' USING ERRCODE = '22023'; END IF;")
    expect(BODY.match(/stock_minimo cannot exceed stock_maximo/g)).toHaveLength(1)
  })

  it("the shared source is the group first, then the first promoted row; trackea_* are normalized once", () => {
    expect(BODY).toContain("ORDER BY (i.grupo_id = v_gid) DESC NULLS LAST, i.id LIMIT 1;")
    expect(BODY).toContain("v_s.trackea_lotes := COALESCE(v_s.trackea_lotes, false);")
    expect(BODY).toContain("v_s.trackea_series := COALESCE(v_s.trackea_series, false);")
    expect(BODY.match(/COALESCE\(v_s\.trackea_/g)).toHaveLength(2)
  })
})

describe("M1b rollback file", () => {
  const RB_RAW = readByMarker("rollback", "Rollback of M1b")
  const RB = collapse(RB_RAW)

  it("sets lock_timeout first and drops exactly this function by its full signature", () => {
    expect(RB.startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(RB).toContain(`DROP FUNCTION IF EXISTS ${SIGNATURE};`)
    expect(RB.match(/\bDROP\b/g)).toHaveLength(1)
  })

  it("touches no data and says the API callers must go first", () => {
    expect(RB).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b|\bALTER\b/)
    expect(RB_RAW).toMatch(/data (is )?untouched/i)
    expect(RB_RAW).toMatch(/revert .* first/i)
  })
})
