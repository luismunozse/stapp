/**
 * Access rules for /api/notificaciones/config.
 *
 * GET returns the org's custom WhatsApp templates, which every staff screen that
 * opens a WhatsApp message reads (orders, POS, clients, credit notes, catalog).
 * A TECNICO or VENDEDOR must get them; with a 403 the screens silently fall back
 * to the factory text and the workshop's edited templates never show.
 * PUT changes org settings and stays ADMIN-only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { PLANTILLAS_CATALOG } from "@/lib/whatsapp/plantillas-catalog"
import {
  mockAuthSuccess,
  mockAuthError,
  mockSupabaseFrom,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { GET, PUT } from "@/app/api/notificaciones/config/route"

const KEY = PLANTILLAS_CATALOG[0].key

const ORG_ROW = {
  nombre: "Taller Uno",
  nombre_mostrar: null,
  notificaciones_email: true,
  notificaciones_whatsapp: true,
  dias_recordatorio: 3,
  notif_stock_bajo: true,
  plantillas_whatsapp: { [KEY]: "texto del taller" },
}

beforeEach(() => vi.clearAllMocks())

describe("GET /api/notificaciones/config — any member of the org", () => {
  it.each(["ADMIN", "VENDEDOR", "TECNICO"])("%s gets 200 with the custom templates", async (role) => {
    mockAuthSuccess({ organizationId: "org-7", role })
    const chain = createChainMock(ORG_ROW)
    mockSupabaseFrom({ organizations: chain })

    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(body.plantillasWhatsapp).toEqual({ [KEY]: "texto del taller" })
    expect(body.organizationName).toBe("Taller Uno")
    // The read is scoped to the caller's own org.
    expect(chain.eq).toHaveBeenCalledWith("id", "org-7")
  })

  it("answers 401 without a session", async () => {
    mockAuthError()
    mockSupabaseFrom({ organizations: createChainMock(ORG_ROW) })

    const { status } = await parseResponse(await GET())

    expect(status).toBe(401)
  })
})

describe("PUT /api/notificaciones/config — ADMIN only", () => {
  it.each(["TECNICO", "VENDEDOR"])("%s gets 403 and nothing is written", async (role) => {
    mockAuthSuccess({ organizationId: "org-7", role })
    const chain = createChainMock(ORG_ROW)
    mockSupabaseFrom({ organizations: chain })

    const { status } = await parseResponse(
      await PUT(createPostRequest({ plantillasWhatsapp: { [KEY]: "pisado" } }))
    )

    expect(status).toBe(403)
    expect(chain.update).not.toHaveBeenCalled()
  })

  it("answers 401 without a session and writes nothing", async () => {
    mockAuthError()
    const chain = createChainMock(ORG_ROW)
    mockSupabaseFrom({ organizations: chain })

    const { status } = await parseResponse(await PUT(createPostRequest({ notifStockBajo: false })))

    expect(status).toBe(401)
    expect(chain.update).not.toHaveBeenCalled()
  })

  it("ADMIN still updates the org", async () => {
    mockAuthSuccess({ organizationId: "org-7", role: "ADMIN" })
    const chain = createChainMock(ORG_ROW)
    mockSupabaseFrom({ organizations: chain })

    const { status } = await parseResponse(await PUT(createPostRequest({ notifStockBajo: false })))

    expect(status).toBe(200)
    expect(chain.update).toHaveBeenCalledWith({ notif_stock_bajo: false })
    expect(chain.eq).toHaveBeenCalledWith("id", "org-7")
  })
})
