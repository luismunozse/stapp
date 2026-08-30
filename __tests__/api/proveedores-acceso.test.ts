import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, createGetRequest, parseResponse } from "./helpers"

/**
 * Proveedores: todas las ESCRITURAS del namespace ya iban por
 * `requireAdminOrVendedor` (el DELETE, por `requireAdmin`). Las lecturas se
 * quedaron en `requireAuth`, así que un TECNICO listaba los proveedores de la
 * organización, abría su ficha, y se bajaba sus adjuntos y sus contactos.
 *
 * Son dos ejes independientes y los dos se conservan:
 *   - quién ve proveedores        -> ADMIN + VENDEDOR, el bucket de
 *                                    /proveedores en el middleware
 *   - quién ve el precio de compra -> hasInventarioAccess (permiso 275)
 *
 * El segundo ya estaba bien resuelto dentro de /stats, /[id]/stats,
 * /[id]/catalogo y /[id]/comparativa; este cambio no lo toca.
 *
 * `GET /api/proveedores` NO lo consume solo su pantalla: el selector de
 * proveedor de inventario (list, form y bulk-form) y el alta de órdenes de
 * compra también pegan ahí. Por eso el guard es requireAdminOrVendedor y no
 * requireAdmin: cerrarlo del todo rompía el alta de artículos para un
 * VENDEDOR con el permiso 275.
 */

function mockRole(role: string) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1", organizationId: "org-1", role, sucursalId: "suc-1", email: "u@u.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

function mockTablas() {
  vi.mocked(supabaseAdmin.from).mockImplementation(
    ((tabla: string) =>
      tabla === "organizations"
        ? createChainMock({ vendedores_administran_inventario: true })
        : createChainMock([], null, 0)) as any,
  )
  ;(supabaseAdmin as any).rpc = vi.fn().mockResolvedValue({ data: [], error: null })
}

async function statusDe(res: any) {
  return (await parseResponse(await res)).status
}

const params = () => ({ params: Promise.resolve({ id: "prov-1" }) })

/** Las ocho lecturas del namespace, con su forma de invocación. */
const LECTURAS: [string, () => Promise<any>][] = [
  ["GET /api/proveedores", async () => {
    const { GET } = await import("@/app/api/proveedores/route")
    return GET()
  }],
  ["GET /api/proveedores/stats", async () => {
    const { GET } = await import("@/app/api/proveedores/stats/route")
    return GET()
  }],
  ["GET /api/proveedores/[id]", async () => {
    const { GET } = await import("@/app/api/proveedores/[id]/route")
    return GET(createGetRequest("http://localhost/api/proveedores/prov-1"), params())
  }],
  ["GET /api/proveedores/[id]/adjuntos", async () => {
    const { GET } = await import("@/app/api/proveedores/[id]/adjuntos/route")
    return GET(createGetRequest("http://localhost/api/proveedores/prov-1/adjuntos"), params())
  }],
  ["GET /api/proveedores/[id]/contactos", async () => {
    const { GET } = await import("@/app/api/proveedores/[id]/contactos/route")
    return GET(createGetRequest("http://localhost/api/proveedores/prov-1/contactos"), params())
  }],
  ["GET /api/proveedores/[id]/catalogo", async () => {
    const { GET } = await import("@/app/api/proveedores/[id]/catalogo/route")
    return GET(createGetRequest("http://localhost/api/proveedores/prov-1/catalogo"), params())
  }],
  ["GET /api/proveedores/[id]/comparativa", async () => {
    const { GET } = await import("@/app/api/proveedores/[id]/comparativa/route")
    return GET(createGetRequest("http://localhost/api/proveedores/prov-1/comparativa"), params())
  }],
  ["GET /api/proveedores/[id]/stats", async () => {
    const { GET } = await import("@/app/api/proveedores/[id]/stats/route")
    return GET(createGetRequest("http://localhost/api/proveedores/prov-1/stats"), params())
  }],
]

describe("lecturas de proveedores", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTablas()
  })

  for (const [nombre, llamar] of LECTURAS) {
    it(`${nombre}: el TECNICO no la lee`, async () => {
      mockRole("TECNICO")

      expect(await statusDe(llamar())).toBe(403)
    })

    it(`${nombre}: un rol desconocido tampoco`, async () => {
      mockRole("GERENTE")

      expect(await statusDe(llamar())).toBe(403)
    })

    it(`${nombre}: el VENDEDOR sí — la usa el selector de inventario`, async () => {
      mockRole("VENDEDOR")

      expect(await statusDe(llamar())).not.toBe(403)
    })

    it(`${nombre}: el ADMIN sí`, async () => {
      mockRole("ADMIN")

      expect(await statusDe(llamar())).not.toBe(403)
    })
  }
})
