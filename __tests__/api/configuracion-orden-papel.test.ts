// @vitest-environment node
/**
 * Setting `orden_formato_papel` (paper size of the printed order) in the three configuration
 * cascades: GET /api/configuracion, PUT /api/configuracion (its no-op branch AND its write) and
 * GET /api/configuracion/operativa.
 *
 * Default A4, read through normalizeOrdenPapel: a NULL, an unknown value or a missing column
 * all read "A4". What matters most is the degradation: migrations are applied BY HAND after the
 * merge, so there is always a window with the deploy ahead of its column. In that window every
 * OTHER setting must keep loading and saving, and the column must have a step of its own in each
 * cascade (a column inside the base select would knock down every step: "columna nueva tumba la
 * cascada").
 *
 * False-green guard: the fake below looks at what each query actually sent. A SELECT naming the
 * missing column fails with 42703, a write payload naming it fails with PGRST204, and a success
 * returns ONLY the requested columns. Every call is recorded, so the tests assert WHICH select and
 * payload each attempt carried, not just how many attempts there were. The table holds TWO
 * organizations and `eq` really filters, so a query that loses its `.eq("id", organizationId)` is
 * noticed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthError, mockAuthSuccess, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn().mockResolvedValue(false) }))

const COLUMN = "orden_formato_papel"
const POS_COLUMN = "pos_agrupa_variantes" // the step this one stacks on top of
// Newer column, a NEW TOP step above this one in every cascade. In any older-state database
// (this column missing) it is missing too, so such scenarios list it as missing and see ONE
// extra failed attempt at the front.
const TOMAN = "tecnicos_toman_ordenes"

interface Call {
  select: string
  columns: string[]
  update?: Record<string, unknown>
  eq: Array<[string, unknown]>
  ok: boolean
  errorCode?: string
}

const columnsOf = (select: string) => select.split(",").map((c) => c.trim()).filter(Boolean)

/** Everything an organization carries once every migration is applied, this one included. */
const FULL_ROW: Record<string, unknown> = {
  id: "org-1",
  logo_url: null,
  logo_path: null,
  nombre_mostrar: "Test Org",
  nombre: "Test Org",
  email: "test@test.com",
  telefono: "555-0100",
  direccion: null,
  ciudad: null,
  provincia: null,
  codigo_postal: null,
  moneda: "ARS",
  zona_horaria: "America/Argentina/Buenos_Aires",
  umbral_stock_bajo: 5,
  iva_porcentaje: 0,
  cotizacion_validez_dias: 30,
  cotizacion_terminos: "30 days",
  recepcion_terminos: "reception terms",
  comprobante_terminos: null,
  garantia_dias_default: 30,
  politica_abandono_dias_default: 60,
  anticipo_porcentaje_default: 50,
  pais: "AR",
  modulo_agenda: false,
  vendedores_administran_inventario: false,
  iva_regimen: "ADITIVO",
  iva_tasa: 21,
  redondeo_efectivo: 0,
  comision_aplica_sin_reparacion: false,
  terminologia: { orden: "Trabajo" },
  cuit: "30-71234567-8",
  condicion_iva: "Responsable Inscripto",
  domicilio_fiscal: null,
  cbu_alias: null,
  medios_pago_texto: null,
  plazo_pago_dias: null,
  facturacion_electronica_habilitada: true,
  ingresos_brutos: "902-123456-7",
  inicio_actividades: null,
  tecnicos_operan_pos: true,
  vendedores_manejan_caja: true,
  tecnicos_cobran_cotizaciones: true,
  vendedores_ven_ingresos: false, // non-default on purpose: reading false proves it was READ
  [TOMAN]: true,
  [POS_COLUMN]: false, // non-default on purpose too
  [COLUMN]: "A6",
}

