// __tests__/api/checklist-templates-usage-count.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { GET } from "@/app/api/checklist-templates/route"

function req(url = "http://localhost:3000/api/checklist-templates") {
  return new Request(url, { method: "GET" })
}

describe("GET /api/checklist-templates — conteo de usos", () => {
  beforeEach(() => vi.clearAllMocks())

  it("expone _count.checklists desde el embed checklist_recepcion(count)", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      checklist_templates: createChainMock([
        {
          id: "t1",
          nombre: "Usado",
          activo: true,
          tipo_dispositivo_id: null,
          checklist_template_items: [],
          tipos_dispositivo: null,
          checklist_recepcion: [{ count: 3 }],
        },
        {
          id: "t2",
          nombre: "Sin uso",
          activo: true,
          tipo_dispositivo_id: null,
          checklist_template_items: [],
          tipos_dispositivo: null,
          checklist_recepcion: [],
        },
      ]),
    })

    const res = await GET(req())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0]._count.checklists).toBe(3)
    expect(body[1]._count.checklists).toBe(0)
    // El array crudo del embed no debe filtrarse al frontend
    expect(body[0].checklist_recepcion).toBeUndefined()
  })
})
