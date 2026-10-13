// @vitest-environment node
/**
 * Preference `pos_agrupa_variantes` (migration M3) in the three configuration cascades:
 * GET /api/configuracion, PUT /api/configuracion (its no-op branch AND its write) and
 * GET /api/configuracion/operativa.
 *
 * Like vendedores_ven_ingresos (326) it is true by default and read as `!== false`, so a
 * missing column reads as "grouped". What matters more is the degradation: migrations are
 * applied BY HAND after the merge, so there is always a window with the deploy ahead of its
 * column. In that window every OTHER setting must keep loading and saving.
 *
 * False-green guard (G1, G10): the fake below looks at what each query actually sent. A
 * SELECT naming the missing column fails with 42703, a write payload naming it fails with
 * PGRST204, and a success returns ONLY the requested columns. Every call is recorded, so the
 * tests assert WHICH select and payload each attempt carried, not just how many attempts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthError, mockAuthSuccess, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn().mockResolvedValue(false) }))

const COLUMN = "pos_agrupa_variantes"

interface Call {
  select: string
  columns: string[]
  update?: Record<string, unknown>
  ok: boolean
  errorCode?: string
}

const columnsOf = (select: string) =>
  select.split(",").map((c) => c.trim()).filter(Boolean)

/** Everything an organization carries once every migration is applied, M3 included. */
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
  // Non-default on purpose: reading false proves the sibling setting was READ, not defaulted.
  vendedores_ven_ingresos: false,
  [COLUMN]: true,
}

/** The same organization on a database where M3 has not been applied. */
const rowWithoutM3 = (overrides: Record<string, unknown> = {}) => {
  const { [COLUMN]: _omitted, ...rest } = FULL_ROW
  return { ...rest, ...overrides }
}

/**
 * In-memory organizations table that behaves like PostgREST for what these routes do.
 * `missing` lists the columns the database does not have.
 */
function fakeOrganizations(initial: Record<string, unknown>, missing: string[] = []) {
  const store: Record<string, unknown> = { ...initial }
  const calls: Call[] = []
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    if (table !== "organizations") throw new Error(`unexpected table: ${table}`)
    let select = ""
    let payload: Record<string, unknown> | undefined
    const q: any = {}
    q.update = vi.fn((p: Record<string, unknown>) => {
      payload = { ...p } // snapshot: the route deletes keys from its own object between retries
      return q
    })
    q.select = vi.fn((cols: string) => {
      select = cols
      return q
    })
    q.eq = vi.fn(() => q)
    q.single = vi.fn(async () => {
      const columns = columnsOf(select)
      const call: Call = { select, columns, update: payload, ok: false }
      calls.push(call)
      const badKey = payload && Object.keys(payload).find((k) => missing.includes(k))
      if (badKey) {
        call.errorCode = "PGRST204"
        return {
          data: null,
          error: { code: "PGRST204", message: `Could not find the '${badKey}' column of 'organizations' in the schema cache` },
        }
      }
      const badColumn = columns.find((c) => missing.includes(c))
      if (badColumn) {
        call.errorCode = "42703"
        return { data: null, error: { code: "42703", message: `column organizations.${badColumn} does not exist` } }
      }
      if (payload) Object.assign(store, payload)
      call.ok = true
      const data = columns.includes("*")
        ? { ...store }
        : Object.fromEntries(columns.filter((c) => c in store).map((c) => [c, store[c]]))
      return { data, error: null }
    })
    return q
  }) as any)
  return { calls, store }
}

const without = (obj: Record<string, unknown> | undefined, key: string): Record<string, unknown> => {
  const { [key]: _dropped, ...rest } = obj ?? {}
  return rest
}

function putRequest(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/configuracion", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Settings from OTHER migrations that must come through untouched when M3 is absent. */
function expectOtherSettingsSurvived(body: Record<string, any>) {
  expect(body.terminologiaOverrides).toEqual({ orden: "Trabajo" })
  expect(body.terminologia.orden).toBe("Trabajo")
  expect(body.ivaRegimen).toBe("ADITIVO")
  expect(body.cuit).toBe("30-71234567-8")
  expect(body.vendedoresVenIngresos).toBe(false)
  expect(body.tecnicosOperanPos).toBe(true)
  expect(body.vendedoresManejanCaja).toBe(true)
  expect(body.tecnicosCobranCotizaciones).toBe(true)
  expect(body.facturacionElectronicaHabilitada).toBe(true)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
})

