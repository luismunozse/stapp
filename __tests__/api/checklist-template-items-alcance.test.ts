// @vitest-environment node
/**
 * Items are only touched through a template the caller's organization owns: every write
 * filters by that template, so an item id of another template (or organization) matches nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { PUT } from "@/app/api/checklist-templates/[id]/items/route"

const ctx = { params: Promise.resolve({ id: "tpl-1" }) }

function put(body: unknown) {
  return new Request("http://localhost:3000/api/checklist-templates/tpl-1/items", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => vi.clearAllMocks())

describe("PUT /api/checklist-templates/[id]/items", () => {
  it("reorder filters every update by the validated template", async () => {
    const items = createChainMock([])
    mockSupabaseFrom({ checklist_templates: createChainMock({ id: "tpl-1" }), checklist_template_items: items })
    mockAuthSuccess({ role: "ADMIN" })
    const res = await PUT(put({ items: [{ id: "item-ajeno", orden: 0 }] }), ctx)
    expect(res.status).toBe(200)
    expect(items.update).toHaveBeenCalledWith({ orden: 0 })
    expect(items.eq).toHaveBeenCalledWith("id", "item-ajeno")
    // Once for the update of the item, once for the list returned afterwards.
    const porPlantilla = items.eq.mock.calls.filter((c: unknown[]) => c[0] === "template_id" && c[1] === "tpl-1")
    expect(porPlantilla).toHaveLength(2)
  })

  it("updating an item of another template answers 404", async () => {
    const items = createChainMock(null)
    mockSupabaseFrom({ checklist_templates: createChainMock({ id: "tpl-1" }), checklist_template_items: items })
    mockAuthSuccess({ role: "ADMIN" })
    const { status, body } = await parseResponse(await PUT(put({ itemId: "item-ajeno", texto: "x" }), ctx))
    expect(status).toBe(404)
    expect(body.error).toBe("Item no encontrado")
    expect(items.eq).toHaveBeenCalledWith("template_id", "tpl-1")
  })

  it("updating an item of this template returns it", async () => {
    const items = createChainMock({ id: "item-1", texto: "Pantalla" })
    mockSupabaseFrom({ checklist_templates: createChainMock({ id: "tpl-1" }), checklist_template_items: items })
    mockAuthSuccess({ role: "ADMIN" })
    const { status, body } = await parseResponse(await PUT(put({ itemId: "item-1", texto: "Pantalla" }), ctx))
    expect(status).toBe(200)
    expect(body.id).toBe("item-1")
  })
})