/** The same organization on a database where the migration has not been applied. */
const rowWithoutColumn = (overrides: Record<string, unknown> = {}) => {
  const { [COLUMN]: _omitted, [TOMAN]: _newer, ...rest } = FULL_ROW
  return { ...rest, ...overrides }
}

function fakeOrganizations(initial: Record<string, unknown>, missing: string[] = [], options: { fail?: { code: string; message: string } } = {}) {
  const store: Record<string, unknown> = { ...initial }
  const other: Record<string, unknown> = {
    ...initial,
    id: "org-2",
    nombre_mostrar: "Other Org",
    umbral_stock_bajo: 77,
    cuit: "20-99999999-9",
    ...(typeof initial[COLUMN] === "string" ? { [COLUMN]: "A5" } : {}),
  }
  const otherBefore: Record<string, unknown> = { ...other }
  const rows = [store, other]
  const calls: Call[] = []
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    if (table !== "organizations") throw new Error(`unexpected table: ${table}`)
    let select = ""
    let payload: Record<string, unknown> | undefined
    const filters: Array<[string, unknown]> = []
    const q: any = {}
    q.update = vi.fn((p: Record<string, unknown>) => {
      payload = { ...p } // snapshot: the route deletes keys from its own object between retries
      return q
    })
    q.select = vi.fn((cols: string) => {
      select = cols
      return q
    })
    q.eq = vi.fn((column: string, value: unknown) => {
      filters.push([column, value])
      return q
    })
    q.single = vi.fn(async () => {
      const columns = columnsOf(select)
      const call: Call = { select, columns, update: payload, eq: [...filters], ok: false }
      calls.push(call)
      if (options.fail) {
        call.errorCode = options.fail.code
        return { data: null, error: { ...options.fail } }
      }
      const badKey = payload && Object.keys(payload).find((k) => missing.includes(k))
      if (badKey) {
        call.errorCode = "PGRST204"
        return { data: null, error: { code: "PGRST204", message: `Could not find the '${badKey}' column of 'organizations' in the schema cache` } }
      }
      const badColumn = columns.find((c) => missing.includes(c))
      if (badColumn) {
        call.errorCode = "42703"
        return { data: null, error: { code: "42703", message: `column organizations.${badColumn} does not exist` } }
      }
      const matched = rows.filter((r) => filters.every(([column, value]) => r[column] === value))
      if (payload) for (const r of matched) Object.assign(r, payload)
      if (matched.length !== 1) {
        call.errorCode = "PGRST116"
        return { data: null, error: { code: "PGRST116", message: `JSON object requested, multiple (or no) rows returned (${matched.length})` } }
      }
      const row = matched[0]
      call.ok = true
      const data = columns.includes("*") ? { ...row } : Object.fromEntries(columns.filter((c) => c in row).map((c) => [c, row[c]]))
      return { data, error: null }
    })
    return q
  }) as any)
  return { calls, store, other, otherBefore }
}

const ONLY_ORG_1: Array<[string, unknown]> = [["id", "org-1"]]

const without = (obj: Record<string, unknown> | undefined, key: string): Record<string, unknown> => {
  const { [key]: _dropped, ...rest } = obj ?? {}
  return rest
}

const putRequest = (body: Record<string, unknown>) =>
  new Request("http://localhost:3000/api/configuracion", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

/** Settings from OTHER migrations that must come through untouched when this column is absent. */
function expectOtherSettingsSurvived(body: Record<string, any>) {
  expect(body.terminologiaOverrides).toEqual({ orden: "Trabajo" })
  expect(body.ivaRegimen).toBe("ADITIVO")
  expect(body.cuit).toBe("30-71234567-8")
  expect(body.vendedoresVenIngresos).toBe(false)
  expect(body.posAgrupaVariantes).toBe(false)
  expect(body.tecnicosOperanPos).toBe(true)
  expect(body.vendedoresManejanCaja).toBe(true)
  expect(body.tecnicosCobranCotizaciones).toBe(true)
  expect(body.facturacionElectronicaHabilitada).toBe(true)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
})