describe("GET /api/configuracion - posAgrupaVariantes", () => {
  it("reads the stored value: false comes out false, true comes out true, in ONE query that names the column", async () => {
    for (const stored of [false, true]) {
      const { calls } = fakeOrganizations({ ...FULL_ROW, [COLUMN]: stored })
      const { GET } = await import("@/app/api/configuracion/route")
      const { status, body } = await parseResponse((await GET()) as Response)

      expect(status).toBe(200)
      expect(body.posAgrupaVariantes).toBe(stored)
      expect(calls).toHaveLength(1)
      expect(calls[0].columns.filter((c) => c === COLUMN)).toHaveLength(1)
      expect(calls[0].ok).toBe(true)
    }
  })

  it("reads null as grouped (only an explicit false turns it off)", async () => {
    fakeOrganizations({ ...FULL_ROW, [COLUMN]: null })
    const { GET } = await import("@/app/api/configuracion/route")
    const { body } = await parseResponse((await GET()) as Response)
    expect(body.posAgrupaVariantes).toBe(true)
  })

  it("M3 missing: its own step, so exactly two attempts and the second is the first minus ONLY the column", async () => {
    const { calls } = fakeOrganizations(rowWithoutM3(), [COLUMN])
    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.posAgrupaVariantes).toBe(true) // reads grouped without the column
    expectOtherSettingsSurvived(body)

    expect(calls).toHaveLength(2)
    expect(calls[0].errorCode).toBe("42703")
    expect(calls[0].columns).toContain(COLUMN)
    expect(calls[0].columns).toContain("vendedores_ven_ingresos") // the top step stacks on the 326 step
    expect(calls[1].ok).toBe(true)
    expect(calls[1].columns).not.toContain(COLUMN)
    expect(calls[1].columns).toContain("vendedores_ven_ingresos")
    // Nothing else was dropped or added between the two attempts.
    expect(calls[0].columns).toEqual([...calls[1].columns, COLUMN])
  })

  it("M3 and 326 both missing: the chain continues one step at a time, still keeping everything older", async () => {
    const { calls } = fakeOrganizations(rowWithoutM3({ vendedores_ven_ingresos: undefined }), [COLUMN, "vendedores_ven_ingresos"])
    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.posAgrupaVariantes).toBe(true)
    expect(body.vendedoresVenIngresos).toBe(true) // 326 missing as well: reads true
    expect(body.terminologiaOverrides).toEqual({ orden: "Trabajo" })
    expect(body.tecnicosCobranCotizaciones).toBe(true)

    expect(calls).toHaveLength(3)
    expect(calls[0].columns).toContain(COLUMN)
    expect(calls[1].columns).not.toContain(COLUMN)
    expect(calls[1].columns).toContain("vendedores_ven_ingresos")
    expect(calls[2].columns).not.toContain(COLUMN)
    expect(calls[2].columns).not.toContain("vendedores_ven_ingresos")
    expect(calls[2].columns).toContain("tecnicos_cobran_cotizaciones")
  })

  it("an older database that also misses a legacy column bottoms out at the minimal select without the new column", async () => {
    const { calls } = fakeOrganizations(rowWithoutM3(), [COLUMN, "comprobante_terminos"])
    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.posAgrupaVariantes).toBe(true)
    const last = calls.at(-1)!
    expect(last.ok).toBe(true)
    expect(last.columns).not.toContain(COLUMN)
    expect(last.columns).not.toContain("comprobante_terminos")
    expect(calls.filter((c) => c.columns.includes(COLUMN))).toHaveLength(1) // only the top step carries it
  })
})

describe("PUT /api/configuracion, no-op branch - posAgrupaVariantes", () => {
  it("returns the stored value, not a fabricated one, and writes nothing", async () => {
    const { calls } = fakeOrganizations({ ...FULL_ROW, [COLUMN]: false })
    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await PUT(putRequest({}))) as Response)

    expect(status).toBe(200)
    expect(body.posAgrupaVariantes).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0].columns).toContain(COLUMN)
    expect(calls[0].update).toBeUndefined()
  })

  it("M3 missing: two attempts, the second without the column, nothing written, other settings intact", async () => {
    const { calls } = fakeOrganizations(rowWithoutM3(), [COLUMN])
    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await PUT(putRequest({}))) as Response)

    expect(status).toBe(200)
    expect(body.posAgrupaVariantes).toBe(true)
    expectOtherSettingsSurvived(body)

    expect(calls).toHaveLength(2)
    expect(calls[0].columns).toContain(COLUMN)
    expect(calls[1].ok).toBe(true)
    expect(calls[1].columns).not.toContain(COLUMN)
    expect(calls[0].columns).toEqual([...calls[1].columns, COLUMN])
    expect(calls.every((c) => c.update === undefined)).toBe(true)
  })
})

