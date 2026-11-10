import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/public-token", () => ({
  getOrderByPublicToken: vi.fn(async () => ({ orden: { id: "ord-1", organization_id: "org-1" }, error: null })),
}))

import { GET as getMovimientos, POST as postMovimiento } from "@/app/api/caja/movimientos/route"
import { GET as getFotosPublicas } from "@/app/api/public/ordenes/[token]/photos/route"
import { GET as getTicket } from "@/app/api/soporte/[id]/route"

const STORAGE = "https://abc.supabase.co/storage/v1/object"

const createSignedUrls = vi.fn(async (paths: string[]) => ({
  data: paths.map((p) => ({ path: p, signedUrl: `${STORAGE}/sign/b/${p}?token=t`, error: null })),
  error: null,
}))
const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `${STORAGE}/public/comprobantes-gastos/${path}` } }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabaseAdmin.storage.from).mockImplementation(
    () => ({ createSignedUrls, getPublicUrl }) as any
  )
})

const movimientoBase = {
  tipo: "EGRESO" as const,
  monto: 100,
  metodoPago: "EFECTIVO",
  concepto: "Compra de insumos",
}

function mockInsertMovimiento() {
  const insert = vi.fn().mockReturnValue(createChainMock({ id: "mov-1" }, null))
  mockSupabaseFrom({
    sucursales: createChainMock({ id: "suc-p" }, null),
    sesiones_caja: createChainMock(null, null),
    movimientos_caja: { ...createChainMock({ id: "mov-1" }, null), insert } as any,
  })
  return insert
}

describe("POST /api/caja/movimientos: comprobante", () => {
  it("guarda la referencia canónica cuando el comprobante es de la organización", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })
    const insert = mockInsertMovimiento()

    const res = await postMovimiento(
      createPostRequest({
        ...movimientoBase,
        comprobanteUrl: `${STORAGE}/sign/comprobantes-gastos/org-1/123-abc.pdf?token=xyz`,
      })
    )

    expect((await parseResponse(res)).status).toBe(201)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        comprobante_url: `${STORAGE}/public/comprobantes-gastos/org-1/123-abc.pdf`,
      })
    )
  })

  it.each([
    ["de otra organización", `${STORAGE}/public/comprobantes-gastos/org-2/x.pdf`],
    ["de otro bucket", `${STORAGE}/public/fotos-ordenes/org-1/x.jpg`],
    ["de otro sitio", "https://example.com/org-1/x.pdf"],
  ])("rechaza un comprobante %s", async (_caso, comprobanteUrl) => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })
    const insert = mockInsertMovimiento()

    const res = await postMovimiento(createPostRequest({ ...movimientoBase, comprobanteUrl }))

    expect((await parseResponse(res)).status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })
})

describe("GET /api/caja/movimientos: comprobante", () => {
  it("entrega una URL firmada y descarta las referencias de otra organización", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })
    mockSupabaseFrom({
      organizations: createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }, null),
      movimientos_caja: createChainMock(
        [
          { id: "m1", tipo: "EGRESO", monto: "10", comprobante_url: `${STORAGE}/public/comprobantes-gastos/org-1/a.pdf` },
          { id: "m2", tipo: "EGRESO", monto: "10", comprobante_url: `${STORAGE}/public/comprobantes-gastos/org-2/b.pdf` },
          { id: "m3", tipo: "EGRESO", monto: "10", comprobante_url: null },
        ],
        null
      ),
    })

    const res = await getMovimientos(createGetRequest("http://localhost:3000/api/caja/movimientos?fecha=2026-11-10"))
    const { status, body: data } = await parseResponse(res)

    expect(status).toBe(200)
    expect(supabaseAdmin.storage.from).toHaveBeenCalledWith("comprobantes-gastos")
    expect(data.movimientos.map((m: { comprobanteUrl: string | null }) => m.comprobanteUrl)).toEqual([
      `${STORAGE}/sign/b/org-1/a.pdf?token=t`,
      null,
      null,
    ])
  })
})

describe("GET /api/public/ordenes/[token]/photos", () => {
  it("entrega URLs firmadas y no expone el path interno", async () => {
    mockSupabaseFrom({
      fotos_orden: createChainMock(
        [
          {
            id: "f1",
            url: `${STORAGE}/public/fotos-ordenes/org-1/ord-1/a.jpg`,
            storage_path: "org-1/ord-1/a.jpg",
            tipo: "INGRESO",
            descripcion: null,
            created_at: "2026-11-10T10:00:00Z",
          },
        ],
        null
      ),
    })

    const res = await getFotosPublicas(createGetRequest(), { params: Promise.resolve({ token: "tok" }) })
    const { status, body: data } = await parseResponse(res)

    expect(status).toBe(200)
    expect(supabaseAdmin.storage.from).toHaveBeenCalledWith("fotos-ordenes")
    expect(data.INGRESO).toEqual([
      {
        id: "f1",
        url: `${STORAGE}/sign/b/org-1/ord-1/a.jpg?token=t`,
        tipo: "INGRESO",
        descripcion: null,
        created_at: "2026-11-10T10:00:00Z",
      },
    ])
  })
})

describe("GET /api/soporte/[id]", () => {
  it("entrega los adjuntos con URL firmada", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-1" })
    mockSupabaseFrom({
      support_tickets: createChainMock(
        {
          id: "t1",
          tipo: "CONSULTA",
          estado: "ABIERTO",
          support_ticket_messages: [{ id: "msg-1", created_at: "2026-11-10T10:00:00Z" }],
          support_ticket_attachments: [
            {
              id: "a1",
              message_id: "msg-1",
              url: `${STORAGE}/public/soporte-attachments/t1/msg-1/x.png`,
              storage_path: "t1/msg-1/x.png",
              created_at: "2026-11-10T10:00:00Z",
            },
          ],
        },
        null
      ),
    })

    const res = await getTicket(createGetRequest(), { params: Promise.resolve({ id: "t1" }) })
    const { status, body: data } = await parseResponse(res)

    expect(status).toBe(200)
    expect(supabaseAdmin.storage.from).toHaveBeenCalledWith("soporte-attachments")
    expect(data.mensajes[0].adjuntos[0].url).toBe(`${STORAGE}/sign/b/t1/msg-1/x.png?token=t`)
  })
})