describe("GET /api/configuracion - ordenFormatoPapel", () => {
  it("reads the stored size, in ONE query that names the column", async () => {
    for (const stored of ["A4", "A5", "A6"]) {
      const { calls } = fakeOrganizations({ ...FULL_ROW, [COLUMN]: stored })
      const { GET } = await import("@/app/api/configuracion/route")
      const { status, body } = await parseResponse((await GET()) as Response)

      expect(status).toBe(200)
      expect(body.ordenFormatoPapel).toBe(stored)
      expect(calls).toHaveLength(1)
      expect(calls[0].columns.filter((c) => c === COLUMN)).toHaveLength(1)
      expect(calls[0].ok).toBe(true)
    }
  })

  it("reads NULL and an unknown value as A4", async () => {
    for (const stored of [null, "", "A3", "legal", 6]) {
      fakeOrganizations({ ...FULL_ROW, [COLUMN]: stored })
      const { GET } = await import("@/app/api/configuracion/route")
      const { body } = await parseResponse((await GET()) as Response)
      expect(body.ordenFormatoPapel).toBe("A4")
    }
  })

  it("column missing: its own step, so the newer top step fails first, then exactly this step fails and the next is its select minus ONLY the column", async () => {
    const { calls } = fakeOrganizations(rowWithoutColumn(), [TOMAN, COLUMN])
    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.ordenFormatoPapel).toBe("A4") // reads A4 without the column
    expectOtherSettingsSurvived(body)

    expect(calls).toHaveLength(3)
    expect(calls[0].errorCode).toBe("42703")
    expect(calls[0].columns).toContain(TOMAN) // the newer top step
    expect(calls[1].errorCode).toBe("42703")
    expect(calls[1].columns).toContain(COLUMN)
    expect(calls[1].columns).not.toContain(TOMAN)
    expect(calls[1].columns).toContain(POS_COLUMN) // this step stacks on the pos_agrupa_variantes step
    expect(calls[2].ok).toBe(true)
    expect(calls[2].columns).not.toContain(COLUMN)
    expect(calls[2].columns).toContain(POS_COLUMN)
    expect(calls[0].columns).toEqual([...calls[1].columns, TOMAN])
    expect(calls[1].columns).toEqual([...calls[2].columns, COLUMN])
  })

  it("this column and the one under it both missing: the chain continues one step at a time", async () => {
    const { calls } = fakeOrganizations(rowWithoutColumn({ [POS_COLUMN]: undefined }), [TOMAN, COLUMN, POS_COLUMN])
    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.ordenFormatoPapel).toBe("A4")
    expect(body.posAgrupaVariantes).toBe(true)
    expect(body.terminologiaOverrides).toEqual({ orden: "Trabajo" })
    expect(body.vendedoresVenIngresos).toBe(false)

    expect(calls).toHaveLength(4) // the newer top step, then this one, the one under it, the one that works
    expect(calls[2].columns).not.toContain(COLUMN)
    expect(calls[2].columns).toContain(POS_COLUMN)
    expect(calls[3].columns).not.toContain(COLUMN)
    expect(calls[3].columns).not.toContain(POS_COLUMN)
    expect(calls[3].columns).toContain("vendedores_ven_ingresos")
  })

  it("an older database that also misses a legacy column bottoms out at the minimal select without the new column", async () => {
    const { calls } = fakeOrganizations(rowWithoutColumn(), [TOMAN, COLUMN, "comprobante_terminos"])
    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.ordenFormatoPapel).toBe("A4")
    const last = calls.at(-1)!
    expect(last.ok).toBe(true)
    expect(last.columns).not.toContain(COLUMN)
    expect(calls.filter((c) => c.columns.includes(COLUMN))).toHaveLength(2) // only the two top steps carry it (the newer one stacks on this one)
  })
})