describe("PUT /api/configuracion, write - posAgrupaVariantes", () => {
  it("persists false and true as booleans, in one query that names the column in payload and select", async () => {
    for (const sent of [false, true]) {
      const { calls, store } = fakeOrganizations({ ...FULL_ROW, [COLUMN]: !sent })
      const { PUT } = await import("@/app/api/configuracion/route")
      const { status, body } = await parseResponse((await PUT(putRequest({ posAgrupaVariantes: sent }))) as Response)

      expect(status).toBe(200)
      expect(body.posAgrupaVariantes).toBe(sent)
      expect(store[COLUMN]).toBe(sent)
      expect(calls).toHaveLength(1)
      expect(calls[0].update).toEqual({ [COLUMN]: sent })
      expect(calls[0].columns).toContain(COLUMN)
    }
  })

  it("coerces what the body carries to a real boolean before it reaches the BOOLEAN column", async () => {
    for (const [sent, expected] of [[0, false], [1, true]] as const) {
      const { calls } = fakeOrganizations({ ...FULL_ROW, [COLUMN]: !expected })
      const { PUT } = await import("@/app/api/configuracion/route")
      const { body } = await parseResponse((await PUT(putRequest({ posAgrupaVariantes: sent }))) as Response)

      expect(calls[0].update).toEqual({ [COLUMN]: expected })
      expect(body.posAgrupaVariantes).toBe(expected)
    }
  })

  it("writes the key only when it was sent: another setting alone leaves the stored preference alone", async () => {
    const { calls, store } = fakeOrganizations({ ...FULL_ROW, [COLUMN]: false })
    const { PUT } = await import("@/app/api/configuracion/route")
    const { body } = await parseResponse((await PUT(putRequest({ umbralStockBajo: 9 }))) as Response)

    expect(calls[0].update).toEqual({ umbral_stock_bajo: 9 })
    expect(calls[0].update).not.toHaveProperty(COLUMN)
    expect(store[COLUMN]).toBe(false)
    expect(body.posAgrupaVariantes).toBe(false)
  })

  it("M3 missing: the retry drops ONLY the key from payload and select; every other setting is saved and returned", async () => {
    const { calls, store } = fakeOrganizations(
      rowWithoutM3({ iva_regimen: "EXENTO", terminologia: {}, cuit: null, vendedores_ven_ingresos: true }),
      [COLUMN],
    )
    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse(
      (await PUT(
        putRequest({
          posAgrupaVariantes: false,
          ivaRegimen: "ADITIVO",
          terminologia: { orden: "Trabajo" },
          cuit: "30-71234567-8",
          vendedoresVenIngresos: false,
          vendedoresAdministranInventario: false,
          tecnicosOperanPos: true,
        }),
      )) as Response,
    )

    expect(status).toBe(200)
    // The preference itself is ignored until M3 is applied: it reads grouped.
    expect(body.posAgrupaVariantes).toBe(true)
    expectOtherSettingsSurvived(body)
    expect(store).not.toHaveProperty(COLUMN)
    expect(store.iva_regimen).toBe("ADITIVO")
    expect(store.cuit).toBe("30-71234567-8")
    expect(store.vendedores_ven_ingresos).toBe(false)

    expect(calls).toHaveLength(2)
    expect(calls[0].errorCode).toBe("PGRST204")
    expect(calls[0].update).toHaveProperty(COLUMN, false)
    expect(calls[0].columns).toContain(COLUMN)
    expect(calls[1].ok).toBe(true)
    expect(calls[1].update).toEqual(without(calls[0].update, COLUMN))
    expect(calls[1].columns).not.toContain(COLUMN)
    expect(calls[0].columns).toEqual([...calls[1].columns, COLUMN])
  })

  it("M3 missing and the body does not carry the key: the RETURNING-only 42703 still triggers the retry, with the same payload", async () => {
    const { calls, store } = fakeOrganizations(rowWithoutM3(), [COLUMN])
    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await PUT(putRequest({ umbralStockBajo: 9 }))) as Response)

    expect(status).toBe(200)
    expect(body.umbralStockBajo).toBe(9)
    expect(store.umbral_stock_bajo).toBe(9)
    expect(body.posAgrupaVariantes).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[0].errorCode).toBe("42703")
    expect(calls[1].update).toEqual({ umbral_stock_bajo: 9 })
    expect(calls[1].columns).not.toContain(COLUMN)
  })

  it("M3 and 326 both missing: the chain continues and the payload loses exactly those two keys", async () => {
    const { calls, store } = fakeOrganizations(rowWithoutM3({ vendedores_ven_ingresos: undefined, iva_regimen: "EXENTO" }), [
      COLUMN,
      "vendedores_ven_ingresos",
    ])
    const { PUT } = await import("@/app/api/configuracion/route")
    const { status } = await parseResponse(
      (await PUT(putRequest({ posAgrupaVariantes: false, vendedoresVenIngresos: false, ivaRegimen: "ADITIVO" }))) as Response,
    )

    expect(status).toBe(200)
    expect(calls).toHaveLength(3)
    expect(calls[0].update).toEqual({ [COLUMN]: false, vendedores_ven_ingresos: false, iva_regimen: "ADITIVO" })
    expect(calls[1].update).toEqual({ vendedores_ven_ingresos: false, iva_regimen: "ADITIVO" })
    expect(calls[2].update).toEqual({ iva_regimen: "ADITIVO" })
    expect(calls[2].ok).toBe(true)
    expect(store.iva_regimen).toBe("ADITIVO")
  })

  it("final minimal fallback: an older database also missing a legacy column never sees the key after its first failure", async () => {
    const { calls, store } = fakeOrganizations(rowWithoutM3(), [COLUMN, "comprobante_terminos"])
    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse(
      (await PUT(putRequest({ posAgrupaVariantes: false, umbralStockBajo: 9, ivaRegimen: "ADITIVO" }))) as Response,
    )

    expect(status).toBe(200)
    expect(body.posAgrupaVariantes).toBe(true)
    const last = calls.at(-1)!
    expect(last.ok).toBe(true)
    expect(last.columns).not.toContain(COLUMN)
    expect(last.columns).not.toContain("comprobante_terminos")
    expect(last.update).toHaveProperty("umbral_stock_bajo", 9)
    expect(last.update).not.toHaveProperty(COLUMN)
    expect(store.umbral_stock_bajo).toBe(9)
    // Only the first attempt carried the key; every retry after it is clean.
    expect(calls[0].update).toHaveProperty(COLUMN, false)
    expect(calls.slice(1).every((c) => !c.update || !(COLUMN in c.update))).toBe(true)
    expect(calls.filter((c) => c.columns.includes(COLUMN))).toHaveLength(1)
  })
})

