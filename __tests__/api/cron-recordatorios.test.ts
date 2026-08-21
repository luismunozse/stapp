import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
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

const mockOrgCostaRica = {
  ...mockOrg,
  id: "org-cr",
  slug: "celulares-cr",
  moneda: "USD",
  zona_horaria: "America/Costa_Rica",
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

// El cron corre cada hora; sólo debe procesar las orgs donde son las 10 LOCALES.
// Buenos Aires es UTC-3 todo el año -> 13:00 UTC = 10:00 local.
// Costa Rica es UTC-6 todo el año  -> 16:00 UTC = 10:00 local.
const UTC_10_AR = "2026-07-29T13:00:00.000Z"
const UTC_10_CR = "2026-07-29T16:00:00.000Z"
const UTC_10_ZULU = "2026-07-29T10:00:00.000Z" // 07:00 en AR, 04:00 en CR

function mockTables(orgs: unknown[], ordenes: unknown[], yaEnviados = 0) {
  const orgChain = createChainMock(orgs)
  const ordenesChain = createChainMock(ordenes)
  const countChain = createChainMock(null, null, yaEnviados)

  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "organizations") return orgChain as any
    if (table === "ordenes_servicio") return ordenesChain as any
    if (table === "notification_logs") return countChain as any
    return createChainMock(null) as any
  })

  return { orgChain, ordenesChain, countChain }
}

describe("GET /api/cron/recordatorios", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Por defecto, las 10 de la mañana en Buenos Aires.
    vi.setSystemTime(new Date(UTC_10_AR))
  })

  afterEach(() => vi.useRealTimers())

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

  describe("hora de envío según la zona horaria de la org", () => {
    it("envía a las 10:00 locales de una org de Argentina", async () => {
      vi.setSystemTime(new Date(UTC_10_AR))
      mockTables([mockOrg], [mockOrden])

      await GET(new Request("http://localhost/api/cron/recordatorios"))

      expect(vi.mocked(queueNotification).mock.calls.length).toBe(1)
    })

    it("NO envía a las 10:00 UTC a una org de Argentina (serían las 07:00 locales)", async () => {
      vi.setSystemTime(new Date(UTC_10_ZULU))
      mockTables([mockOrg], [mockOrden])

      await GET(new Request("http://localhost/api/cron/recordatorios"))

      expect(vi.mocked(queueNotification).mock.calls.length).toBe(0)
    })

    it("envía a las 10:00 locales de una org de Costa Rica", async () => {
      vi.setSystemTime(new Date(UTC_10_CR))
      mockTables([mockOrgCostaRica], [mockOrden])

      await GET(new Request("http://localhost/api/cron/recordatorios"))

      const calls = vi.mocked(queueNotification).mock.calls
      expect(calls.length).toBe(1)
      expect(calls[0][0].organizationId).toBe("org-cr")
    })

    // Este es el bug reportado: el cron corría a las 10:00 UTC para todos,
    // que en UTC-6 (Costa Rica, Guatemala, Nicaragua) son las 04:00 de la madrugada.
    it("NO envía a las 10:00 UTC a una org de Costa Rica (serían las 04:00 de la madrugada)", async () => {
      vi.setSystemTime(new Date(UTC_10_ZULU))
      mockTables([mockOrgCostaRica], [mockOrden])

      await GET(new Request("http://localhost/api/cron/recordatorios"))

      expect(vi.mocked(queueNotification).mock.calls.length).toBe(0)
    })

    it("en una misma corrida procesa sólo las orgs donde son las 10 locales", async () => {
      vi.setSystemTime(new Date(UTC_10_CR))
      mockTables([mockOrg, mockOrgCostaRica], [mockOrden])

      await GET(new Request("http://localhost/api/cron/recordatorios"))

      const calls = vi.mocked(queueNotification).mock.calls
      expect(calls.length).toBe(1)
      expect(calls[0][0].organizationId).toBe("org-cr")
    })

    it("trata la org sin zona_horaria como Argentina", async () => {
      vi.setSystemTime(new Date(UTC_10_AR))
      mockTables([{ ...mockOrg, zona_horaria: null }], [mockOrden])

      await GET(new Request("http://localhost/api/cron/recordatorios"))

      expect(vi.mocked(queueNotification).mock.calls.length).toBe(1)
    })

    it("con ?force=1 ignora el filtro horario (corrida manual del superadmin)", async () => {
      vi.setSystemTime(new Date(UTC_10_ZULU))
      mockTables([mockOrgCostaRica], [mockOrden])

      await GET(new Request("http://localhost/api/cron/recordatorios?force=1"))

      expect(vi.mocked(queueNotification).mock.calls.length).toBe(1)
    })

    // Una zona_horaria corrupta hacía que Intl tirara RangeError y el catch
    // externo devolviera 500, cancelando la corrida para TODAS las orgs.
    it("una org con zona_horaria inválida no frena a las demás", async () => {
      vi.setSystemTime(new Date(UTC_10_CR))
      mockTables([{ ...mockOrg, id: "org-roto", zona_horaria: "Marte/Olympus" }, mockOrgCostaRica], [mockOrden])

      const res = await GET(new Request("http://localhost/api/cron/recordatorios"))

      expect(res.status).toBe(200)
      // La org rota cae al default (Argentina): a las 16:00 UTC son las 13:00
      // allá, así que no le toca. La de Costa Rica sí sale.
      const calls = vi.mocked(queueNotification).mock.calls
      expect(calls.length).toBe(1)
      expect(calls[0][0].organizationId).toBe("org-cr")
    })

    it("deduplica por el día LOCAL de la org, no por medianoche UTC", async () => {
      vi.setSystemTime(new Date(UTC_10_CR))
      const { countChain } = mockTables([mockOrgCostaRica], [mockOrden])

      await GET(new Request("http://localhost/api/cron/recordatorios"))

      // Medianoche del 29/07 en Costa Rica (UTC-6) = 06:00 UTC del 29/07.
      // Con medianoche UTC se perdían los envíos hechos entre 00:00 y 06:00 UTC.
      expect(countChain.gte).toHaveBeenCalledWith("created_at", "2026-07-29T06:00:00.000Z")
    })
  })
})
