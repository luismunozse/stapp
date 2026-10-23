import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"

const sendPushToUser = vi.fn()
vi.mock("@/lib/push/send", () => ({
  sendPushToUser: (...a: unknown[]) => sendPushToUser(...a),
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
    sendPushToUser.mockResolvedValue(ok())
  })

  it("reclama con el limite de 500", async () => {
    rpcDevuelve([])
    await enviarPushDeAvisos()
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("claim_avisos_para_push", { p_limit: 500 })
  })

  it("sin filas no manda nada", async () => {
    rpcDevuelve([])
    const r = await enviarPushDeAvisos()
    expect(sendPushToUser).not.toHaveBeenCalled()
    expect(r).toMatchObject({ claimed: 0, usuarios: 0, enviados: 0, fallidos: 0 })
  })

  it("data null se trata como sin filas", async () => {
    rpcDevuelve(null)
    const r = await enviarPushDeAvisos()
    expect(sendPushToUser).not.toHaveBeenCalled()
    expect(r.claimed).toBe(0)
  })

  it("aviso de orden: path de action_url, tag orden-*, data con avisoId y type, sin icon", async () => {
    rpcDevuelve([fila({ id: "a9", orden_id: "o7", action_url: "/ordenes/o7", type: "CAMBIO_ESTADO" })])
    await enviarPushDeAvisos()
    expect(sendPushToUser).toHaveBeenCalledTimes(1)
    const [userId, payload] = sendPushToUser.mock.calls[0]
    expect(userId).toBe("u1")
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
    const payload = sendPushToUser.mock.calls[0][1]
    expect(payload.tag).toBe("aviso-a2")
    expect(payload).not.toHaveProperty("path")
  })

  it("broadcast: una llamada por usuario, cada uno con su avisoId", async () => {
    rpcDevuelve([
      fila({ id: "b1", user_id: "u1", title: "Aviso", body: "Mant", action_url: "/x" }),
      fila({ id: "b2", user_id: "u2", title: "Aviso", body: "Mant", action_url: "/x" }),
      fila({ id: "b3", user_id: "u3", title: "Aviso", body: "Mant", action_url: "/x" }),
    ])
    const r = await enviarPushDeAvisos()
    expect(sendPushToUser).toHaveBeenCalledTimes(3)
    expect(sendPushToUser.mock.calls.map((c) => [c[0], c[1].data.avisoId])).toEqual([
      ["u1", "b1"],
      ["u2", "b2"],
      ["u3", "b3"],
    ])
    expect(r).toMatchObject({ claimed: 3, usuarios: 3, enviados: 3 })
  })

  it("mismo usuario y mismo contenido dos veces: un solo push", async () => {
    rpcDevuelve([
      fila({ id: "d1", user_id: "u1", orden_id: "o1", action_url: "/ordenes/o1" }),
      fila({ id: "d2", user_id: "u1", orden_id: "o1", action_url: "/ordenes/o1" }),
    ])
    const r = await enviarPushDeAvisos()
    expect(sendPushToUser).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ claimed: 2, usuarios: 1 })
  })

  it("mismo usuario con contenidos distintos: un push por contenido", async () => {
    rpcDevuelve([fila({ id: "c1", title: "A" }), fila({ id: "c2", title: "B" })])
    await enviarPushDeAvisos()
    expect(sendPushToUser).toHaveBeenCalledTimes(2)
  })

  it("la concurrencia total esta acotada a 10 entre TODOS los envios", async () => {
    let enVuelo = 0
    let maximo = 0
    sendPushToUser.mockImplementation(async () => {
      enVuelo++
      maximo = Math.max(maximo, enVuelo)
      await new Promise((r) => setTimeout(r, 5))
      enVuelo--
      return ok()
    })
    rpcDevuelve(Array.from({ length: 50 }, (_, i) => fila({ id: `x${i}`, user_id: `u${i}`, title: `T${i}` })))
    const r = await enviarPushDeAvisos()
    expect(sendPushToUser).toHaveBeenCalledTimes(50)
    expect(maximo).toBeLessThanOrEqual(10)
    expect(maximo).toBeGreaterThan(1)
    expect(r.enviados).toBe(50)
  })

  it("suma enviados y fallidos de todos los envios", async () => {
    rpcDevuelve([fila({ id: "e1", title: "A" }), fila({ id: "e2", user_id: "u2", title: "B" })])
    sendPushToUser.mockResolvedValueOnce(ok(2, 1)).mockResolvedValueOnce(ok(1, 0))
    const r = await enviarPushDeAvisos()
    expect(r).toMatchObject({ claimed: 2, usuarios: 2, enviados: 3, fallidos: 1 })
  })

  it("error del RPC: no manda y devuelve el error en el resumen", async () => {
    rpcDevuelve(null, { message: "boom" })
    const r = await enviarPushDeAvisos()
    expect(sendPushToUser).not.toHaveBeenCalled()
    expect(r).toMatchObject({ claimed: 0, enviados: 0, fallidos: 0, error: "boom" })
  })

  it("un envio que revienta no tumba a los demas", async () => {
    rpcDevuelve([fila({ id: "f1", title: "A" }), fila({ id: "f2", user_id: "u2", title: "B" })])
    sendPushToUser.mockRejectedValueOnce(new Error("fcm caido")).mockResolvedValueOnce(ok())
    const r = await enviarPushDeAvisos()
    expect(sendPushToUser).toHaveBeenCalledTimes(2)
    expect(r.enviados).toBe(1)
    expect(r.fallidos).toBe(1)
  })

  it("transporte sin configurar en todos los envios: sinConfiguracion y console.error", async () => {
    sendPushToUser.mockResolvedValue({
      sent: 0,
      failed: 0,
      skipped: 1,
      byTransport: { web: 0, fcm: 0 },
      errors: ["web-push no configurado (VAPID_* env vars o paquete faltante)"],
    })
    rpcDevuelve([fila({ id: "g1" }), fila({ id: "g2", user_id: "u2", title: "B" })])
    const r = await enviarPushDeAvisos()
    expect(r.sinConfiguracion).toBe(true)
    expect(console.error).toHaveBeenCalled()
  })

  it("sin configurar solo en algunos envios no levanta la bandera", async () => {
    sendPushToUser
      .mockResolvedValueOnce({ ...ok(0), skipped: 1, errors: ["fcm no configurado (FCM_SERVICE_ACCOUNT env o paquete faltante)"] })
      .mockResolvedValueOnce(ok())
    rpcDevuelve([fila({ id: "h1" }), fila({ id: "h2", user_id: "u2", title: "B" })])
    const r = await enviarPushDeAvisos()
    expect(r.sinConfiguracion).toBeUndefined()
  })
})
