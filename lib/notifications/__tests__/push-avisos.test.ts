import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"

const sendPushToUsers = vi.fn()
vi.mock("@/lib/push/send", () => ({
  sendPushToUsers: (...a: unknown[]) => sendPushToUsers(...a),
}))

import { enviarPushDeAvisos } from "../push-avisos"

type Fila = {
  id: string
  user_id: string
  title: string
  body: string
  action_url: string | null
  orden_id: string | null
  type: string
}

const fila = (over: Partial<Fila> = {}): Fila => ({
  id: "a1",
  user_id: "u1",
  title: "Titulo",
  body: "Cuerpo",
  action_url: null,
  orden_id: null,
  type: "SISTEMA",
  ...over,
})

const rpcDevuelve = (data: Fila[] | null, error: { message: string } | null = null) =>
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data, error } as never)

const ok = (sent = 1, failed = 0) => ({
  sent,
  failed,
  skipped: 0,
  byTransport: { web: sent, fcm: 0 },
  errors: [],
})

describe("enviarPushDeAvisos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
    sendPushToUsers.mockResolvedValue(ok())
  })

  it("reclama con el limite de 500", async () => {
    rpcDevuelve([])
    await enviarPushDeAvisos()
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("claim_avisos_para_push", { p_limit: 500 })
  })

  it("sin filas no manda nada", async () => {
    rpcDevuelve([])
    const r = await enviarPushDeAvisos()
    expect(sendPushToUsers).not.toHaveBeenCalled()
    expect(r).toMatchObject({ claimed: 0, usuarios: 0, enviados: 0, fallidos: 0 })
  })

  it("data null se trata como sin filas", async () => {
    rpcDevuelve(null)
    const r = await enviarPushDeAvisos()
    expect(sendPushToUsers).not.toHaveBeenCalled()
    expect(r.claimed).toBe(0)
  })

  it("aviso de orden: path de action_url, tag orden-*, data con avisoId y type, sin icon", async () => {
    rpcDevuelve([fila({ id: "a9", orden_id: "o7", action_url: "/ordenes/o7", type: "CAMBIO_ESTADO" })])
    await enviarPushDeAvisos()
    expect(sendPushToUsers).toHaveBeenCalledTimes(1)
    const [ids, payload] = sendPushToUsers.mock.calls[0]
    expect(ids).toEqual(["u1"])
    expect(payload).toEqual({
      title: "Titulo",
      body: "Cuerpo",
      path: "/ordenes/o7",
      tag: "orden-o7",
      data: { avisoId: "a9", type: "CAMBIO_ESTADO" },
    })
    expect(payload).not.toHaveProperty("icon")
  })

  it("aviso sin orden ni action_url: tag aviso-*, sin path", async () => {
    rpcDevuelve([fila({ id: "a2" })])
    await enviarPushDeAvisos()
    const payload = sendPushToUsers.mock.calls[0][1]
    expect(payload.tag).toBe("aviso-a2")
    expect(payload).not.toHaveProperty("path")
  })

  it("payload identico para muchos usuarios: una sola llamada con todos los ids", async () => {
    // Un broadcast: mismo contenido, una fila (id) por usuario. El agrupado es
    // por contenido visible (title/body/path), no por id de aviso.
    rpcDevuelve([
      fila({ id: "b1", user_id: "u1", title: "Aviso", body: "Mantenimiento", action_url: "/x" }),
      fila({ id: "b2", user_id: "u2", title: "Aviso", body: "Mantenimiento", action_url: "/x" }),
      fila({ id: "b3", user_id: "u3", title: "Aviso", body: "Mantenimiento", action_url: "/x" }),
    ])
    const r = await enviarPushDeAvisos()
    expect(sendPushToUsers).toHaveBeenCalledTimes(1)
    expect(sendPushToUsers.mock.calls[0][0]).toEqual(["u1", "u2", "u3"])
    expect(r.usuarios).toBe(3)
    expect(r.claimed).toBe(3)
  })

  it("contenidos distintos: una llamada por grupo", async () => {
    rpcDevuelve([
      fila({ id: "c1", user_id: "u1", title: "A" }),
      fila({ id: "c2", user_id: "u2", title: "B" }),
    ])
    await enviarPushDeAvisos()
    expect(sendPushToUsers).toHaveBeenCalledTimes(2)
  })

  it("misma orden y mismo contenido para dos usuarios se agrupan", async () => {
    rpcDevuelve([
      fila({ id: "d1", user_id: "u1", orden_id: "o1", action_url: "/ordenes/o1" }),
      fila({ id: "d2", user_id: "u2", orden_id: "o1", action_url: "/ordenes/o1" }),
    ])
    await enviarPushDeAvisos()
    expect(sendPushToUsers).toHaveBeenCalledTimes(1)
    expect(sendPushToUsers.mock.calls[0][0]).toEqual(["u1", "u2"])
  })

  it("pasa un tope de concurrencia a sendPushToUsers", async () => {
    rpcDevuelve([fila()])
    await enviarPushDeAvisos()
    expect(sendPushToUsers.mock.calls[0][2]).toEqual({ concurrency: 10 })
  })

  it("suma enviados y fallidos de todos los grupos", async () => {
    rpcDevuelve([fila({ id: "e1", title: "A" }), fila({ id: "e2", user_id: "u2", title: "B" })])
    sendPushToUsers.mockResolvedValueOnce(ok(2, 1)).mockResolvedValueOnce(ok(1, 0))
    const r = await enviarPushDeAvisos()
    expect(r).toMatchObject({ claimed: 2, usuarios: 2, enviados: 3, fallidos: 1 })
  })

  it("error del RPC: no manda y devuelve el error en el resumen", async () => {
    rpcDevuelve(null, { message: "boom" })
    const r = await enviarPushDeAvisos()
    expect(sendPushToUsers).not.toHaveBeenCalled()
    expect(r).toMatchObject({ claimed: 0, enviados: 0, fallidos: 0, error: "boom" })
  })

  it("un grupo que revienta no tumba a los demas", async () => {
    rpcDevuelve([fila({ id: "f1", title: "A" }), fila({ id: "f2", user_id: "u2", title: "B" })])
    sendPushToUsers.mockRejectedValueOnce(new Error("fcm caido")).mockResolvedValueOnce(ok())
    const r = await enviarPushDeAvisos()
    expect(sendPushToUsers).toHaveBeenCalledTimes(2)
    expect(r.enviados).toBe(1)
    expect(r.fallidos).toBe(1)
  })
})
