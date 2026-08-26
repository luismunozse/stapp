import { describe, it, expect, beforeEach, vi } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"
import { mockSupabaseFrom, createChainMock, createGetRequest, parseResponse } from "./helpers"

import { GET as GET_ITEMS } from "@/app/api/public/catalogo/[slug]/items/route"

const CONFIG = createChainMock({ organization_id: "org-1", activo: true })

describe("GET /api/public/catalogo/[slug]/items — disponibilidad neta de reservas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reports stock minus stock_reservado for inventory-linked items", async () => {
    mockSupabaseFrom({
      catalogo_config: CONFIG,
      catalogo_items: createChainMock([
        {
          id: "i1",
          nombre: "Pantalla",
          stock: null,
          inventario_id: "inv-1",
          inventario: { stock: 10, stock_reservado: 4 },
        },
      ]),
    })

    const res = await GET_ITEMS(createGetRequest("http://localhost/api/public/catalogo/x/items"), {
      params: Promise.resolve({ slug: "mi-taller" }),
    })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.items[0].stock_disponible).toBe(6)
  })

  it("keeps catalogo_items.stock for items without an inventory link", async () => {
    mockSupabaseFrom({
      catalogo_config: CONFIG,
      catalogo_items: createChainMock([
        { id: "i2", nombre: "Servicio", stock: 5, inventario_id: null, inventario: null },
      ]),
    })

    const res = await GET_ITEMS(createGetRequest("http://localhost/api/public/catalogo/x/items"), {
      params: Promise.resolve({ slug: "mi-taller" }),
    })
    const { body } = await parseResponse(res)

    expect(body.items[0].stock_disponible).toBe(5)
  })

  it("does not leak the joined inventario row to the public payload", async () => {
    mockSupabaseFrom({
      catalogo_config: CONFIG,
      catalogo_items: createChainMock([
        {
          id: "i1",
          nombre: "Pantalla",
          stock: null,
          inventario_id: "inv-1",
          inventario: { stock: 10, stock_reservado: 4 },
        },
      ]),
    })

    const res = await GET_ITEMS(createGetRequest("http://localhost/api/public/catalogo/x/items"), {
      params: Promise.resolve({ slug: "mi-taller" }),
    })
    const { body } = await parseResponse(res)

    expect(body.items[0].inventario).toBeUndefined()
  })
})

// Guard de consulta: el helper resta `stock_reservado`, pero si el SELECT no
// lo trae, PostgREST devuelve la fila sin esa clave y el helper la lee como 0
// — vuelve silenciosamente al bug de mostrar stock crudo. Los mocks de arriba
// no pueden detectarlo porque no ejecutan SQL. Por eso se fija sobre el fuente.
const PUBLIC_READS = [
  ["app", "api", "public", "catalogo", "[slug]", "items", "route.ts"],
  ["app", "api", "public", "catalogo", "[slug]", "items", "[id]", "bundle", "route.ts"],
  ["app", "api", "public", "catalogo", "[slug]", "cotizar", "route.ts"],
  ["app", "catalogo", "[slug]", "[itemId]", "page.tsx"],
]

describe("catálogo público: todo embed de inventario pide stock_reservado", () => {
  for (const parts of PUBLIC_READS) {
    const rel = parts.join("/")
    it(`${rel} selects stock_reservado on every inventario embed`, () => {
      const src = readFileSync(join(process.cwd(), ...parts), "utf8")
      const embeds = src.match(/inventario:inventario\([^)]*\)/g) ?? []

      expect(embeds.length).toBeGreaterThan(0)
      for (const embed of embeds) {
        expect(embed).toContain("stock_reservado")
      }
    })
  }
})
