// @vitest-environment node
import { describe, it, expect } from "vitest"
import { collapse, readByMarker, readBySuffix, stripComments } from "./helpers/sql-text"

// Migrations are applied by hand and CI has no Postgres: this pins by text what vitest cannot
// execute (verify/372_probes.sql covers the runtime, against the real schema). Files resolve by
// suffix or marker, never by number, so the renumber at merge time breaks nothing.

const migRaw = () => readBySuffix("_editar_venta_factura_anulada.sql")
const rollbackRaw = () => readByMarker("rollback", "Rollback of editar_venta_factura_anulada")
const probesRaw = () => readByMarker("verify", "Verification of editar_venta_factura_anulada")
const m328Raw = () => readBySuffix("_editar_venta_segura.sql")

const START = "CREATE OR REPLACE FUNCTION editar_venta_atomica("
const END = "$$ LANGUAGE plpgsql;"

/** The whole CREATE OR REPLACE FUNCTION statement of a file, comments included, as lines. */
function funcionLineas(raw: string): string[] {
  const i = raw.indexOf(START)
  if (i < 0) throw new Error("editar_venta_atomica not found")
  const j = raw.indexOf(END, i)
  if (j < 0) throw new Error("end of editar_venta_atomica not found")
  return raw.slice(i, j + END.length).split("\n")
}

const abreTransaccion = (sql: string) => /^\s*BEGIN\s*;/im.test(sql.split("\n").slice(0, 60).join("\n"))

const PREDICATE_328 = "WHERE venta_id = p_venta_id AND estado IN ('pendiente', 'emitido')) THEN"
const PREDICATE_372 =
  "WHERE venta_id = p_venta_id AND estado IN ('pendiente', 'emitido') AND comprobante_asociado_id IS NULL) THEN"

describe("372: transaction hygiene", () => {
  it("starts with SET LOCAL lock_timeout and opens no transaction of its own", () => {
    expect(collapse(migRaw()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(abreTransaccion(migRaw())).toBe(false)
    expect(stripComments(migRaw())).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im)
  })

  it("aborts BEFORE replacing the function when 371 is missing (the new predicate would fail at run time)", () => {
    const sql = collapse(migRaw())
    expect(sql).toContain("table_name = 'comprobantes_fiscales' AND column_name = 'comprobante_asociado_id'")
    expect(sql).toContain("RAISE EXCEPTION 'Abort: falta comprobantes_fiscales.comprobante_asociado_id. Aplicar la 371 antes de la 372.'")
    expect(sql.indexOf("Abort: falta")).toBeGreaterThan(-1)
    expect(sql.indexOf("Abort: falta")).toBeLessThan(sql.indexOf(START))
  })

  it("creates exactly one function and touches no grant, owner, security mode or search_path", () => {
    const sql = collapse(migRaw())
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1)
    // CREATE OR REPLACE keeps the privileges of the existing function: GRANT / REVOKE would change them.
    expect(sql).not.toMatch(/\b(GRANT|REVOKE|ALTER FUNCTION|SECURITY DEFINER|SECURITY INVOKER|SET search_path)\b/i)
    expect(sql).not.toMatch(/\b(ALTER TABLE|CREATE TABLE|CREATE INDEX|DROP )/i)
  })
})

describe("372: the function is 328 with ONE predicate changed", () => {
  it("328 has the predicate that 372 changes (the test below is not vacuous)", () => {
    expect(funcionLineas(m328Raw()).some((l) => l.includes(PREDICATE_328))).toBe(true)
    expect(funcionLineas(m328Raw()).filter((l) => l.includes(PREDICATE_328))).toHaveLength(1)
  })

  it("every line is identical (comments included) except the comprobantes predicate", () => {
    const a = funcionLineas(m328Raw())
    const b = funcionLineas(migRaw())
    expect(b).toHaveLength(a.length)
    const distintas = a.map((l, i) => [l, b[i], i] as const).filter(([x, y]) => x !== y)
    expect(distintas).toHaveLength(1)
    const [antes, despues] = distintas[0]
    expect(antes.trim()).toBe(PREDICATE_328)
    expect(despues.trim()).toBe(PREDICATE_372)
    // the comprobantes check keeps its place and its text
    const idx = b.findIndex((l) => l.includes(PREDICATE_372))
    expect(b[idx - 1].trim()).toBe("IF EXISTS (SELECT 1 FROM comprobantes_fiscales")
    expect(b[idx + 1].trim()).toBe("RAISE EXCEPTION 'VENTA_NO_EDITABLE: La venta tiene una factura electrónica emitida.'")
  })

  it("keeps the signature, the 15 parameters and the return type", () => {
    const body = collapse(funcionLineas(migRaw()).join("\n"))
    expect(body).toContain("p_items JSONB, p_deposito_id TEXT DEFAULT NULL ) RETURNS JSONB AS $$")
    expect(body).toContain("USING ERRCODE = 'P0021'")
  })
})

describe("372: rollback", () => {
  it("restores the function of 328 EXACTLY (every line, comments included)", () => {
    expect(funcionLineas(rollbackRaw())).toEqual(funcionLineas(m328Raw()))
  })

  it("starts with SET LOCAL lock_timeout, opens no transaction, changes no grants", () => {
    expect(collapse(rollbackRaw()).startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true)
    expect(abreTransaccion(rollbackRaw())).toBe(false)
    expect(stripComments(rollbackRaw())).not.toMatch(/\b(GRANT|REVOKE|SECURITY DEFINER|SECURITY INVOKER|SET search_path)\b/i)
  })

  it("is safe to run at any time: it warns that an annulled factura becomes uneditable again", () => {
    const header = rollbackRaw().slice(0, rollbackRaw().indexOf("SET LOCAL lock_timeout"))
    expect(header).toContain("anulad")
    expect(header).toMatch(/lib\/ventas\/bloqueos\.ts/)
  })
})

describe("372: probes", () => {
  it("open their own transaction, always end in ROLLBACK and never COMMIT", () => {
    const sql = stripComments(probesRaw())
    expect(sql).toMatch(/^\s*BEGIN\s*;/m)
    expect(sql.trimEnd().endsWith("ROLLBACK;")).toBe(true)
    expect(sql).not.toMatch(/\bCOMMIT\b/i)
  })

  it("cover the editable and the blocked cases of the new predicate", () => {
    const sql = probesRaw()
    // editable: factura annulled + NC emitida, only rechazado attempts
    expect(sql).toMatch(/factura anulada y NC emitida/)
    expect(sql).toMatch(/rechazad/)
    // blocked: emitida, pendiente, legacy tusfacturas factura (cbte_tipo NULL), NC pendiente over an emitida factura
    expect(sql).toMatch(/factura emitida/)
    expect(sql).toMatch(/factura pendiente/)
    expect(sql).toMatch(/legada/)
    expect(sql).toMatch(/NC pendiente/)
    // the rest of the blockers keep working
    expect(sql).toMatch(/comisi/)
    expect(sql).toContain("P0021")
  })

  it("prove the privileges and the security mode are the ones of 328", () => {
    const sql = probesRaw()
    expect(sql).toContain("has_function_privilege")
    expect(sql).toContain("prosecdef")
    expect(sql).toContain("editar_venta_atomica")
  })

  it("end with the count check of the probe rows", () => {
    expect(stripComments(probesRaw())).toMatch(/COUNT\(DISTINCT orden\)/)
  })
})
