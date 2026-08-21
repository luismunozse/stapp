// @vitest-environment node
/**
 * Covers GET/PUT of the six fiscal identity + collection fields added by
 * migration 295 (cuit, condicion_iva, domicilio_fiscal, cbu_alias,
 * medios_pago_texto, plazo_pago_dias) — RC Task 6 — the facturación
 * electrónica toggle added by migration 296 (facturacion_electronica_habilitada),
 * and the "remito formato clásico" fields added by migration 297
 * (ingresos_brutos, inicio_actividades).
 * Follows the same mock pattern as configuracion-terminologia.test.ts.
 *
 * Also covers graceful degradation: migrations in this project are applied
 * by hand, one file at a time, strictly in increasing order (294 -> 295 ->
 * 296 -> 297 — see the "migraciones se aplican a mano" convention). That
 * ordering means each deployment state below is a prefix of the previous
 * one — a later migration can never be live without every earlier one also
 * being live:
 *   1. Neither 295 nor 296 nor 297 applied yet — full degradation down to
 *      the base columns (fiscal fields, toggle, and 297 pair all absent).
 *   2. 295 applied, 296 (and therefore 297) not yet — the real,
 *      guaranteed-to-happen transient window while this feature rolls out.
 *      The 6 fiscal columns MUST stay intact; the toggle and the 297 pair
 *      both degrade.
 *   3. 295 + 296 applied, 297 not yet — same idea, one tier up: fiscal
 *      columns and the toggle stay intact, only ingresosBrutos/
 *      inicioActividades degrade.
 *   4. All three applied — no degradation at all.
 *
 * The real PostgREST error shape DEPENDS on where the unknown column is
 * referenced:
 *   - a pure SELECT (GET, the no-op PUT branch, or a PUT's RETURNING clause
 *     when the write payload itself doesn't touch the unknown column) gets
 *     Postgres' own 42703 ("column ... does not exist") — NOT PGRST204.
 *   - a write payload that itself names an unknown column (e.g. `cuit` in
 *     the JSON body) gets PostgREST's schema-cache PGRST204 instead, since
 *     that's checked before any SQL is even built.
 * Tests below use whichever shape actually applies to the scenario, so they
 * pin the real contract instead of a guess (see lib/db-errors.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

function baseOrgRow(overrides: Record<string, any> = {}) {
  return {
    id: "org-1",
    logo_url: null,
    logo_path: null,
    nombre_mostrar: "Test Org",
    nombre: "Test Org",
    email: "test@test.com",
    telefono: null,
    direccion: null,
    ciudad: null,
    provincia: null,
    codigo_postal: null,
    moneda: "ARS",
    zona_horaria: "America/Argentina/Buenos_Aires",
    umbral_stock_bajo: 5,
    iva_porcentaje: 0,
    cotizacion_validez_dias: 30,
    cotizacion_terminos: null,
    recepcion_terminos: null,
    comprobante_terminos: null,
    garantia_dias_default: 30,
    politica_abandono_dias_default: 60,
    anticipo_porcentaje_default: 50,
    pais: "AR",
    modulo_agenda: false,
    vendedores_administran_inventario: false,
    iva_regimen: "EXENTO",
    iva_tasa: 21,
    redondeo_efectivo: 0,
    comision_aplica_sin_reparacion: false,
    terminologia: {},
    ...overrides,
  }
}

describe("/api/configuracion — datos fiscales y de cobro", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it("GET returns the six fiscal fields when present on the org row", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const orgData = baseOrgRow({
      cuit: "30-71234567-8",
      condicion_iva: "Responsable Inscripto",
      domicilio_fiscal: "Av. Siempreviva 742",
      cbu_alias: "taller.alias.mp",
      medios_pago_texto: "Efectivo, transferencia",
      plazo_pago_dias: 15,
    })
    mockSupabaseFrom({ organizations: createChainMock(orgData) })
    const { GET } = await import("@/app/api/configuracion/route")
    const res = await GET()
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.condicionIva).toBe("Responsable Inscripto")
    expect(body.domicilioFiscal).toBe("Av. Siempreviva 742")
    expect(body.cbuAlias).toBe("taller.alias.mp")
    expect(body.mediosPagoTexto).toBe("Efectivo, transferencia")
    expect(body.plazoPagoDias).toBe(15)
  })

  it("GET returns ingresosBrutos and inicioActividades when present on the org row (migration 297 applied)", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const orgData = baseOrgRow({
      cuit: "30-71234567-8",
      ingresos_brutos: "902-123456-7",
      inicio_actividades: "01/2020",
    })
    const chain = createChainMock(orgData)
    mockSupabaseFrom({ organizations: chain })
    const { GET } = await import("@/app/api/configuracion/route")
    const res = await GET()
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.ingresosBrutos).toBe("902-123456-7")
    expect(body.inicioActividades).toBe("01/2020")
    expect(chain.single).toHaveBeenCalledTimes(1)
    // Pin down that the (only, no-degradation) select actually asked for the
    // 297 columns — createChainMock ignores the select() string when
    // resolving `data`, so this is the only thing that pins the column list.
    expect(chain.select.mock.calls[0][0]).toContain("ingresos_brutos")
    expect(chain.select.mock.calls[0][0]).toContain("inicio_actividades")
  })

  it("GET defaults the fiscal fields to empty/null when absent on the org row", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    mockSupabaseFrom({ organizations: createChainMock(baseOrgRow()) })
    const { GET } = await import("@/app/api/configuracion/route")
    const res = await GET()
    const { body } = await parseResponse(res as Response)

    expect(body.cuit).toBe("")
    expect(body.condicionIva).toBe("")
    expect(body.domicilioFiscal).toBe("")
    expect(body.cbuAlias).toBe("")
    expect(body.mediosPagoTexto).toBe("")
    expect(body.plazoPagoDias).toBeNull()
    expect(body.ingresosBrutos).toBe("")
    expect(body.inicioActividades).toBe("")
  })

  it("GET degrades gracefully when neither migration 295 nor 296 nor 297 has run, still returning the rest of the config", async () => {
    // State 1: nothing applied. The first attempt (fiscal + toggle + 297
    // columns) fails, the retry without 297 STILL fails (296 missing too),
    // the retry without the toggle STILL fails because the 6 fiscal columns
    // are also missing, so a fourth attempt without any of them is required.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const orgData = baseOrgRow()
    const chain = createChainMock()
    chain.single = vi
      .fn()
      // GET is a pure SELECT (no .update()): a real PostgREST/Postgres
      // missing-column error here is 42703, not PGRST204 — PGRST204 only
      // fires for write payloads naming an unknown column.
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column organizations.ingresos_brutos does not exist" } })
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column organizations.facturacion_electronica_habilitada does not exist" } })
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column organizations.cuit does not exist" } })
      .mockResolvedValueOnce({ data: orgData, error: null })
    mockSupabaseFrom({ organizations: chain })

    const { GET } = await import("@/app/api/configuracion/route")
    const res = await GET()
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.nombreEmpresa).toBe("Test Org")
    expect(body.cuit).toBe("")
    expect(body.plazoPagoDias).toBeNull()
    expect(body.ingresosBrutos).toBe("")
    expect(body.inicioActividades).toBe("")
    expect(body.facturacionElectronicaHabilitada).toBe(false)
    expect(chain.single).toHaveBeenCalledTimes(4)
    // Pin down that the succeeding (4th) attempt is genuinely the base
    // select and not the much older pre-072 legacy fallback further down in
    // the route — both happen to also sit at "4 total attempts" here, so
    // without this the test would pass by call-count coincidence alone
    // (mocked `data` doesn't depend on which select() string was sent).
    const selectCallArgs = chain.select.mock.calls.map((c: any[]) => c[0])
    expect(selectCallArgs[3]).toContain("recepcion_terminos")
  })

  it("GET degrades gracefully when only migration 296 hasn't run (295 applied) — the six fiscal fields stay intact, only the toggle and the 297 pair degrade", async () => {
    // State 2: 295 applied, 296 (and therefore 297) not. The first attempt
    // (297 columns) fails, the retry without 297 STILL fails because the
    // toggle (296) is also missing, so a third attempt with just the 295
    // fiscal columns is required and succeeds.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const orgData = baseOrgRow({
      cuit: "30-71234567-8",
      condicion_iva: "Responsable Inscripto",
      domicilio_fiscal: "Av. Siempreviva 742",
      cbu_alias: "taller.alias.mp",
      medios_pago_texto: "Efectivo, transferencia",
      plazo_pago_dias: 15,
      // facturacion_electronica_habilitada and the 297 pair intentionally
      // absent: those columns don't exist in this environment yet.
    })
    const chain = createChainMock()
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column organizations.ingresos_brutos does not exist" } })
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column organizations.facturacion_electronica_habilitada does not exist" } })
      .mockResolvedValueOnce({ data: orgData, error: null })
    mockSupabaseFrom({ organizations: chain })

    const { GET } = await import("@/app/api/configuracion/route")
    const res = await GET()
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.condicionIva).toBe("Responsable Inscripto")
    expect(body.domicilioFiscal).toBe("Av. Siempreviva 742")
    expect(body.cbuAlias).toBe("taller.alias.mp")
    expect(body.mediosPagoTexto).toBe("Efectivo, transferencia")
    expect(body.plazoPagoDias).toBe(15)
    expect(body.ingresosBrutos).toBe("")
    expect(body.inicioActividades).toBe("")
    expect(body.facturacionElectronicaHabilitada).toBe(false)
    expect(chain.single).toHaveBeenCalledTimes(3)
    // Pin down that the succeeding (3rd) attempt is genuinely the 295-only
    // fiscal select (has cuit, lacks the toggle and the 297 pair) — a bug
    // that skipped straight to the base select would still pass the body
    // assertions above since the mocked `data` is fixed regardless of what
    // was selected.
    const selectCallArgs = chain.select.mock.calls.map((c: any[]) => c[0])
    expect(selectCallArgs[2]).toContain("cuit")
    expect(selectCallArgs[2]).not.toContain("facturacion_electronica_habilitada")
    expect(selectCallArgs[2]).not.toContain("ingresos_brutos")
  })

  it("GET degrades gracefully when only migration 297 hasn't run (295 + 296 applied) — fiscal fields and the toggle stay intact, only ingresosBrutos/inicioActividades degrade", async () => {
    // State 3: 295 + 296 applied, 297 not. Only the first attempt (which
    // also asks for ingresos_brutos/inicio_actividades) fails; the retry
    // without the 297 pair succeeds, so the fiscal data AND the toggle must
    // come back exactly as stored.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const orgData = baseOrgRow({
      cuit: "30-71234567-8",
      condicion_iva: "Responsable Inscripto",
      facturacion_electronica_habilitada: true,
      // ingresos_brutos / inicio_actividades intentionally absent: 297
      // hasn't run in this environment yet.
    })
    const chain = createChainMock()
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column organizations.ingresos_brutos does not exist" } })
      .mockResolvedValueOnce({ data: orgData, error: null })
    mockSupabaseFrom({ organizations: chain })

    const { GET } = await import("@/app/api/configuracion/route")
    const res = await GET()
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.condicionIva).toBe("Responsable Inscripto")
    expect(body.facturacionElectronicaHabilitada).toBe(true)
    expect(body.ingresosBrutos).toBe("")
    expect(body.inicioActividades).toBe("")
    expect(chain.single).toHaveBeenCalledTimes(2)
    // Pin down which columns were actually requested at each tier — a bug
    // that dropped the toggle instead of just the 297 pair would still pass
    // the assertions above, since this harness's mocked data doesn't depend
    // on what was selected.
    expect(chain.select.mock.calls[0][0]).toContain("ingresos_brutos")
    const retrySelectCall = chain.select.mock.calls[1][0] as string
    expect(retrySelectCall).not.toContain("ingresos_brutos")
    expect(retrySelectCall).toContain("facturacion_electronica_habilitada")
    expect(retrySelectCall).toContain("cuit")
  })

  it("GET returns everything with no degradation when migrations 295, 296 and 297 are all applied", async () => {
    // State 4: everything applied, first attempt succeeds outright.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const orgData = baseOrgRow({
      cuit: "30-71234567-8",
      facturacion_electronica_habilitada: true,
      ingresos_brutos: "902-123456-7",
      inicio_actividades: "01/2020",
    })
    const chain = createChainMock(orgData)
    mockSupabaseFrom({ organizations: chain })

    const { GET } = await import("@/app/api/configuracion/route")
    const res = await GET()
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.facturacionElectronicaHabilitada).toBe(true)
    expect(body.ingresosBrutos).toBe("902-123456-7")
    expect(body.inicioActividades).toBe("01/2020")
    expect(chain.single).toHaveBeenCalledTimes(1)
  })

  it("PUT persists the six fiscal fields", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const updatedRow = baseOrgRow({
      cuit: "30-71234567-8",
      condicion_iva: "Monotributo",
      domicilio_fiscal: "Calle Falsa 123",
      cbu_alias: "mi.alias",
      medios_pago_texto: "Efectivo",
      plazo_pago_dias: 30,
    })
    mockSupabaseFrom({ organizations: createChainMock(updatedRow) })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cuit: "30-71234567-8",
        condicionIva: "Monotributo",
        domicilioFiscal: "Calle Falsa 123",
        cbuAlias: "mi.alias",
        mediosPagoTexto: "Efectivo",
        plazoPagoDias: "30",
      }),
    })
    const res = await PUT(request)
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.condicionIva).toBe("Monotributo")
    expect(body.domicilioFiscal).toBe("Calle Falsa 123")
    expect(body.cbuAlias).toBe("mi.alias")
    expect(body.mediosPagoTexto).toBe("Efectivo")
    expect(body.plazoPagoDias).toBe(30)
  })

  it("PUT persists ingresosBrutos and inicioActividades (migration 297 applied)", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const updatedRow = baseOrgRow({
      cuit: "30-71234567-8",
      ingresos_brutos: "902-123456-7",
      inicio_actividades: "01/2020",
    })
    mockSupabaseFrom({ organizations: createChainMock(updatedRow) })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cuit: "30-71234567-8",
        ingresosBrutos: "902-123456-7",
        inicioActividades: "01/2020",
      }),
    })
    const res = await PUT(request)
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.ingresosBrutos).toBe("902-123456-7")
    expect(body.inicioActividades).toBe("01/2020")
  })

  it("PUT rejects an unknown condicionIva value (leaves it unset)", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const chain = createChainMock(baseOrgRow())
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // telefono is included so updateData isn't empty (an empty updateData
      // takes the no-op "return current state" branch, which never calls
      // .update() at all — see the empty-updateData test below).
      body: JSON.stringify({ telefono: "123", condicionIva: "Cosa Inventada" }),
    })
    const res = await PUT(request)
    const { status } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ condicion_iva: expect.anything() })
    )
  })

  it("PUT clears plazoPagoDias to null on empty string", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const chain = createChainMock(baseOrgRow({ plazo_pago_dias: null }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plazoPagoDias: "" }),
    })
    await PUT(request)

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ plazo_pago_dias: null })
    )
  })

  it("PUT degrades gracefully when neither migration 295 nor 296 nor 297 has run (PGRST204 on the fiscal columns), still persisting the rest of the update", async () => {
    // State 1: nothing applied. The write payload names `cuit` (unknown), so
    // PGRST204 fires on the full attempt AND on the 297-only-stripped and
    // 296-only-stripped retries (cuit is still in the payload at that point —
    // dropping the 297 pair or the toggle alone doesn't fix a 295-shaped
    // rejection). Only the fourth attempt, which finally drops the 6 fiscal
    // fields, succeeds.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const chain = createChainMock()
    chain.single = vi
      .fn()
      // Here the write PAYLOAD itself names cuit (an unknown column), so
      // this one genuinely gets PGRST204 from PostgREST's schema-cache
      // precheck — unlike the SELECT-only sites above/below.
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204" } })
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204" } })
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204" } })
      .mockResolvedValueOnce({ data: baseOrgRow({ telefono: "123456" }), error: null })
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telefono: "123456", cuit: "30-71234567-8" }),
    })
    const res = await PUT(request)
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.telefono).toBe("123456")
    expect(chain.single).toHaveBeenCalledTimes(4)
    // Pin down that the succeeding attempt is genuinely the (new) pre-295
    // tier and not the much older pre-072 legacy fallback a few lines below
    // it in the route — both happen to also sit at "4 total attempts" for
    // this specific payload, so without this the test would pass by
    // call-count coincidence alone (mocked `data` doesn't depend on which
    // select() string was actually sent).
    const selectCallArgs = chain.select.mock.calls.map((c: any[]) => c[0])
    expect(selectCallArgs[3]).toContain("recepcion_terminos")
  })

  it("PUT degrades gracefully when only migration 296 hasn't run (295 applied, 297 therefore not either) — fiscal fields are still persisted, only the toggle and the 297 pair are dropped", async () => {
    // State 2: the real, guaranteed transient window. The write payload
    // names facturacionElectronicaHabilitada (unknown), so PGRST204 fires on
    // the full attempt AND on the 297-only-stripped retry (facturacion
    // electronica isn't touched by dropping the 297 pair); the third attempt
    // drops the toggle too and succeeds because the 6 fiscal columns DO
    // exist (295 already applied) — cuit must survive.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const updateCalls: any[] = []
    const chain = createChainMock()
    chain.update = vi.fn((data: any) => {
      updateCalls.push({ ...data })
      return chain
    })
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204" } })
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204" } })
      .mockResolvedValueOnce({ data: baseOrgRow({ cuit: "30-71234567-8" }), error: null })
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cuit: "30-71234567-8", facturacionElectronicaHabilitada: true }),
    })
    const res = await PUT(request)
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.facturacionElectronicaHabilitada).toBe(false)
    expect(chain.single).toHaveBeenCalledTimes(3)
    // Pin down that the succeeding attempt's ACTUAL write payload still
    // names cuit — without this, a bug that let the 295-drop tier fire
    // instead (stripping cuit for real) would still pass, since the mocked
    // `data` a test hands back is fixed regardless of what was written.
    expect(updateCalls).toHaveLength(3)
    expect(updateCalls[2]).toHaveProperty("cuit", "30-71234567-8")
  })

  it("PUT degrades gracefully when only migration 297 hasn't run (295 + 296 applied) — fiscal fields and the toggle persist, only the 297 pair is dropped", async () => {
    // State 3: 295 + 296 applied, 297 not. The write payload names
    // ingresosBrutos/inicioActividades (unknown columns), so PGRST204 fires
    // genuinely on the full attempt; the retry drops just the 297 pair and
    // succeeds because the 6 fiscal columns and the toggle DO exist.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const updateCalls: any[] = []
    const chain = createChainMock()
    chain.update = vi.fn((data: any) => {
      updateCalls.push({ ...data })
      return chain
    })
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204" } })
      .mockResolvedValueOnce({
        data: baseOrgRow({ cuit: "30-71234567-8", facturacion_electronica_habilitada: true }),
        error: null,
      })
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cuit: "30-71234567-8",
        ingresosBrutos: "902-123456-7",
        inicioActividades: "01/2020",
      }),
    })
    const res = await PUT(request)
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.cuit).toBe("30-71234567-8")
    expect(chain.single).toHaveBeenCalledTimes(2)
    expect(updateCalls).toHaveLength(2)
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        cuit: "30-71234567-8",
        ingresos_brutos: "902-123456-7",
        inicio_actividades: "01/2020",
      })
    )
    expect(updateCalls[1]).toEqual(expect.objectContaining({ cuit: "30-71234567-8" }))
    expect(updateCalls[1]).not.toHaveProperty("ingresos_brutos")
    expect(updateCalls[1]).not.toHaveProperty("inicio_actividades")
  })

  it("PUT persists the fiscal fields, the toggle, and the 297 pair with no degradation when migrations 295, 296 and 297 are all applied", async () => {
    // State 4: everything applied, first attempt succeeds outright.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const chain = createChainMock(
      baseOrgRow({
        cuit: "30-71234567-8",
        facturacion_electronica_habilitada: true,
        ingresos_brutos: "902-123456-7",
        inicio_actividades: "01/2020",
      })
    )
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cuit: "30-71234567-8",
        facturacionElectronicaHabilitada: true,
        ingresosBrutos: "902-123456-7",
        inicioActividades: "01/2020",
      }),
    })
    const res = await PUT(request)
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.facturacionElectronicaHabilitada).toBe(true)
    expect(body.ingresosBrutos).toBe("902-123456-7")
    expect(body.inicioActividades).toBe("01/2020")
    expect(chain.single).toHaveBeenCalledTimes(1)
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        cuit: "30-71234567-8",
        facturacion_electronica_habilitada: true,
        ingresos_brutos: "902-123456-7",
        inicio_actividades: "01/2020",
      })
    )
  })

  it("PUT degrades on a 42703 RETURNING-only error when the write payload has no fiscal fields at all", async () => {
    // The scenario the Critical finding actually described: a PUT that only
    // touches an existing field (telefono, no fiscal keys in the body) still
    // unconditionally asks for the 6 fiscal columns in .select(selectColsFull)
    // (the RETURNING clause). Since the write payload itself never mentions
    // an unknown column, PostgREST's schema-cache precheck has nothing to
    // reject — the query reaches Postgres, which raises 42703 on the
    // RETURNING list instead. A PGRST204-only guard would never catch this,
    // so this exact request (which has nothing to do with fiscal data) would
    // fail outright with a raw 500 instead of retrying.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const chain = createChainMock()
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column organizations.cuit does not exist" } })
      .mockResolvedValueOnce({ data: baseOrgRow({ telefono: "555-0100" }), error: null })
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telefono: "555-0100" }), // no fiscal fields in the body at all
    })
    const res = await PUT(request)
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.telefono).toBe("555-0100")
  })

  it("PUT with no changed fields (no-op branch) selects the fiscal + legacy-fiscal columns, not the narrow base list", async () => {
    // Regression for the no-op early-return at the top of PUT: it used to
    // .select(selectCols), which omits recepcion_terminos/comprobante_terminos
    // AND the 6 new fiscal columns — so the response silently echoed empty
    // fiscal data regardless of what was actually stored. createChainMock
    // ignores the select() column string when resolving `data` (fixture data
    // is fixture data no matter what string is passed), so the only way to
    // observe this bug/fix is asserting on the SELECT string itself.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const chain = createChainMock(baseOrgRow({ cuit: "30-1", condicion_iva: "Monotributo" }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), // no fields => updateData stays empty => no-op branch
    })
    const res = await PUT(request)
    const { status } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(chain.update).not.toHaveBeenCalled() // confirms this hit the no-op branch, not a real update
    const selectCallArgs = chain.select.mock.calls.map((c: any[]) => c[0])
    expect(selectCallArgs.some((s: string) => s.includes("cuit") && s.includes("condicion_iva"))).toBe(true)
    expect(selectCallArgs.some((s: string) => s.includes("recepcion_terminos"))).toBe(true)
    expect(selectCallArgs.some((s: string) => s.includes("ingresos_brutos"))).toBe(true)
  })

  it("PUT no-op branch degrades to the pre-295 select when neither migration 295 nor 296 nor 297 has run", async () => {
    // State 1: nothing applied — the full attempt, the 297-only-stripped
    // retry, and the 296-only-stripped retry all still ask for the 6 fiscal
    // columns, so all three fail; only the fourth attempt (pre-295) succeeds.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const chain = createChainMock()
    chain.single = vi
      .fn()
      // No-op branch is a pure SELECT too (no .update()): real error is 42703.
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column organizations.ingresos_brutos does not exist" } })
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column organizations.facturacion_electronica_habilitada does not exist" } })
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column organizations.cuit does not exist" } })
      .mockResolvedValueOnce({ data: baseOrgRow({ recepcion_terminos: "Ver adjunto" }), error: null })
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const res = await PUT(request)
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.recepcionTerminos).toBe("Ver adjunto")
    const selectCallArgs = chain.select.mock.calls.map((c: any[]) => c[0])
    expect(selectCallArgs[0]).toContain("cuit") // first attempt: full select (295 + 296 + 297)
    expect(selectCallArgs[0]).toContain("facturacion_electronica_habilitada")
    expect(selectCallArgs[0]).toContain("ingresos_brutos")
    expect(selectCallArgs[1]).toContain("cuit") // retry: 297 pair dropped, 295 + 296 kept
    expect(selectCallArgs[1]).toContain("facturacion_electronica_habilitada")
    expect(selectCallArgs[1]).not.toContain("ingresos_brutos")
    expect(selectCallArgs[2]).toContain("cuit") // retry: 296 toggle dropped too, fiscal columns kept
    expect(selectCallArgs[2]).not.toContain("facturacion_electronica_habilitada")
    expect(selectCallArgs[3]).not.toContain("cuit") // final retry: pre-295, fiscal columns dropped too
    expect(selectCallArgs[3]).toContain("recepcion_terminos") // but the rest survives
  })

  it("PUT no-op branch keeps the fiscal columns and only degrades the toggle and the 297 pair when only migration 296 hasn't run", async () => {
    // State 2: 295 applied, 296 (and therefore 297) not — the retry that
    // drops the 297 pair still fails (296 missing too), so the next retry
    // that also drops the toggle must succeed and surface the fiscal data.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const chain = createChainMock()
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column organizations.ingresos_brutos does not exist" } })
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column organizations.facturacion_electronica_habilitada does not exist" } })
      .mockResolvedValueOnce({ data: baseOrgRow({ cuit: "30-71234567-8", recepcion_terminos: "Ver adjunto" }), error: null })
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const res = await PUT(request)
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.recepcionTerminos).toBe("Ver adjunto")
    expect(body.facturacionElectronicaHabilitada).toBe(false)
    expect(body.ingresosBrutos).toBe("")
    const selectCallArgs = chain.select.mock.calls.map((c: any[]) => c[0])
    expect(selectCallArgs[2]).toContain("cuit")
    expect(selectCallArgs[2]).not.toContain("facturacion_electronica_habilitada")
  })

  it("PUT no-op branch keeps the fiscal columns and the toggle, degrading only the 297 pair when only migration 297 hasn't run", async () => {
    // State 3: 295 + 296 applied, 297 not — the retry that drops the 297
    // pair alone succeeds because the fiscal columns and the toggle DO exist.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const chain = createChainMock()
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column organizations.ingresos_brutos does not exist" } })
      .mockResolvedValueOnce({
        data: baseOrgRow({ cuit: "30-71234567-8", facturacion_electronica_habilitada: true }),
        error: null,
      })
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const res = await PUT(request)
    const { status, body } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(body.cuit).toBe("30-71234567-8")
    expect(body.facturacionElectronicaHabilitada).toBe(true)
    expect(body.ingresosBrutos).toBe("")
    expect(body.inicioActividades).toBe("")
    const selectCallArgs = chain.select.mock.calls.map((c: any[]) => c[0])
    expect(selectCallArgs[1]).toContain("cuit")
    expect(selectCallArgs[1]).toContain("facturacion_electronica_habilitada")
    expect(selectCallArgs[1]).not.toContain("ingresos_brutos")
  })

  it("PUT under PGRST204 retains an at-risk existing field (ivaRegimen) while dropping the fiscal field", async () => {
    // The claim that "other existing fields survive the tier" was previously
    // untested — the only PGRST204-PUT test sent telefono, which was never at
    // risk of being stripped by the fiscal-column retry. This sends an
    // existing field from an earlier "might not exist" tier (iva_regimen,
    // migration 229) alongside a new fiscal field (migration 295, not
    // applied) and asserts the RETRY payload keeps iva_regimen but drops cuit.
    //
    // Nothing is applied here, so the write payload's `cuit` is still
    // unknown after the 297-only-stripped retry (no 297 keys were in the
    // payload to begin with) AND after the 296-only-stripped retry (that one
    // only drops facturacion_electronica_habilitada, also never in the
    // payload) — calls 0, 1 and 2 are therefore identical, and only call 3
    // (the pre-295 retry) finally drops cuit.
    //
    // The route mutates `updateData` in place (delete updateData.cuit, etc.)
    // and passes that same reference to .update() every time, so inspecting
    // chain.update.mock.calls[n][0] AFTER the route finishes would just show
    // the final, already-mutated object for ALL calls (mock.calls stores
    // references, not snapshots). Capturing a shallow copy at call time via
    // a custom mockImplementation sidesteps that.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const updateCalls: any[] = []
    const chain = createChainMock()
    chain.update = vi.fn((data: any) => {
      updateCalls.push({ ...data })
      return chain
    })
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204" } })
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204" } })
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204" } })
      .mockResolvedValueOnce({ data: baseOrgRow({ iva_regimen: "INCLUIDO" }), error: null })
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ivaRegimen: "INCLUIDO", cuit: "30-71234567-8" }),
    })
    const res = await PUT(request)
    const { status } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(updateCalls).toHaveLength(4)
    expect(updateCalls[0]).toEqual(expect.objectContaining({ iva_regimen: "INCLUIDO", cuit: "30-71234567-8" }))
    expect(updateCalls[1]).toEqual(expect.objectContaining({ iva_regimen: "INCLUIDO", cuit: "30-71234567-8" }))
    expect(updateCalls[2]).toEqual(expect.objectContaining({ iva_regimen: "INCLUIDO", cuit: "30-71234567-8" }))
    expect(updateCalls[3]).toEqual(expect.objectContaining({ iva_regimen: "INCLUIDO" }))
    expect(updateCalls[3]).not.toHaveProperty("cuit")
  })

  it("PUT under PGRST204 drops only the toggle (keeps cuit) when just migration 296 hasn't run", async () => {
    // Mirrors the test above for state 2: 295 applied, so cuit must survive
    // the retries that drop the 297 pair and then the toggle
    // (facturacionElectronicaHabilitada, unknown since 296 hasn't run
    // either) — those two retries fail identically until the toggle is gone.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const updateCalls: any[] = []
    const chain = createChainMock()
    chain.update = vi.fn((data: any) => {
      updateCalls.push({ ...data })
      return chain
    })
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204" } })
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204" } })
      .mockResolvedValueOnce({ data: baseOrgRow({ iva_regimen: "INCLUIDO", cuit: "30-71234567-8" }), error: null })
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ivaRegimen: "INCLUIDO", cuit: "30-71234567-8", facturacionElectronicaHabilitada: true }),
    })
    const res = await PUT(request)
    const { status } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(updateCalls).toHaveLength(3)
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({ iva_regimen: "INCLUIDO", cuit: "30-71234567-8", facturacion_electronica_habilitada: true })
    )
    expect(updateCalls[1]).toEqual(
      expect.objectContaining({ iva_regimen: "INCLUIDO", cuit: "30-71234567-8", facturacion_electronica_habilitada: true })
    )
    expect(updateCalls[2]).toEqual(expect.objectContaining({ iva_regimen: "INCLUIDO", cuit: "30-71234567-8" }))
    expect(updateCalls[2]).not.toHaveProperty("facturacion_electronica_habilitada")
  })

  it("PUT under PGRST204 drops only the 297 pair (keeps cuit and the toggle) when just migration 297 hasn't run", async () => {
    // State 3: 295 + 296 applied, 297 not. Only the first attempt (which
    // names ingresosBrutos in the payload) fails; the retry drops just the
    // 297 pair and succeeds, keeping iva_regimen, cuit and the toggle.
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const updateCalls: any[] = []
    const chain = createChainMock()
    chain.update = vi.fn((data: any) => {
      updateCalls.push({ ...data })
      return chain
    })
    chain.single = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST204" } })
      .mockResolvedValueOnce({
        data: baseOrgRow({ iva_regimen: "INCLUIDO", cuit: "30-71234567-8", facturacion_electronica_habilitada: true }),
        error: null,
      })
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const request = new Request("http://localhost:3000/api/configuracion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ivaRegimen: "INCLUIDO",
        cuit: "30-71234567-8",
        facturacionElectronicaHabilitada: true,
        ingresosBrutos: "902-123456-7",
      }),
    })
    const res = await PUT(request)
    const { status } = await parseResponse(res as Response)

    expect(status).toBe(200)
    expect(updateCalls).toHaveLength(2)
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        iva_regimen: "INCLUIDO",
        cuit: "30-71234567-8",
        facturacion_electronica_habilitada: true,
        ingresos_brutos: "902-123456-7",
      })
    )
    expect(updateCalls[1]).toEqual(
      expect.objectContaining({ iva_regimen: "INCLUIDO", cuit: "30-71234567-8", facturacion_electronica_habilitada: true })
    )
    expect(updateCalls[1]).not.toHaveProperty("ingresos_brutos")
  })
})
