// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/public-token", () => ({ getOrderByPublicToken: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }))

import { supabaseAdmin } from "@/lib/supabase"
import { getOrderByPublicToken } from "@/lib/public-token"
import { rateLimit } from "@/lib/rate-limit"
import { POST } from "@/app/api/public/ordenes/[token]/informar-pago/route"

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3])

const ordenBase = {
  id: "o1",
  organization_id: "org-1",
  estado: "REPARADO",
  numero_orden: 7,
  codigo_orden: "IPH007",
  dispositivo: "11 Pro",
  cliente_id: "c1",
  costo_final: 187000,
  descuento_cobro: 0,
  total_cobrado: 0,
  notas_credito: [],
  clientes: { nombre: "Elias" },
  organizations: { moneda: "ARS", cbu_alias: "taller.mp" },
}

function request(campos: Record<string, string>, archivo?: Uint8Array) {
  const form = new FormData()
  for (const [k, v] of Object.entries(campos)) form.set(k, v)
  // Copia sobre un ArrayBuffer propio: BlobPart no acepta un Uint8Array que podría ser SharedArrayBuffer.
  if (archivo) form.set("comprobante", new File([new Uint8Array(archivo).buffer as ArrayBuffer], "comprobante.png", { type: "image/png" }))
  return new Request("http://localhost/api/public/ordenes/tok/informar-pago", { method: "POST", body: form })
}
const params = { params: Promise.resolve({ token: "tok" }) }

/** pagos_informados se lee (¿hay pendiente?) y después se inserta: un chain por llamada. */
function setup(opts: { pendiente?: any; insert?: { data: any; error: any }; orden?: any } = {}) {
  vi.mocked(getOrderByPublicToken).mockResolvedValue({ orden: { ...ordenBase, ...opts.orden }, error: null } as any)
  const consulta = createChainMock(opts.pendiente ?? null)
  const insercion = createChainMock(opts.insert?.data ?? { id: "p1", created_at: "2026-11-19T12:00:00Z" }, opts.insert?.error ?? null)
  const eventos = createChainMock(null)
  const users = createChainMock([{ id: "admin-1" }])
  const notifs = createChainMock(null)
  let llamadasPagos = 0
  vi.mocked(supabaseAdmin.from).mockImplementation((tabla: string) => {
    if (tabla === "pagos_informados") return (llamadasPagos++ === 0 ? consulta : insercion) as any
    if (tabla === "orden_eventos") return eventos as any
    if (tabla === "users") return users as any
    if (tabla === "user_notifications") return notifs as any
    return createChainMock(null, { message: `sin mock: ${tabla}` }) as any
  })
  const upload = vi.fn().mockResolvedValue({ data: {}, error: null })
  const remove = vi.fn().mockResolvedValue({ data: null, error: null })
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue({ upload, remove } as any)
  return { consulta, insercion, eventos, notifs, upload, remove }
}

describe("POST /api/public/ordenes/[token]/informar-pago", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(rateLimit).mockResolvedValue({ success: true, limit: 5, remaining: 4, reset: Date.now() + 1000 } as any)
  })

  it("transferencia con comprobante: lo sube al bucket privado, guarda el aviso y avisa a los ADMIN", async () => {
    const { insercion, upload, notifs, eventos } = setup()
    const res = await POST(request({ metodo: "TRANSFERENCIA", monto: "100000" }, PNG), params)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.avisoPendiente).toMatchObject({ monto: 100000, metodo: "TRANSFERENCIA" })
    expect(supabaseAdmin.storage.from).toHaveBeenCalledWith("comprobantes-gastos")
    const [path] = upload.mock.calls[0]
    expect(path).toMatch(/^org-1\/pagos-informados\/o1\/.+\.png$/)
    expect(insercion.insert).toHaveBeenCalledWith(
      expect.objectContaining({ orden_id: "o1", metodo: "TRANSFERENCIA", monto: 100000, comprobante_path: path }),
    )
    expect(eventos.insert).toHaveBeenCalledWith(expect.objectContaining({ tipo: "PAGO_INFORMADO" }))
    expect(notifs.insert).toHaveBeenCalledWith([
      expect.objectContaining({ user_id: "admin-1", type: "PAGO_INFORMADO", action_url: "/ordenes/o1" }),
    ])
  })

  it("efectivo no pide comprobante", async () => {
    const { insercion, upload } = setup()
    const res = await POST(request({ metodo: "EFECTIVO", monto: "187000" }), params)
    expect((await parseResponse(res)).status).toBe(201)
    expect(upload).not.toHaveBeenCalled()
    expect(insercion.insert).toHaveBeenCalledWith(expect.objectContaining({ metodo: "EFECTIVO", comprobante_path: null }))
  })

  it("transferencia sin comprobante: 400 y no guarda nada", async () => {
    const { insercion } = setup()
    const res = await POST(request({ metodo: "TRANSFERENCIA", monto: "1000" }), params)
    expect((await parseResponse(res)).status).toBe(400)
    expect(insercion.insert).not.toHaveBeenCalled()
  })

  it("rechaza un archivo que no es imagen ni PDF aunque diga image/png", async () => {
    const { upload } = setup()
    const texto = new TextEncoder().encode("esto no es una imagen, es texto")
    const res = await POST(request({ metodo: "TRANSFERENCIA", monto: "1000" }, texto), params)
    expect((await parseResponse(res)).status).toBe(400)
    expect(upload).not.toHaveBeenCalled()
  })

  it("no deja informar más que el saldo", async () => {
    const { insercion } = setup({ orden: { total_cobrado: 150000 } })
    const res = await POST(request({ metodo: "EFECTIVO", monto: "40000" }), params)
    expect((await parseResponse(res)).status).toBe(400)
    expect(insercion.insert).not.toHaveBeenCalled()
  })

  it("solo con la orden reparada", async () => {
    setup({ orden: { estado: "EN_REPARACION" } })
    const res = await POST(request({ metodo: "EFECTIVO", monto: "1000" }), params)
    expect((await parseResponse(res)).status).toBe(409)
  })

  it("sin alias configurado no acepta transferencias", async () => {
    setup({ orden: { organizations: { moneda: "ARS", cbu_alias: null } } })
    const res = await POST(request({ metodo: "TRANSFERENCIA", monto: "1000" }, PNG), params)
    expect((await parseResponse(res)).status).toBe(409)
  })

  it("un aviso pendiente por vez", async () => {
    const { upload, insercion } = setup({ pendiente: { id: "p0" } })
    const res = await POST(request({ metodo: "TRANSFERENCIA", monto: "1000" }, PNG), params)
    expect((await parseResponse(res)).status).toBe(409)
    expect(upload).not.toHaveBeenCalled()
    expect(insercion.insert).not.toHaveBeenCalled()
  })

  it("si dos envíos chocan en el índice único, borra el archivo subido y responde 409", async () => {
    const { remove } = setup({ insert: { data: null, error: { code: "23505", message: "duplicate" } } })
    const res = await POST(request({ metodo: "TRANSFERENCIA", monto: "1000" }, PNG), params)
    expect((await parseResponse(res)).status).toBe(409)
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("limita los intentos", async () => {
    vi.mocked(rateLimit).mockResolvedValue({ success: false, limit: 5, remaining: 0, reset: Date.now() + 60_000 } as any)
    setup()
    const res = await POST(request({ metodo: "EFECTIVO", monto: "1000" }), params)
    expect((await parseResponse(res)).status).toBe(429)
  })
})