describe("PUT /api/configuracion, no-op branch - ordenFormatoPapel", () => {
  it("returns the stored size, not a fabricated one, and writes nothing", async () => {
    const { calls } = fakeOrganizations({ ...FULL_ROW, [COLUMN]: "A5" })
    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await PUT(putRequest({}))) as Response)

    expect(status).toBe(200)
    expect(body.ordenFormatoPapel).toBe("A5")
    expect(calls).toHaveLength(1)
    expect(calls[0].columns).toContain(COLUMN)
    expect(calls[0].update).toBeUndefined()
  })

  it("column missing: three attempts (the newer top step, this one, the rest), the last without the column, nothing written, other settings intact", async () => {
    const { calls } = fakeOrganizations(rowWithoutColumn(), [TOMAN, COLUMN])
    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await PUT(putRequest({}))) as Response)

    expect(status).toBe(200)
    expect(body.ordenFormatoPapel).toBe("A4")
    expectOtherSettingsSurvived(body)
    expect(calls).toHaveLength(3)
    expect(calls[2].ok).toBe(true)
    expect(calls[2].columns).not.toContain(COLUMN)
    expect(calls[1].columns).toEqual([...calls[2].columns, COLUMN])
    expect(calls.every((c) => c.update === undefined)).toBe(true)
  })
})