describe("GET /api/configuracion/operativa - posAgrupaVariantes", () => {
  it("serves false as false and true as true, from the select(*) it already does", async () => {
    for (const stored of [false, true]) {
      const { calls } = fakeOrganizations({ ...FULL_ROW, [COLUMN]: stored })
      mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1" })
      const { GET } = await import("@/app/api/configuracion/operativa/route")
      const { status, body } = await parseResponse((await GET()) as Response)

      expect(status).toBe(200)
      expect(body.posAgrupaVariantes).toBe(stored)
      expect(calls).toHaveLength(1)
      expect(calls[0].select).toBe("*")
    }
  })

  it("reads true when the column does not exist, and when it is null", async () => {
    fakeOrganizations(rowWithoutM3(), [COLUMN])
    mockAuthSuccess({ role: "TECNICO", organizationId: "org-1" })
    const { GET } = await import("@/app/api/configuracion/operativa/route")
    const absent = await parseResponse((await GET()) as Response)
    expect(absent.status).toBe(200)
    expect(absent.body.posAgrupaVariantes).toBe(true)

    fakeOrganizations({ ...FULL_ROW, [COLUMN]: null })
    const nul = await parseResponse((await GET()) as Response)
    expect(nul.body.posAgrupaVariantes).toBe(true)
  })

  it("keeps the fields it served before (operational settings are not displaced by the new one)", async () => {
    fakeOrganizations({ ...FULL_ROW, [COLUMN]: false })
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1" })
    const { GET } = await import("@/app/api/configuracion/operativa/route")
    const { body } = await parseResponse((await GET()) as Response)
    expect(body).toMatchObject({
      moneda: "ARS",
      pais: "AR",
      ivaRegimen: "ADITIVO",
      ivaTasa: 21,
      garantiaDiasDefault: 30,
      posAgrupaVariantes: false,
    })
  })
})

describe("access: the preference is admin-only to read and write through /api/configuracion", () => {
  it("answers 401 without a session and 403 to a non-admin, before touching the database", async () => {
    const { calls } = fakeOrganizations({ ...FULL_ROW })
    const { GET, PUT } = await import("@/app/api/configuracion/route")

    mockAuthError()
    expect((await GET()).status).toBe(401)
    expect((await PUT(putRequest({ posAgrupaVariantes: false }))).status).toBe(401)

    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1" })
    expect((await GET()).status).toBe(403)
    expect((await PUT(putRequest({ posAgrupaVariantes: false }))).status).toBe(403)

    expect(calls).toHaveLength(0)
  })
})
