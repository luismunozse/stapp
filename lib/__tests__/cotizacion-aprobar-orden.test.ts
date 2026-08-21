import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockSupabaseFrom, createChainMock } from "../../__tests__/api/helpers"

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

import { queueNotification } from "@/lib/notifications/queue"
import { aplicarAprobacionCotizacionAOrden } from "../cotizacion-aprobar-orden"

const ordenBase = {
  id: "o1",
  estado: "PRESUPUESTADO",
  organization_id: "org-1",
  cliente_id: "c1",
  numero_orden: 5,
  dispositivo: "iPhone",
  clientes: { id: "c1", nombre: "Juan", email: null, telefono: "123" },
  organizations: { nombre: "Taller", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
}

describe("aplicarAprobacionCotizacionAOrden", () => {
  beforeEach(() => vi.clearAllMocks())

  it("aplica APROBADO de forma atómica, registra evento y notifica desde PRESUPUESTADO", async () => {
    const ordenes = createChainMock([{ id: "o1" }]) // UPDATE atómico → 1 fila afectada
    const eventos = createChainMock(null)
    mockSupabaseFrom({ ordenes_servicio: ordenes, orden_eventos: eventos })

    const res = await aplicarAprobacionCotizacionAOrden({
      orden: ordenBase as any,
      cotizacionId: "cot1",
      cotizacionTotal: 5000,
      descripcionEvento: "Aprobada",
    })

    expect(res).toBe(true)
    expect(ordenes.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: "APROBADO", costo_final: 5000 })
    )
    // Guarda de concurrencia: el UPDATE está condicionado al estado esperado.
    expect(ordenes.eq).toHaveBeenCalledWith("estado", "PRESUPUESTADO")
    expect(eventos.insert).toHaveBeenCalled()
    expect(queueNotification).toHaveBeenCalled()
  })

  it("no hace nada si la orden no está en PRESUPUESTADO (early return, sin tocar DB)", async () => {
    const ordenes = createChainMock([{ id: "o1" }])
    mockSupabaseFrom({ ordenes_servicio: ordenes })

    const res = await aplicarAprobacionCotizacionAOrden({
      orden: { ...ordenBase, estado: "APROBADO" } as any,
      cotizacionId: "cot1",
      cotizacionTotal: 5000,
      descripcionEvento: "x",
    })

    expect(res).toBe(false)
    expect(ordenes.update).not.toHaveBeenCalled()
  })

  it("no registra evento ni notifica si el UPDATE atómico afecta 0 filas (race)", async () => {
    const ordenes = createChainMock([]) // 0 filas → la orden ya no está en PRESUPUESTADO
    const eventos = createChainMock(null)
    mockSupabaseFrom({ ordenes_servicio: ordenes, orden_eventos: eventos })

    const res = await aplicarAprobacionCotizacionAOrden({
      orden: ordenBase as any,
      cotizacionId: "cot1",
      cotizacionTotal: 5000,
      descripcionEvento: "x",
    })

    expect(res).toBe(false)
    expect(eventos.insert).not.toHaveBeenCalled()
    expect(queueNotification).not.toHaveBeenCalled()
  })
})
