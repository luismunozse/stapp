import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: vi.fn(() => null),
}))

import { GET } from "@/app/api/cron/recordatorios/route"
import { queueNotification } from "@/lib/notifications/queue"

const mockOrg = {
  id: "org-1",
  nombre: "Taller Test",
  nombre_mostrar: "Taller Test SA",
  slug: "taller-test",
  dias_recordatorio: 3,
  notificaciones_email: false,
  notificaciones_whatsapp: true,
  moneda: "ARS",
  zona_horaria: "America/Argentina/Buenos_Aires",
}

const mockOrden = {
  id: "orden-1",
  numero_orden: 42,
  dispositivo: "iPhone 13",
  public_token: "tok-abc123",
  sucursal_id: "suc-1",
  clientes: {
    id: "cliente-1",
    nombre: "Ana Gomez",
    email: null,
    telefono: "+5491112345678",
  },
}

describe("GET /api/cron/recordatorios", () => {
  beforeEach(() => vi.clearAllMocks())

  it("encola RECORDATORIO_RETIRO via queueNotification para orden elegible", async () => {
    const orgChain = createChainMock([mockOrg])
    const ordenesChain = createChainMock([mockOrden])
    const countChain = createChainMock(null, null, 0)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") return orgChain as any
      if (table === "ordenes_servicio") return ordenesChain as any
      if (table === "notification_logs") return countChain as any
      return createChainMock(null) as any
    })

    const res = await GET(new Request("http://localhost/api/cron/recordatorios"))
    expect(res.status).toBe(200)

    const calls = vi.mocked(queueNotification).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0][0].tipo).toBe("RECORDATORIO_RETIRO")
    expect(calls[0][0].context.orden?.publicToken).toBeTruthy()
    // El recordatorio debe salir del número de la sucursal de la orden, no del central.
    expect(calls[0][0].sucursalId).toBe("suc-1")
  })

  it("no encola si la org no tiene ningun canal habilitado", async () => {
    const orgSinCanales = { ...mockOrg, notificaciones_email: false, notificaciones_whatsapp: false }
    const orgChain = createChainMock([orgSinCanales])

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") return orgChain as any
      return createChainMock(null) as any
    })

    const res = await GET(new Request("http://localhost/api/cron/recordatorios"))
    expect(res.status).toBe(200)
    expect(vi.mocked(queueNotification).mock.calls.length).toBe(0)
  })

  it("no encola si el cliente no tiene email ni telefono", async () => {
    const ordenSinContacto = {
      ...mockOrden,
      clientes: { id: "c2", nombre: "Sin Contacto", email: null, telefono: null },
    }
    const orgChain = createChainMock([mockOrg])
    const ordenesChain = createChainMock([ordenSinContacto])
    const countChain = createChainMock(null, null, 0)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") return orgChain as any
      if (table === "ordenes_servicio") return ordenesChain as any
      if (table === "notification_logs") return countChain as any
      return createChainMock(null) as any
    })

    const res = await GET(new Request("http://localhost/api/cron/recordatorios"))
    expect(res.status).toBe(200)
    expect(vi.mocked(queueNotification).mock.calls.length).toBe(0)
  })

  it("no encola si ya se envio recordatorio hoy", async () => {
    const orgChain = createChainMock([mockOrg])
    const ordenesChain = createChainMock([mockOrden])
    const countChain = createChainMock(null, null, 1)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") return orgChain as any
      if (table === "ordenes_servicio") return ordenesChain as any
      if (table === "notification_logs") return countChain as any
      return createChainMock(null) as any
    })

    const res = await GET(new Request("http://localhost/api/cron/recordatorios"))
    expect(res.status).toBe(200)
    expect(vi.mocked(queueNotification).mock.calls.length).toBe(0)
  })
})
