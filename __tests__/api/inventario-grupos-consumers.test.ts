import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, parseResponse } from "./helpers"

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }))
vi.mock("@/lib/inventario-eventos", () => ({
  pickAudited: vi.fn(),
  registrarActualizacion: vi.fn(),
  registrarArchivado: vi.fn(),
  registrarCreacion: vi.fn(),
}))

import { PUT } from "@/app/api/inventario/[id]/route"
import { PATCH } from "@/app/api/inventario/[id]/kit/route"

// A grouped product can never be a kit (CHECK inventario_grupo_no_kit, migration 355). The two
// writers of es_kit answer 400 with a clear message instead of a 500.

const MENSAJE = "Un producto con variantes no puede ser kit"
const CHECK_KIT = { code: "23514", message: 'new row for relation "inventario" violates check constraint "inventario_grupo_no_kit"' }
const ctx = { params: Promise.resolve({ id: "inv-1" }) }

type Fila = Record<string, any>

// A chain that answers `.single()` / `.maybeSingle()` / await with one result, and counts calls.
function cadena(resultado: { data: unknown; error: unknown }) {
  const c: any = {}
  for (const m of ["select", "eq", "is", "update", "insert", "in", "order", "limit"]) c[m] = vi.fn(() => c)
  c.single = vi.fn(() => Promise.resolve(resultado))
  c.maybeSingle = vi.fn(() => Promise.resolve(resultado))
  c.then = (resolve: any, reject?: any) => Promise.resolve(resultado).then(resolve, reject)
  return c
}

function putRequest(body: unknown) {
  return new Request("http://localhost:3000/api/inventario/inv-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
function patchRequest(body: unknown) {
  return new Request("http://localhost:3000/api/inventario/inv-1/kit", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const existente = (extra: Fila = {}): Fila => ({
  id: "inv-1",
  organization_id: "org-1",
  codigo: "FX-AZ",
  nombre: "Funda X - Azul",
  stock: 5,
  es_kit: false,
  tipo_kit: null,
  deleted_at: null,
  ...extra,
})

describe("PUT /api/inventario/[id]: a grouped product cannot become a kit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  function preparar(fila: Fila, resultadoUpdate: { data: unknown; error: unknown }) {
    const lectura = cadena({ data: fila, error: null })
    const escritura = cadena(resultadoUpdate)
    const rpc = vi.mocked(supabaseAdmin.rpc)
    rpc.mockResolvedValue({ data: { stockPosterior: 99 }, error: null } as any)
    let llamadas = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((() => (llamadas++ === 0 ? lectura : escritura)) as any)
    return { lectura, escritura, rpc }
  }

  it("answers 400 before touching the stock or the row when the product is already grouped", async () => {
    const { escritura, rpc } = preparar(existente({ grupo_id: "g-1", atributos: [{ opcion: "Color", valor: "Azul" }] }), {
      data: existente({ es_kit: true }),
      error: null,
    })

    const { status, body } = await parseResponse(await PUT(putRequest({ esKit: true, tipoKit: "ENSAMBLADO", stock: 99 }), ctx))

    expect(status).toBe(400)
    expect(body.error).toBe(MENSAJE)
    // No stock movement and no write: the 400 comes before both.
    expect(rpc).not.toHaveBeenCalled()
    expect(escritura.update).not.toHaveBeenCalled()
  })

  it("lets a standalone product become a kit, and a grouped one be edited without becoming a kit", async () => {
    const suelto = preparar(existente({ grupo_id: null, atributos: null }), { data: existente({ es_kit: true, tipo_kit: "ENSAMBLADO" }), error: null })
    const esKit = await parseResponse(await PUT(putRequest({ esKit: true, tipoKit: "ENSAMBLADO" }), ctx))
    expect(esKit.status).toBe(200)
    expect(suelto.escritura.update).toHaveBeenCalledWith({ es_kit: true, tipo_kit: "ENSAMBLADO" })

    const agrupado = preparar(existente({ grupo_id: "g-1", atributos: [{ opcion: "Color", valor: "Azul" }] }), {
      data: existente({ precio_venta: 10 }),
      error: null,
    })
    const edicion = await parseResponse(await PUT(putRequest({ precioVenta: 10 }), ctx))
    expect(edicion.status).toBe(200)
    expect(agrupado.escritura.update).toHaveBeenCalledWith({ precio_venta: 10 })
  })

  it("answers 400 when the database rejects it anyway (the group was created after the read)", async () => {
    // The snapshot says standalone; by the time of the write the CHECK fires.
    const { escritura } = preparar(existente({ grupo_id: null }), { data: null, error: CHECK_KIT })

    const { status, body } = await parseResponse(await PUT(putRequest({ esKit: true, tipoKit: "VIRTUAL" }), ctx))

    expect(status).toBe(400)
    expect(body.error).toBe(MENSAJE)
    expect(escritura.update).toHaveBeenCalledTimes(1)
  })

  it("keeps answering 500 for any other check violation", async () => {
    preparar(existente({ grupo_id: null }), {
      data: null,
      error: { code: "23514", message: 'new row violates check constraint "chk_inventario_stock_maximo"' },
    })

    const { status, body } = await parseResponse(await PUT(putRequest({ stockMaximo: 1 }), ctx))

    expect(status).toBe(500)
    expect(body.error).toBe("Error al actualizar item")
  })
})

describe("PATCH /api/inventario/[id]/kit: the same CHECK", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  function preparar(resultadoUpdate: { data: unknown; error: unknown }) {
    const lectura = cadena({ data: existente(), error: null })
    const escritura = cadena(resultadoUpdate)
    let llamadas = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((() => (llamadas++ === 0 ? lectura : escritura)) as any)
    return { escritura }
  }

  it("answers 400 with the message when the product is a variant", async () => {
    const { escritura } = preparar({ data: null, error: CHECK_KIT })
    const { status, body } = await parseResponse(await PATCH(patchRequest({ esKit: true, tipoKit: "ENSAMBLADO" }), ctx))
    expect(status).toBe(400)
    expect(body.error).toBe(MENSAJE)
    expect(escritura.update).toHaveBeenCalledTimes(1)
  })

  it("still toggles a standalone product and still answers 500 for other errors", async () => {
    preparar({ data: { id: "inv-1", es_kit: true, tipo_kit: "ENSAMBLADO" }, error: null })
    const ok = await parseResponse(await PATCH(patchRequest({ esKit: true }), ctx))
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ id: "inv-1", esKit: true, tipoKit: "ENSAMBLADO" })

    preparar({ data: null, error: { code: "57014", message: "statement timeout" } })
    const roto = await parseResponse(await PATCH(patchRequest({ esKit: true }), ctx))
    expect(roto.status).toBe(500)
  })
})