describe("PUT /api/configuracion, write - ordenFormatoPapel", () => {
  it("persists each size, in one query that names the column in payload and select", async () => {
    for (const sent of ["A4", "A5", "A6"]) {
      const { calls, store } = fakeOrganizations({ ...FULL_ROW, [COLUMN]: sent === "A6" ? "A4" : "A6" })
      const { PUT } = await import("@/app/api/configuracion/route")
      const { status, body } = await parseResponse((await PUT(putRequest({ ordenFormatoPapel: sent }))) as Response)

      expect(status).toBe(200)
      expect(body.ordenFormatoPapel).toBe(sent)
      expect(store[COLUMN]).toBe(sent)
      expect(calls).toHaveLength(1)
      expect(calls[0].update).toEqual({ [COLUMN]: sent })
      expect(calls[0].columns).toContain(COLUMN)
    }
  })

  it("normalizes what the body carries before it reaches the CHECK constraint (case and spaces)", async () => {
    const { calls, store } = fakeOrganizations({ ...FULL_ROW, [COLUMN]: "A4" })
    const { PUT } = await import("@/app/api/configuracion/route")
    const { body } = await parseResponse((await PUT(putRequest({ ordenFormatoPapel: " a6 " }))) as Response)

    expect(calls[0].update).toEqual({ [COLUMN]: "A6" })
    expect(store[COLUMN]).toBe("A6")
    expect(body.ordenFormatoPapel).toBe("A6")
  })

  it("ignores a size that is not valid: the key is NOT written, so the stored value stays", async () => {
    for (const bad of ["A3", "", null, 6, "legal"]) {
      const { calls, store } = fakeOrganizations({ ...FULL_ROW, [COLUMN]: "A5" })
      const { PUT } = await import("@/app/api/configuracion/route")
      const { body } = await parseResponse((await PUT(putRequest({ ordenFormatoPapel: bad, umbralStockBajo: 9 }))) as Response)

      expect(calls[0].update).toEqual({ umbral_stock_bajo: 9 })
      expect(calls[0].update).not.toHaveProperty(COLUMN)
      expect(store[COLUMN]).toBe("A5")
      expect(body.ordenFormatoPapel).toBe("A5")
    }
  })

  it("writes the key only when it was sent: another setting alone leaves the stored size alone", async () => {
    const { calls, store } = fakeOrganizations({ ...FULL_ROW, [COLUMN]: "A6" })
    const { PUT } = await import("@/app/api/configuracion/route")
    const { body } = await parseResponse((await PUT(putRequest({ umbralStockBajo: 9 }))) as Response)

    expect(calls[0].update).toEqual({ umbral_stock_bajo: 9 })
    expect(store[COLUMN]).toBe("A6")
    expect(body.ordenFormatoPapel).toBe("A6")
  })

  it("column missing: the retry drops ONLY the key from payload and select; every other setting is saved and returned", async () => {
    const { calls, store } = fakeOrganizations(
      rowWithoutColumn({ iva_regimen: "EXENTO", terminologia: {}, cuit: null, vendedores_ven_ingresos: true }),
      [TOMAN, COLUMN],
    )
    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse(
      (await PUT(
        putRequest({
          ordenFormatoPapel: "A6",
          ivaRegimen: "ADITIVO",
          terminologia: { orden: "Trabajo" },
          cuit: "30-71234567-8",
          vendedoresVenIngresos: false,
          tecnicosOperanPos: true,
        }),
      )) as Response,
    )

    expect(status).toBe(200)
    // The size itself is ignored until the migration is applied: it reads A4.
    expect(body.ordenFormatoPapel).toBe("A4")
    expect(body.ivaRegimen).toBe("ADITIVO")
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.vendedoresVenIngresos).toBe(false)
    expect(body.terminologiaOverrides).toEqual({ orden: "Trabajo" })
    expect(store).not.toHaveProperty(COLUMN)
    expect(store.iva_regimen).toBe("ADITIVO")

    // The newer top step fails first (the body carries no key for it, so the payload is unchanged),
    // then this step fails with PGRST204 on the payload, then the one that drops ONLY the key works.
    expect(calls).toHaveLength(3)
    expect(calls[0].errorCode).toBe("PGRST204")
    expect(calls[0].columns).toContain(TOMAN)
    expect(calls[1].errorCode).toBe("PGRST204")
    expect(calls[1].update).toHaveProperty(COLUMN, "A6")
    expect(calls[1].update).toEqual(calls[0].update)
    expect(calls[1].columns).toContain(COLUMN)
    expect(calls[1].columns).not.toContain(TOMAN)
    expect(calls[2].ok).toBe(true)
    expect(calls[2].update).toEqual(without(calls[1].update, COLUMN))
    expect(calls[2].columns).not.toContain(COLUMN)
    expect(calls[1].columns).toEqual([...calls[2].columns, COLUMN])
  })

  it("column missing and the body does not carry the key: the RETURNING-only 42703 still triggers the retry, same payload", async () => {
    const { calls, store } = fakeOrganizations(rowWithoutColumn(), [TOMAN, COLUMN])
    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await PUT(putRequest({ umbralStockBajo: 9 }))) as Response)

    expect(status).toBe(200)
    expect(body.umbralStockBajo).toBe(9)
    expect(store.umbral_stock_bajo).toBe(9)
    expect(body.ordenFormatoPapel).toBe("A4")
    expect(calls).toHaveLength(3) // the newer top step, this step, the one that works
    expect(calls[0].errorCode).toBe("42703")
    expect(calls[1].errorCode).toBe("42703")
    expect(calls[2].update).toEqual({ umbral_stock_bajo: 9 })
    expect(calls[2].columns).not.toContain(COLUMN)
  })

  it("this column and the one under it both missing: the payload loses exactly those two keys", async () => {
    const { calls, store } = fakeOrganizations(rowWithoutColumn({ [POS_COLUMN]: undefined, iva_regimen: "EXENTO" }), [TOMAN, COLUMN, POS_COLUMN])
    const { PUT } = await import("@/app/api/configuracion/route")
    const { status } = await parseResponse(
      (await PUT(putRequest({ ordenFormatoPapel: "A6", posAgrupaVariantes: false, ivaRegimen: "ADITIVO" }))) as Response,
    )

    expect(status).toBe(200)
    expect(calls).toHaveLength(4) // the newer top step (same payload), then one step per key dropped
    expect(calls[0].update).toEqual({ [COLUMN]: "A6", [POS_COLUMN]: false, iva_regimen: "ADITIVO" })
    expect(calls[1].update).toEqual({ [COLUMN]: "A6", [POS_COLUMN]: false, iva_regimen: "ADITIVO" })
    expect(calls[2].update).toEqual({ [POS_COLUMN]: false, iva_regimen: "ADITIVO" })
    expect(calls[3].update).toEqual({ iva_regimen: "ADITIVO" })
    expect(calls[3].ok).toBe(true)
    expect(store.iva_regimen).toBe("ADITIVO")
  })

  it("an older database also missing a legacy column: no attempt after the first (the minimal select included) carries the key", async () => {
    const { calls, store } = fakeOrganizations(rowWithoutColumn(), [TOMAN, COLUMN, "comprobante_terminos"])
    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse(
      (await PUT(putRequest({ ordenFormatoPapel: "A6", umbralStockBajo: 9, ivaRegimen: "ADITIVO" }))) as Response,
    )

    expect(status).toBe(200)
    expect(body.ordenFormatoPapel).toBe("A4")
    const last = calls.at(-1)!
    expect(last.ok).toBe(true)
    expect(last.columns).not.toContain(COLUMN)
    expect(last.update).toHaveProperty("umbral_stock_bajo", 9)
    expect(last.update).not.toHaveProperty(COLUMN)
    expect(store.umbral_stock_bajo).toBe(9)
    expect(calls[0].update).toHaveProperty(COLUMN, "A6")
    // The newer top step fails first with the payload untouched (it has no key of its own to drop), so
    // the second attempt still carries the key; from the third on, none does.
    expect(calls[1].update).toHaveProperty(COLUMN, "A6")
    expect(calls.slice(2).every((c) => !c.update || !(COLUMN in c.update))).toBe(true)
  })
})

