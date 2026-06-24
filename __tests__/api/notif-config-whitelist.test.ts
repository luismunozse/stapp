/**
 * Security: /api/notificaciones/config PUT must validate plantillasWhatsapp keys
 * against PLANTILLAS_CATALOG server-side (not trust the front).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { PLANTILLAS_CATALOG } from "@/lib/whatsapp/plantillas-catalog"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { PUT } from "@/app/api/notificaciones/config/route"

beforeEach(() => vi.clearAllMocks())

const VALID_KEY = PLANTILLAS_CATALOG[0].key

describe("PUT /api/notificaciones/config — plantilla key whitelist", () => {
  it("rejects an unknown plantilla key with 400", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    mockSupabaseFrom({ organizations: createChainMock({}) })

    const res = await PUT(
      createPostRequest({ plantillasWhatsapp: { __rogue_key__: "hola" } })
    )
    const { status } = await parseResponse(res)
    expect(status).toBe(400)
  })

  it("accepts a valid catalog key", async () => {
    mockAuthSuccess({ organizationId: "org-1", role: "ADMIN" })
    mockSupabaseFrom({
      organizations: createChainMock({
        notificaciones_email: true,
        plantillas_whatsapp: {},
      }),
    })

    const res = await PUT(
      createPostRequest({ plantillasWhatsapp: { [VALID_KEY]: "texto" } })
    )
    const { status } = await parseResponse(res)
    expect(status).toBe(200)
  })
})
