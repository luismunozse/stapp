/**
 * ADMIN and the branch switcher: the switcher narrows LISTS only. A by-id link to a
 * record of another branch must keep working for an ADMIN (same as ordenes/[id]).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { GET as getGarantia, } from "@/app/api/garantias/[id]/route"
import { GET as listGarantias } from "@/app/api/garantias/route"
import { POST as postReclamo } from "@/app/api/garantias/[id]/reclamos/route"
import { GET as getCotizacion } from "@/app/api/cotizaciones/[id]/route"
import { GET as pdfCotizacion } from "@/app/api/cotizaciones/[id]/pdf/route"
import { POST as enviarCotizacion } from "@/app/api/cotizaciones/[id]/enviar/route"
import { POST as aprobarCotizacion } from "@/app/api/cotizaciones/[id]/aprobar/route"
import { GET as getNotificaciones } from "@/app/api/notificaciones/route"
import { GET as getTurno } from "@/app/api/turnos/[id]/route"
import { GET as getCliente } from "@/app/api/clientes/[id]/route"
import { GET as getCompromisos } from "@/app/api/ordenes/compromisos/route"

const A = "sucursal-a"
const B = "sucursal-b"
const idCtx = { params: Promise.resolve({ id: "x-1" }) }

function cookieEn(sucursal: string) {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn((n: string) => (n === "stapp-sucursal-activa" ? { value: sucursal } : undefined)),
    set: vi.fn(),
  } as any)
}

const ordenDeB = { id: "o", sucursal_id: B, tecnico_id: null, organization_id: "org-1", clientes: null }

describe("ADMIN with the switcher on branch A, by-id records of branch B", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cookieEn(A)
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("garantias/[id] is not narrowed", async () => {
    const garantias = createChainMock(null, { message: "no rows" })
    mockSupabaseFrom({ garantias })
    await getGarantia(createGetRequest(), idCtx)
    expect(garantias.eq).not.toHaveBeenCalledWith("ordenes_servicio.sucursal_id", expect.anything())
    expect(garantias.or).not.toHaveBeenCalled()
  })

  it("garantias/[id]/reclamos POST reaches a warranty of another branch", async () => {
    mockSupabaseFrom({
      garantias: createChainMock({
        id: "g",
        estado: "ACTIVA",
        fecha_vencimiento: new Date(Date.now() + 864e5).toISOString(),
        ordenes_servicio: { organization_id: "org-1", sucursal_id: B, tecnico_id: null },
      }),
      reclamos_garantia: createChainMock({ id: "r" }),
    })
    const { status } = await parseResponse(await postReclamo(createPostRequest({ descripcion: "x" }), idCtx))
    expect(status).toBe(201)
  })

  it("cotizaciones/[id] GET returns a quote linked to another branch's order", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock({ id: "c", orden_id: "o", ordenes_servicio: ordenDeB, items_cotizacion: [] }),
    })
    const { status } = await parseResponse(await getCotizacion(createGetRequest(), idCtx))
    expect(status).toBe(200)
  })

  it("cotizaciones pdf / enviar / aprobar do not answer 404 for it", async () => {
    const cot = { id: "c", orden_id: "o", estado: "ENVIADA", ordenes_servicio: ordenDeB, items_cotizacion: [] }
    mockSupabaseFrom({ cotizaciones: createChainMock(cot), ordenes_servicio: createChainMock(ordenDeB) })
    for (const llamar of [
      () => pdfCotizacion(createGetRequest(), idCtx),
      () => enviarCotizacion(createPostRequest({}), idCtx),
      () => aprobarCotizacion(createPostRequest({}), idCtx),
    ]) {
      const { status, body } = await parseResponse(await llamar())
      expect(`${status} ${body?.error ?? ""}`).not.toMatch(/^404 Cotizaci/)
    }
  })

  it("notificaciones with ?ordenId= does not look the order up", async () => {
    const ordenes = createChainMock(ordenDeB)
    mockSupabaseFrom({ notification_logs: createChainMock([{ id: "l" }]), ordenes_servicio: ordenes })
    const { status } = await parseResponse(
      await getNotificaciones(createGetRequest("http://localhost/api/notificaciones?ordenId=o"))
    )
    expect(status).toBe(200)
    expect(ordenes.select).not.toHaveBeenCalled()
  })

  it("turnos/[id] reads a turno of another branch", async () => {
    mockSupabaseFrom({
      turnos: createChainMock({
        id: "t",
        sucursal_id: B,
        tecnico_id: null,
        inicio: "2026-08-01T10:00:00Z",
        fin: "2026-08-01T11:00:00Z",
        estado: "programado",
      }),
    })
    const { status } = await parseResponse(await getTurno(createGetRequest(), idCtx))
    expect(status).toBe(200)
  })

  it("clientes/[id] keeps the client's full order history", async () => {
    const clientes = createChainMock({ id: "c", nombre: "Ana", ordenes_servicio: [], sectores_cliente: [] })
    mockSupabaseFrom({ clientes })
    await getCliente(createGetRequest(), idCtx)
    expect(clientes.eq).not.toHaveBeenCalledWith("ordenes_servicio.sucursal_id", expect.anything())
  })
})

describe("ADMIN with the switcher on branch A, lists stay narrowed", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cookieEn(A)
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("garantias list", async () => {
    const garantias = createChainMock([])
    mockSupabaseFrom({ garantias })
    await listGarantias(createGetRequest())
    expect(garantias.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", A)
  })

  it("compromisos", async () => {
    const ordenes = createChainMock([])
    mockSupabaseFrom({ ordenes_servicio: ordenes })
    await getCompromisos(createGetRequest())
    expect(ordenes.eq).toHaveBeenCalledWith("sucursal_id", A)
  })
})