describe("GET /api/configuracion/operativa - ordenFormatoPapel", () => {
  it("serves the stored size to any role, from the select(*) it already does", async () => {
    for (const stored of ["A4", "A5", "A6"]) {
      const { calls } = fakeOrganizations({ ...FULL_ROW, [COLUMN]: stored })
      mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1" })
      const { GET } = await import("@/app/api/configuracion/operativa/route")
      const { status, body } = await parseResponse((await GET()) as Response)

      expect(status).toBe(200)
      expect(body.ordenFormatoPapel).toBe(stored)
      expect(calls).toHaveLength(1)
      expect(calls[0].select).toBe("*")
    }
  })

  it("reads A4 when the column does not exist, and when it is NULL or unknown", async () => {
    fakeOrganizations(rowWithoutColumn(), [COLUMN])
    mockAuthSuccess({ role: "TECNICO", organizationId: "org-1" })
    const { GET } = await import("@/app/api/configuracion/operativa/route")
    expect((await parseResponse((await GET()) as Response)).body.ordenFormatoPapel).toBe("A4")

    for (const stored of [null, "A3"]) {
      fakeOrganizations({ ...FULL_ROW, [COLUMN]: stored })
      expect((await parseResponse((await GET()) as Response)).body.ordenFormatoPapel).toBe("A4")
    }
  })

  it("keeps the fields it served before", async () => {
    fakeOrganizations({ ...FULL_ROW, [COLUMN]: "A6" })
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1" })
    const { GET } = await import("@/app/api/configuracion/operativa/route")
    const { body } = await parseResponse((await GET()) as Response)
    expect(body).toMatchObject({ moneda: "ARS", pais: "AR", ivaRegimen: "ADITIVO", ivaTasa: 21, garantiaDiasDefault: 30, posAgrupaVariantes: false, ordenFormatoPapel: "A6" })
  })
})

