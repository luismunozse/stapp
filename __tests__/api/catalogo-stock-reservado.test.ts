import { describe, it, expect, beforeEach, vi } from "vitest"
import { readFileSync, readdirSync } from "fs"
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

// ─── Guards de fuente ───
//
// Una lista de archivos escrita a mano ya fallo una vez: la grilla principal
// (lib/catalogo/fetch-data.ts), el opengraph-image y /api/catalogo/diagnose
// quedaron con el calculo viejo porque nadie los agrego a la lista. Los dos
// guards de abajo descubren los archivos solos, asi que cubren tambien
// cualquier lectura nueva que se agregue despues.

const HELPER = join("lib", "catalogo", "stock-disponible.ts")

function archivosFuente(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      archivosFuente(rel, acc)
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(rel)
    }
  }
  return acc
}

// `components/` estaba fuera del barrido y ahí se escondía un call site sin
// migrar (la grilla del admin). Un guard que no recorre todo el árbol da una
// garantía que no tiene.
const FUENTES = [
  ...archivosFuente("app"),
  ...archivosFuente("lib"),
  ...archivosFuente("components"),
].map((rel) => ({
  rel,
  src: readFileSync(join(process.cwd(), rel), "utf8"),
}))

describe("disponibilidad del catálogo: un solo cálculo", () => {
  it("nobody re-implements the fallback ternary inline", () => {
    // La forma exacta del bug: `x.inventario ? x.inventario.stock : x.stock`,
    // el ternario que elige entre el stock del inventario y el propio del item.
    // Estaba copiado en ocho lugares y tres se quedaron sin migrar. Prohibirlo
    // obliga a pasar por stockDisponibleCatalogo, que es donde vive la resta de
    // stock_reservado.
    //
    // Se prohíbe la FORMA, no el token `inventario.stock`: leer el stock físico
    // es legítimo fuera del catálogo (app/api/inventario, ordenes-compra) y en
    // el desglose de /api/catalogo/diagnose.
    // Cubre las dos formas de preguntar por el link (`.inventario` y
    // `.inventario_id`) y la lectura con optional chaining (`.inventario?.stock`).
    // La version anterior solo veia una de las cuatro combinaciones, y por eso
    // la grilla del admin paso el guard leyendo stock crudo.
    const TERNARIO_VIEJO = /\.inventario(_id)?\s*\?\s*[^?:]*\.inventario\??\.stock/

    const infractores = FUENTES.filter(
      (f) => f.rel !== HELPER && TERNARIO_VIEJO.test(f.src.replace(/\s+/g, " "))
    ).map((f) => f.rel)

    expect(infractores).toEqual([])
  })

  it("every inventario embed feeding the helper also selects stock_reservado", () => {
    // Sin la columna, PostgREST omite la clave, el helper la lee como 0 y el
    // bug de stock crudo vuelve en silencio. Los mocks no lo detectan porque no
    // ejecutan SQL.
    const fallas: string[] = []

    for (const { rel, src } of FUENTES) {
      if (rel === HELPER) continue
      if (!src.includes("stockDisponibleCatalogo")) continue

      const embeds = src.match(/inventario:inventario\([^)]*\)/g) ?? []
      for (const embed of embeds) {
        if (!embed.includes("stock_reservado")) fallas.push(`${rel} → ${embed}`)
      }
    }

    expect(fallas).toEqual([])
  })

  it("covers every public surface that derives availability", () => {
    // Red de seguridad: si alguna de estas deja de usar el helper, es que
    // volvio a calcular por su cuenta.
    const obligatorios = [
      join("lib", "catalogo", "fetch-data.ts"),
      join("app", "api", "public", "catalogo", "[slug]", "items", "route.ts"),
      join("app", "api", "public", "catalogo", "[slug]", "items", "[id]", "bundle", "route.ts"),
      join("app", "api", "public", "catalogo", "[slug]", "cotizar", "route.ts"),
      join("app", "catalogo", "[slug]", "[itemId]", "page.tsx"),
      join("app", "catalogo", "[slug]", "[itemId]", "opengraph-image.tsx"),
      join("app", "api", "catalogo", "diagnose", "route.ts"),
    ]

    const sinHelper = obligatorios.filter((rel) => {
      const f = FUENTES.find((x) => x.rel === rel)
      return !f || !f.src.includes("stockDisponibleCatalogo")
    })

    expect(sinHelper).toEqual([])
  })
})
