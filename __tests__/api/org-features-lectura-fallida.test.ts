// @vitest-environment node
/**
 * /api/org/features is what the inventory page asks "does this VENDEDOR
 * administer inventory?", and a `false` from it sends the operator back to the
 * dashboard — losing whatever they had typed into the inventory form, which has
 * no draft persistence.
 *
 * So the route must never manufacture that `false`. It used to: the org read
 * ignored its own `error` and an unreadable row fell through to
 * `!!undefined`, i.e. a full-blown denial served with a 200 on a database
 * blip. "I could not answer" and "the answer is no" are different, and only
 * one of them may take an operator off the screen.
 *
 * A non-200 is safe for the other consumer (components/layout/navbar.tsx),
 * which already maps `!r.ok` to "keep what I had".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

describe("GET /api/org/features", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "VENDEDOR" })
  })

  it("devuelve los flags cuando puede leer la organización", async () => {
    mockSupabaseFrom({
      organizations: createChainMock({
        modulo_agenda: true,
        vendedores_administran_inventario: true,
      }),
    })

    const { GET } = await import("@/app/api/org/features/route")
    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(body.vendedoresAdministranInventario).toBe(true)
    expect(body.moduloAgenda).toBe(true)
  })

  it("responde false cuando la organización realmente no habilitó el permiso", async () => {
    mockSupabaseFrom({
      organizations: createChainMock({
        modulo_agenda: false,
        vendedores_administran_inventario: false,
      }),
    })

    const { GET } = await import("@/app/api/org/features/route")
    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(body.vendedoresAdministranInventario).toBe(false)
  })

  it("no convierte un error de lectura en una denegación", async () => {
    mockSupabaseFrom({
      organizations: createChainMock(null, { message: "connection reset by peer" }),
    })

    const { GET } = await import("@/app/api/org/features/route")
    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(503)
    expect(body.vendedoresAdministranInventario).toBeUndefined()
  })

  it("tampoco la inventa cuando la respuesta llega vacía sin explicar por qué", async () => {
    mockSupabaseFrom({ organizations: createChainMock(null, null) })

    const { GET } = await import("@/app/api/org/features/route")
    const { status } = await parseResponse(await GET())

    expect(status).toBe(503)
  })

  /**
   * La otra cara: "no hay fila" SÍ es una respuesta.
   *
   * `.single()` devuelve PGRST116 con data en null cuando no matchea ninguna
   * fila, y meter eso en la misma bolsa que un error de transporte lo convierte
   * en un 503 permanente: el VENDEDOR queda clavado en "indeterminado" —UI de
   * inventario completa más un aviso cuyo reintento no puede tener éxito
   * nunca— y el navbar esconde los módulos opcionales sin forma de recuperarse.
   * Antes eso contestaba 200 con los flags apagados, que es la respuesta
   * correcta y además fail-closed.
   */
  it("contesta que no hay módulos cuando la organización no tiene fila", async () => {
    mockSupabaseFrom({
      organizations: createChainMock(null, {
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
      }),
    })

    const { GET } = await import("@/app/api/org/features/route")
    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(body.vendedoresAdministranInventario).toBe(false)
    expect(body.moduloAgenda).toBe(false)
  })
})