describe("every query of the new step is scoped to the caller's organization", () => {
  for (const missing of [[], [TOMAN, COLUMN]] as string[][]) {
    const scenario = missing.length ? "column missing: the failed attempt AND its retry" : "column present: the single attempt"
    const initial = () => (missing.length ? rowWithoutColumn() : { ...FULL_ROW })
    const attempts = missing.length ? 3 : 1 // missing: the newer top step, this step, the one that works

    it(`GET - ${scenario} filter by id and read org-1, never org-2`, async () => {
      const h = fakeOrganizations(initial(), missing)
      const { GET } = await import("@/app/api/configuracion/route")
      const { status, body } = await parseResponse((await GET()) as Response)

      expect(status).toBe(200)
      expect(body.nombreEmpresa).toBe("Test Org")
      expect(body.cuit).toBe("30-71234567-8")
      expect(h.calls).toHaveLength(attempts)
      expect(h.calls.map((c) => c.eq)).toEqual(h.calls.map(() => ONLY_ORG_1))
      if (!missing.length) expect(body.ordenFormatoPapel).toBe("A6") // org-2 is A5
    })

    it(`PUT write - ${scenario} filter by id and write org-1 only, org-2 stays byte for byte`, async () => {
      const h = fakeOrganizations(initial(), missing)
      const { PUT } = await import("@/app/api/configuracion/route")
      const { status, body } = await parseResponse((await PUT(putRequest({ ordenFormatoPapel: "A4", umbralStockBajo: 9 }))) as Response)

      expect(status).toBe(200)
      expect(body.umbralStockBajo).toBe(9)
      expect(h.store.umbral_stock_bajo).toBe(9)
      expect(h.calls).toHaveLength(attempts)
      expect(h.calls.map((c) => c.eq)).toEqual(h.calls.map(() => ONLY_ORG_1))
      expect(h.other).toEqual(h.otherBefore)
      expect(h.other.umbral_stock_bajo).toBe(77)
    })
  }
})

describe("an error that is NOT a missing column is never retried by the new step", () => {
  const TIMEOUT = { code: "57014", message: "canceling statement due to statement timeout" }

  it("GET: one attempt that carried the column, answered with the controlled 404 the route gives today", async () => {
    const { calls } = fakeOrganizations({ ...FULL_ROW }, [], { fail: TIMEOUT })
    const { GET } = await import("@/app/api/configuracion/route")
    const { status } = await parseResponse((await GET()) as Response)

    expect(status).toBe(404)
    expect(calls).toHaveLength(1)
    expect(calls[0].columns).toContain(COLUMN)
    expect(calls[0].columns).toContain(TOMAN) // the first attempt is now the newer top step
    expect(calls[0].errorCode).toBe("57014")
  })

  it("PUT write: one attempt with the key still in the payload, a 500 that passes the message through, nothing stored", async () => {
    const { calls, store } = fakeOrganizations({ ...FULL_ROW }, [], { fail: TIMEOUT })
    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await PUT(putRequest({ ordenFormatoPapel: "A4", umbralStockBajo: 9 }))) as Response)

    expect(status).toBe(500)
    expect(body.error).toContain("canceling statement due to statement timeout")
    expect(calls).toHaveLength(1)
    expect(calls[0].update).toEqual({ [COLUMN]: "A4", umbral_stock_bajo: 9 })
    expect(store.umbral_stock_bajo).toBe(5)
    expect(store[COLUMN]).toBe("A6")
  })
})

describe("access: the setting is admin-only to read and write through /api/configuracion", () => {
  it("answers 401 without a session and 403 to a non-admin, before touching the database", async () => {
    const { calls } = fakeOrganizations({ ...FULL_ROW })
    const { GET, PUT } = await import("@/app/api/configuracion/route")

    mockAuthError()
    expect((await GET()).status).toBe(401)
    expect((await PUT(putRequest({ ordenFormatoPapel: "A6" }))).status).toBe(401)

    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1" })
    expect((await GET()).status).toBe(403)
    expect((await PUT(putRequest({ ordenFormatoPapel: "A6" }))).status).toBe(403)

    expect(calls).toHaveLength(0)
  })
})
