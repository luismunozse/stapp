import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockAuthSuccess, parseResponse } from "./helpers"

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/ordenes/alcance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ordenes/alcance")>()),
  cargarOrdenEnAlcance: vi.fn(async () => ({ orden: { id: "o1", codigo_orden: "IPH007", numero_orden: 7 } })),
}))
vi.mock("@/lib/storage-privado", () => ({
  firmarReferencias: vi.fn(async (_b: string, refs: unknown[]) => refs.map((r) => (r ? `https://firmada/${r}` : null))),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/ordenes/[id]/pagos-informados/[pagoId]/route"
import { GET } from "@/app/api/ordenes/[id]/pagos-informados/route"

const params = { params: Promise.resolve({ id: "o1", pagoId: "p1" }) }
const post = (body: unknown) =>
  new Request("http://localhost/api/ordenes/o1/pagos-informados/p1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const avisoPendiente = { id: "p1", metodo: "TRANSFERENCIA", monto: "100000", estado: "PENDIENTE" }

function setup(aviso: any = avisoPendiente, update: any = [{ id: "p1" }]) {
  const lectura = createChainMock(aviso)
  const escritura = createChainMock(update)
  const eventos = createChainMock(null)
  let n = 0
  vi.mocked(supabaseAdmin.from).mockImplementation((tabla: string) => {
    if (tabla === "pagos_informados") return (n++ === 0 ? lectura : escritura) as any
    if (tabla === "orden_eventos") return eventos as any
    return createChainMock(null, { message: `sin mock: ${tabla}` }) as any
  })
  return { lectura, escritura, eventos }
}

describe("POST /api/ordenes/[id]/pagos-informados/[pagoId]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("confirmar registra el cobro con la clave del aviso y lo marca CONFIRMADO", async () => {
    const { escritura } = setup()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { replayed: false, response: { orden: { totalCobrado: 100000, estadoCobro: "PARCIAL" } } },
      error: null,
    } as any)

    const res = await POST(post({ accion: "confirmar" }), params)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body).toMatchObject({ estado: "CONFIRMADO", estadoCobro: "PARCIAL" })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "registrar_cobros_orden_atomica",
      expect.objectContaining({
        p_org_id: "org-1",
        p_orden_id: "o1",
        p_pagos: [expect.objectContaining({ monto: 100000, metodo: "TRANSFERENCIA" })],
        p_idempotency_key: "pago-informado:p1",
      }),
    )
    expect(escritura.update).toHaveBeenCalledWith(expect.objectContaining({ estado: "CONFIRMADO", resuelto_por: "user-1" }))
    expect(escritura.eq).toHaveBeenCalledWith("estado", "PENDIENTE")
  })

  it("un aviso ya resuelto no se vuelve a cobrar", async () => {
    setup({ ...avisoPendiente, estado: "CONFIRMADO" })
    const res = await POST(post({ accion: "confirmar" }), params)
    expect((await parseResponse(res)).status).toBe(409)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("si el monto ya no entra en el pendiente, no marca el aviso", async () => {
    const { escritura } = setup()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "El monto total (100000) excede el pendiente (50000)" },
    } as any)
    const res = await POST(post({ accion: "confirmar" }), params)
    expect((await parseResponse(res)).status).toBe(400)
    expect(escritura.update).not.toHaveBeenCalled()
  })

  it("rechazar marca RECHAZADO con el motivo y no cobra", async () => {
    const { escritura, eventos } = setup()
    const res = await POST(post({ accion: "rechazar", motivo: "No me llegó" }), params)
    expect((await parseResponse(res)).status).toBe(200)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    expect(escritura.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "RECHAZADO", motivo_rechazo: "No me llegó" }),
    )
    expect(eventos.insert).toHaveBeenCalledWith(expect.objectContaining({ tipo: "PAGO_INFORMADO_RECHAZADO" }))
  })

  it("404 si el aviso no es de esta orden/organización", async () => {
    setup(null)
    const res = await POST(post({ accion: "confirmar" }), params)
    expect((await parseResponse(res)).status).toBe(404)
  })

  it("un técnico no puede resolver avisos (mismo permiso que cobrar)", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    setup()
    const res = await POST(post({ accion: "confirmar" }), params)
    expect((await parseResponse(res)).status).toBe(403)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})

describe("GET /api/ordenes/[id]/pagos-informados", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("devuelve los avisos con el comprobante firmado", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(() =>
      createChainMock([
        { id: "p1", metodo: "TRANSFERENCIA", monto: "1000", nota: null, comprobante_path: "org-1/pagos-informados/o1/a.png", estado: "PENDIENTE", motivo_rechazo: null, resuelto_at: null, created_at: "2026-11-19T12:00:00Z" },
      ]) as any,
    )
    const res = await GET(new Request("http://localhost/api/ordenes/o1/pagos-informados"), { params: Promise.resolve({ id: "o1" }) })
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.pagos[0]).toMatchObject({ id: "p1", monto: 1000, comprobanteUrl: "https://firmada/org-1/pagos-informados/o1/a.png" })
  })

  it("sin la tabla (migración pendiente) devuelve lista vacía", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(() => createChainMock(null, { message: "relation does not exist" }) as any)
    const res = await GET(new Request("http://localhost/api/ordenes/o1/pagos-informados"), { params: Promise.resolve({ id: "o1" }) })
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.pagos).toEqual([])
  })
})
