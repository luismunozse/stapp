// El cliente aprueba y firma desde el link publico. Esta ruta hacia el UPDATE a
// ACEPTADA a mano y despues un `reservar_items_cotizacion` suelto con el error
// tragado, saltandose `aprobar_cotizacion_atomica` — el RPC que la migracion 246
// creo justamente para que una cotizacion no pueda quedar ACEPTADA sin su stock
// reservado, y donde la migracion 312 metio la reconciliacion de reservas de una
// revision (liberar las de la version reemplazada antes de tomar las nuevas).
//
// Por afuera del RPC esa reconciliacion nunca corre: cada pieza presente en las
// dos versiones queda contada dos veces en `stock_reservado`, para siempre. Y
// este es el camino por el que el cliente firma la revision, asi que es el
// camino donde mas importa.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/public/cotizaciones/[token]/aprobar/route"

const TOKEN = "c".repeat(32)

const firma = {
  firmaAprobacion: "data:image/png;base64,abc",
  firmaMime: "image/png",
}

const cotizacionEnviada = {
  id: "cot-1",
  estado: "ENVIADA",
  orden_id: null,
  total: 10000,
  tipo: "ORDEN",
  organization_id: "org-1",
  revision_de: null,
}

function createParams(token: string) {
  return { params: Promise.resolve({ token }) } as any
}

describe("POST /api/public/cotizaciones/[token]/aprobar — aprobacion atomica", () => {
  beforeEach(() => vi.clearAllMocks())

  it("aprueba por aprobar_cotizacion_atomica, no con un UPDATE suelto", async () => {
    const cotizaciones = createChainMock(cotizacionEnviada)
    mockSupabaseFrom({ cotizaciones })

    let capturado: any = null
    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string, params?: any) => {
      if (fn === "aprobar_cotizacion_atomica") capturado = params
      return Promise.resolve({ data: { ok: true }, error: null }) as any
    })

    const { status } = await parseResponse(await POST(createPostRequest(firma), createParams(TOKEN)))

    expect(status).toBe(200)
    expect(capturado).not.toBeNull()
    expect(capturado.p_cotizacion_id).toBe("cot-1")
    expect(capturado.p_org_id).toBe("org-1")
    expect(capturado.p_firma).toBe(firma.firmaAprobacion)
    expect(capturado.p_firma_mime).toBe(firma.firmaMime)

    // El estado y la firma los escribe el RPC dentro de la transaccion. Un
    // UPDATE por afuera es exactamente lo que dejaba la fila ACEPTADA aunque la
    // reserva fallara.
    expect(cotizaciones.update).not.toHaveBeenCalled()
  })

  it("una revision se aprueba por el mismo RPC, que es donde vive la reconciliacion", async () => {
    const revision = { ...cotizacionEnviada, id: "rev-1", revision_de: "cot-1" }
    mockSupabaseFrom({ cotizaciones: createChainMock(revision) })

    const llamados: string[] = []
    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string) => {
      llamados.push(fn)
      return Promise.resolve({ data: { ok: true }, error: null }) as any
    })

    const { status } = await parseResponse(await POST(createPostRequest(firma), createParams(TOKEN)))

    expect(status).toBe(200)
    expect(llamados).toContain("aprobar_cotizacion_atomica")
    // Reservar por afuera del RPC, ademas del RPC, seria reservar dos veces.
    expect(llamados).not.toContain("reservar_items_cotizacion")
  })

  it("sin stock no aprueba: la cotizacion no queda ACEPTADA sin reserva", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cotizacionEnviada) })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0001", message: 'Stock insuficiente para "Pantalla". Disponible: 0, Solicitado: 1' },
    } as any)

    const { status, body } = await parseResponse(
      await POST(createPostRequest(firma), createParams(TOKEN))
    )

    expect(status).toBe(409)
    expect(body.error).toMatch(/stock/i)
  })

  it("mapea el guard de estado del RPC a 400 (doble aprobacion concurrente)", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cotizacionEnviada) })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Solo se pueden aprobar cotizaciones enviadas" },
    } as any)

    const { status } = await parseResponse(await POST(createPostRequest(firma), createParams(TOKEN)))
    expect(status).toBe(400)
  })

  it("sigue exigiendo firma para tipo ORDEN antes de tocar la base", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(cotizacionEnviada) })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ok: true }, error: null } as any)

    const { status } = await parseResponse(await POST(createPostRequest({}), createParams(TOKEN)))

    expect(status).toBe(400)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})

describe("POST /api/public/cotizaciones/[token]/aprobar — base sin la migracion 246", () => {
  beforeEach(() => vi.clearAllMocks())

  const funcionAusente = {
    data: null,
    error: { code: "PGRST202", message: "Could not find the function" },
  }

  it("una cotizacion comun sigue aprobandose por el camino JS de compatibilidad", async () => {
    const cotizaciones = createChainMock(cotizacionEnviada)
    mockSupabaseFrom({ cotizaciones })

    const llamados: string[] = []
    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string) => {
      llamados.push(fn)
      if (fn === "aprobar_cotizacion_atomica") return Promise.resolve(funcionAusente) as any
      return Promise.resolve({ data: { success: true }, error: null }) as any
    })

    const { status } = await parseResponse(await POST(createPostRequest(firma), createParams(TOKEN)))

    expect(status).toBe(200)
    expect(cotizaciones.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "ACEPTADA" })
    )
    // Candado optimista: solo cambia si sigue ENVIADA.
    expect(cotizaciones.eq.mock.calls).toContainEqual(["estado", "ENVIADA"])
    expect(llamados).toContain("reservar_items_cotizacion")
  })

  it("una revision NO se aprueba por ese camino: reservaria dos veces en silencio", async () => {
    // Sin el RPC no hay reconciliacion (migracion 312). Reservar los items de la
    // revision sin liberar los de la original infla `stock_reservado` para
    // siempre. Negarse es ruidoso y reversible; reservar de mas no lo es.
    const revision = { ...cotizacionEnviada, id: "rev-1", revision_de: "cot-1" }
    const cotizaciones = createChainMock(revision)
    mockSupabaseFrom({ cotizaciones })

    const llamados: string[] = []
    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string) => {
      llamados.push(fn)
      if (fn === "aprobar_cotizacion_atomica") return Promise.resolve(funcionAusente) as any
      return Promise.resolve({ data: { success: true }, error: null }) as any
    })

    const { status } = await parseResponse(await POST(createPostRequest(firma), createParams(TOKEN)))

    expect(status).toBe(503)
    expect(cotizaciones.update).not.toHaveBeenCalled()
    expect(llamados).not.toContain("reservar_items_cotizacion")
  })
})
