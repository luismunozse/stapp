import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, parseResponse } from "./helpers"

import { GET } from "@/app/api/inventario/grupos/[id]/route"

// GET /api/inventario/grupos/[id] adds the display-only `imagenRespaldo` to every ACTIVE
// child without an own photo. It is computed IN MEMORY from the children the route already
// loads (0 extra queries), with the same definition of "first" as the list (PI-2): option
// order, not the order the rows come back. `imagenUrl` keeps meaning "own photo".

type Fila = Record<string, any>

const OPCIONES = [{ nombre: "Color", valores: ["Rojo", "Azul", "Verde", "Negro"] }]
const hijo = (id: string, valor: string, extra: Fila = {}): Fila => ({
  id,
  organization_id: "org-1",
  grupo_id: "g-1",
  atributos: [{ opcion: "Color", valor }],
  nombre: `Funda - ${valor}`,
  codigo: `FX-${valor}`,
  stock: 1,
  stock_reservado: 0,
  precio_compra: 1,
  precio_venta: 2,
  imagen_url: null,
  created_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  ...extra,
})

function fake(hijos: Fila[]) {
  const tablas: string[] = []
  vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: string) => {
    tablas.push(tabla)
    const api: any = {
      select: () => api,
      eq: () => api,
      order: () => api,
      maybeSingle: () => Promise.resolve({ data: { id: "g-1", nombre: "Funda", opciones: OPCIONES }, error: null }),
      then: (resolve: any, reject?: any) => Promise.resolve({ data: hijos, error: null }).then(resolve, reject),
    }
    return api
  }) as any)
  return { tablas }
}

const pedir = async () =>
  parseResponse(await GET(new Request("http://localhost/api/inventario/grupos/g-1"), { params: Promise.resolve({ id: "g-1" }) }))

describe("GET /api/inventario/grupos/[id]: imagenRespaldo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("lends the first photo by OPTION order to each child without its own, in memory", async () => {
    // Served Negro, Verde, Azul, Rojo (reverse option order). Only Verde and Rojo have photos.
    const { tablas } = fake([
      hijo("negro", "Negro"),
      hijo("a-verde", "Verde", { imagen_url: "https://f/verde.jpg" }),
      hijo("azul", "Azul"),
      hijo("rojo", "Rojo", { imagen_url: "https://f/rojo.jpg" }),
    ])

    const { status, body } = await pedir()

    expect(status).toBe(200)
    const por = Object.fromEntries(body.variantes.map((v: Fila) => [v.id, v]))
    expect(por.azul.imagenUrl).toBeNull()
    expect(por.azul.imagenRespaldo).toEqual({ url: "https://f/rojo.jpg", etiqueta: "Rojo" })
    expect(por.negro.imagenRespaldo).toEqual({ url: "https://f/rojo.jpg", etiqueta: "Rojo" })
    // The ids sort against the option order (a-verde < rojo): only the options put Rojo first.
    // The owners keep their own photo and get no fallback; Rojo does not borrow from Verde.
    expect(por.rojo.imagenUrl).toBe("https://f/rojo.jpg")
    expect(por.rojo).not.toHaveProperty("imagenRespaldo")
    expect(por["a-verde"]).not.toHaveProperty("imagenRespaldo")
    // The group and its children: nothing else was asked for.
    expect(tablas).toEqual(["inventario_grupos", "inventario"])
  })

  it("never borrows from an archived sibling and gives archived rows no fallback", async () => {
    fake([
      hijo("rojo", "Rojo", { imagen_url: "https://f/rojo.jpg", deleted_at: "2026-02-01T00:00:00Z" }),
      hijo("azul", "Azul"),
      hijo("verde", "Verde", { imagen_url: "https://f/verde.jpg" }),
    ])

    const { body } = await pedir()

    const azul = body.variantes.find((v: Fila) => v.id === "azul")
    expect(azul.imagenRespaldo).toEqual({ url: "https://f/verde.jpg", etiqueta: "Verde" })
    expect(body.archivadas).toHaveLength(1)
    expect(body.archivadas[0]).not.toHaveProperty("imagenRespaldo")
  })

  it("adds no key when no active sibling has a photo", async () => {
    fake([hijo("rojo", "Rojo"), hijo("azul", "Azul")])
    const { body } = await pedir()
    expect(body.variantes).toHaveLength(2)
    for (const v of body.variantes) expect(v).not.toHaveProperty("imagenRespaldo")
  })
})
