// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest"
import { mockAuthSuccess, parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { COMMISSION_CONFIG_DEFAULTS } from "@/lib/commissions/config"
import { GET, PUT } from "@/app/api/comisiones/config/route"

const URL = "http://localhost/api/comisiones/config"
const put = (body: unknown) =>
  PUT(new Request(URL, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))

const ROW_ORG1 = {
  organization_id: "org-1",
  orden_devengo: "ENTREGA_Y_COBRO",
  tecnico_base: "MANO_DE_OBRA",
  recepcion_base: "MONTO_ORDEN",
  recepcion_porcentaje_default: 0,
  reingreso_comisiona: false,
}
const ROW_ORG2 = { ...ROW_ORG1, organization_id: "org-2", orden_devengo: "COBRO", tecnico_base: "MONTO_ORDEN", recepcion_porcentaje_default: 7 }

const BODY = {
  ordenDevengo: "COBRO",
  tecnicoBase: "MONTO_ORDEN",
  recepcionBase: "MANO_DE_OBRA",
  recepcionPorcentajeDefault: 3.5,
  reingresoComisiona: true,
  sinReparacionComisiona: false,
}

describe("/api/comisiones/config", () => {
  beforeEach(() => mockAuthSuccess({ role: "ADMIN", userId: "admin-1" }))

  it("non-admins get 403 on GET and PUT and nothing is written", async () => {
    mockAuthSuccess({ role: "VENDEDOR" })
    const mem = montarSupabaseEnMemoria({ comisiones_config: [ROW_ORG1], organizations: [{ id: "org-1", comision_aplica_sin_reparacion: true }] })
    expect((await parseResponse(await GET())).status).toBe(403)
    expect((await parseResponse(await put(BODY))).status).toBe(403)
    expect(mem.escrituras).toEqual([])
    expect(mem.lecturas).toEqual([])
  })

  it("GET without a row returns the defaults and the org's flag 257", async () => {
    montarSupabaseEnMemoria({ comisiones_config: [], organizations: [{ id: "org-1", comision_aplica_sin_reparacion: true }] })
    const res = await GET()
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(body).toEqual({ ...COMMISSION_CONFIG_DEFAULTS, sinReparacionComisiona: true })
  })

  it("GET never reads another org's row", async () => {
    montarSupabaseEnMemoria({
      comisiones_config: [ROW_ORG1, ROW_ORG2],
      organizations: [
        { id: "org-1", comision_aplica_sin_reparacion: false },
        { id: "org-2", comision_aplica_sin_reparacion: true },
      ],
    })
    const { body } = await parseResponse(await GET())
    expect(body).toEqual({ ...COMMISSION_CONFIG_DEFAULTS, sinReparacionComisiona: false })
  })

  it("PUT upserts the caller's row, updates flag 257 in its org only, and audits before/after", async () => {
    const mem = montarSupabaseEnMemoria({
      comisiones_config: [ROW_ORG1, ROW_ORG2],
      organizations: [
        { id: "org-1", comision_aplica_sin_reparacion: true },
        { id: "org-2", comision_aplica_sin_reparacion: true },
      ],
    })
    const { status, body } = await parseResponse(await put(BODY))
    expect(status).toBe(200)
    expect(body).toEqual(BODY)

    const upsert = mem.escrituras.find((e) => e.tabla === "comisiones_config" && e.operacion === "upsert")!
    expect(upsert.carga).toMatchObject({
      organization_id: "org-1",
      orden_devengo: "COBRO",
      tecnico_base: "MONTO_ORDEN",
      recepcion_base: "MANO_DE_OBRA",
      recepcion_porcentaje_default: 3.5,
      reingreso_comisiona: true,
    })
    expect((upsert.carga as any).updated_at).toEqual(expect.any(String))

    const org = mem.escrituras.find((e) => e.tabla === "organizations")!
    expect(org.operacion).toBe("update")
    expect(org.carga).toEqual({ comision_aplica_sin_reparacion: false })
    expect(org.filtros).toEqual([["eq", "id", "org-1"]])

    const audit = mem.escrituras.find((e) => e.tabla === "audit_logs")!
    expect(audit.carga).toMatchObject({ entity: "comisiones_config", entity_id: "org-1", organization_id: "org-1" })
    const changes = (audit.carga as any).changes
    expect(changes.before.ordenDevengo).toBe("ENTREGA_Y_COBRO")
    expect(changes.after.ordenDevengo).toBe("COBRO")
  })

  it("PUT leaves flag 257 alone when it did not change, and skips the audit when nothing changed", async () => {
    const mem = montarSupabaseEnMemoria({
      comisiones_config: [ROW_ORG1],
      organizations: [{ id: "org-1", comision_aplica_sin_reparacion: false }],
    })
    const { status } = await parseResponse(await put({ ...COMMISSION_CONFIG_DEFAULTS, sinReparacionComisiona: false }))
    expect(status).toBe(200)
    expect(mem.escrituras.some((e) => e.tabla === "organizations")).toBe(false)
    expect(mem.escrituras.some((e) => e.tabla === "audit_logs")).toBe(false)
  })

  it("PUT with 101 is a 400 with the schema's message", async () => {
    const mem = montarSupabaseEnMemoria({ comisiones_config: [], organizations: [{ id: "org-1", comision_aplica_sin_reparacion: false }] })
    const { status, body } = await parseResponse(await put({ ...BODY, recepcionPorcentajeDefault: 101 }))
    expect(status).toBe(400)
    expect(body.error).toBe("El porcentaje de recepción debe estar entre 0 y 100")
    expect(mem.escrituras).toEqual([])
  })
})
