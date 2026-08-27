// @vitest-environment node
/**
 * Toggle `tecnicos_operan_pos` (migración 314) en /api/configuracion.
 *
 * Gemelo del de `vendedores_administran_inventario` (275): preferencia de la
 * organización, opt-in, default apagado, y solo el ADMIN lo mueve — GET/PUT de
 * esta ruta van por requireAdmin().
 *
 * Incluye la degradación con la migración sin aplicar: en este proyecto las
 * migraciones se corren A MANO y después del merge, así que siempre hay una
 * ventana con el deploy adelante de su columna. Ahí guardar el resto de la
 * configuración NO puede fallar por este campo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

function orgRow(overrides: Record<string, any> = {}) {
  return {
    id: "org-1",
    nombre_mostrar: "Test Org",
    nombre: "Test Org",
    moneda: "ARS",
    zona_horaria: "America/Argentina/Buenos_Aires",
    pais: "AR",
    modulo_agenda: false,
    vendedores_administran_inventario: false,
    ...overrides,
  }
}

function putRequest(body: Record<string, any>) {
  return new Request("http://localhost:3000/api/configuracion", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("/api/configuracion — permiso de POS para técnicos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("GET devuelve el flag prendido", async () => {
    mockSupabaseFrom({ organizations: createChainMock(orgRow({ tecnicos_operan_pos: true })) })

    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.tecnicosOperanPos).toBe(true)
  })

  it("GET lo devuelve apagado cuando la columna todavía no existe", async () => {
    mockSupabaseFrom({ organizations: createChainMock(orgRow()) })

    const { GET } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.tecnicosOperanPos).toBe(false)
  })

  it("PUT lo persiste", async () => {
    const chain = createChainMock(orgRow({ tecnicos_operan_pos: true }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    const { status, body } = await parseResponse(
      (await PUT(putRequest({ tecnicosOperanPos: true }))) as Response,
    )

    expect(status).toBe(200)
    expect(body.tecnicosOperanPos).toBe(true)
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ tecnicos_operan_pos: true }),
    )
  })

  it("PUT lo apaga cuando llega en false: es un toggle, no un set-once", async () => {
    const chain = createChainMock(orgRow({ tecnicos_operan_pos: false }))
    mockSupabaseFrom({ organizations: chain })

    const { PUT } = await import("@/app/api/configuracion/route")
    await PUT(putRequest({ tecnicosOperanPos: false }))

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ tecnicos_operan_pos: false }),
    )
  })
})
