import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, createGetRequest, parseResponse } from "./helpers"

/**
 * Conteos de inventario: el namespace estaba partido al medio, y la mitad
 * abierta era la que escribe.
 *
 * Crear un conteo, cancelarlo y finalizarlo (que es lo que ajusta el stock)
 * eran `requireAdmin`. Anotar la cantidad contada de cada ítem —el PATCH— y
 * las tres lecturas eran `requireAuth` a secas.
 *
 * El guard correcto es `requireInventarioAccess`, no `requireAdmin`: la
 * pantalla vive en app/(dashboard)/inventario/conteos, dentro de un namespace
 * que ya está en RUTAS_VENDEDOR en el middleware y detrás de
 * requireInventarioAccess en la API. Un VENDEDOR con el permiso 275 recorriendo
 * las góndolas y anotando cantidades es el uso previsto.
 *
 * Ese reparto ya funcionaba, pero por accidente: `requireAuth` dejaba entrar
 * también a un TECNICO y a un VENDEDOR SIN el permiso, ninguno de los dos con
 * nada que hacer en inventario.
 */

function mockRole(role: string) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1", organizationId: "org-1", role, sucursalId: "suc-1", email: "u@u.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

/** `requireInventarioAccess` lee el flag de la org solo para el VENDEDOR. */
function mockFlagInventario(habilitado: boolean) {
  vi.mocked(supabaseAdmin.from).mockImplementation(
    ((tabla: string) =>
      tabla === "organizations"
        ? createChainMock({ vendedores_administran_inventario: habilitado })
        : createChainMock([], null, 0)) as any,
  )
}

async function statusDe(res: any) {
  return (await parseResponse(await res)).status
}

const params = () => ({ params: Promise.resolve({ id: "conteo-1" }) })
const paramsItem = () => ({ params: Promise.resolve({ id: "conteo-1", itemId: "item-1" }) })

describe("PATCH /api/conteos/[id]/items/[itemId] — anotar la cantidad contada", () => {
  beforeEach(() => vi.clearAllMocks())

  const pedir = async () => {
    const { PATCH } = await import("@/app/api/conteos/[id]/items/[itemId]/route")
    return PATCH(
      new Request("http://localhost/api/conteos/conteo-1/items/item-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cantidadContada: 5 }),
      }),
      paramsItem(),
    )
  }

  it("el TECNICO no escribe un conteo de inventario", async () => {
    // Es la única ESCRITURA que se escapó del permiso 275.
    mockRole("TECNICO")
    mockFlagInventario(true)

    expect(await statusDe(pedir())).toBe(403)
  })

  it("el VENDEDOR sin el permiso 275 tampoco", async () => {
    mockRole("VENDEDOR")
    mockFlagInventario(false)

    expect(await statusDe(pedir())).toBe(403)
  })

  it("el VENDEDOR con el permiso 275 sí: es el que recorre las góndolas", async () => {
    mockRole("VENDEDOR")
    mockFlagInventario(true)

    expect(await statusDe(pedir())).not.toBe(403)
  })

  it("el ADMIN sí", async () => {
    mockRole("ADMIN")
    mockFlagInventario(false)

    expect(await statusDe(pedir())).not.toBe(403)
  })
})

describe("lecturas de conteos", () => {
  beforeEach(() => vi.clearAllMocks())

  const lecturas: [string, () => Promise<any>][] = [
    [
      "GET /api/conteos",
      async () => {
        const { GET } = await import("@/app/api/conteos/route")
        return GET(createGetRequest("http://localhost/api/conteos"))
      },
    ],
    [
      "GET /api/conteos/[id]",
      async () => {
        const { GET } = await import("@/app/api/conteos/[id]/route")
        return GET(createGetRequest("http://localhost/api/conteos/conteo-1"), params())
      },
    ],
    [
      "GET /api/conteos/[id]/items",
      async () => {
        const { GET } = await import("@/app/api/conteos/[id]/items/route")
        return GET(createGetRequest("http://localhost/api/conteos/conteo-1/items"), params())
      },
    ],
  ]

  for (const [nombre, llamar] of lecturas) {
    it(`${nombre}: el TECNICO no la lee`, async () => {
      mockRole("TECNICO")
      mockFlagInventario(true)

      expect(await statusDe(llamar())).toBe(403)
    })

    it(`${nombre}: el VENDEDOR sin el permiso 275 tampoco`, async () => {
      mockRole("VENDEDOR")
      mockFlagInventario(false)

      expect(await statusDe(llamar())).toBe(403)
    })

    it(`${nombre}: el VENDEDOR con el permiso 275 sí`, async () => {
      mockRole("VENDEDOR")
      mockFlagInventario(true)

      expect(await statusDe(llamar())).not.toBe(403)
    })
  }
})
